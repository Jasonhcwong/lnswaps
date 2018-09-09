const async = require('async');

const { redisClient, redisPub } = require('./redis_client');
const getAddressDetails = require('./get_address_details');
const getInvoiceDetails = require('./get_invoice_details');
const getExchangeRates = require('./get_exchange_rates');
const serverSwapKeyPair = require('./server_swap_key_pair');
const swapAddress = require('./swap_address');
const logger = require('./logger');
const orderState = require('./order_state');

const msPerSec = 1e3;
const DEC_BASE = 10;
const timeoutBlockCount = 1440;

/** Create a swap quote.

  {
    invoice: <Lightning Invoice String>
    network: <Network Name String>
    refund: <Chain Address String>
  }

  @returns via cbk
  {
    destination_public_key: <Destination Public Key Hex String>
    invoice: <Lightning Invoice String>
    payment_hash: <Payment Hash Hex String>
    redeem_script: <Redeem Script Hex String>
    refund_address: <Refund Address String>
    refund_public_key_hash: <Refund Public Key Hash Hex String>
    swap_amount: <Swap Amount Number>
    swap_fee: <Swap Fee Tokens Number>
    swap_key_index: <Swap Key Index Number>
    swap_p2sh_p2wsh_address: <Swap Chain P2SH Nested SegWit Address String>
    swap_p2wsh_address: <Swap Chain P2WSH Bech32 Address String>
    timeout_block_height: <Swap Expiration Date Number>
  }
*/
module.exports = ({ invoice, network, refund }, cbk) => async.auto({
  // Validate basic arguments
  validate: (cbk) => {
    if (!invoice) {
      return cbk([400, 'ExpectedInvoice']);
    }

    if (!network) {
      return cbk([400, 'ExpectedNetworkForChainSwap']);
    }

    if ((network === 'testnet' || network === 'ltctestnet') && !refund) {
      return cbk([400, 'ExpectedRefundAddress']);
    }

    return cbk();
  },

  // get exchange rates and fees
  getExchangeRatesAndFees: cbk => getExchangeRates(cbk),

  // Swap timeout block height
  timeoutBlockHeight: (cbk) => {
    redisClient.get(`Blockchain:${network}:Height`, (err, reply) => {
      if (err) return cbk([400, 'UnableToGetChainHeight']);
      if (!reply) return cbk([400, 'UnableToGetChainHeight']);
      return cbk(null, parseInt(reply, DEC_BASE) + timeoutBlockCount);
    });
  },

  // Pull details about the invoice to pay
  getInvoice: cbk => getInvoiceDetails({ invoice, network }, cbk),

  // Decode the refund address
  getAddressDetails: (cbk) => {
    if (network.startsWith('eth')) {
      return cbk(null, { type: 'ethereum' });
    }

    return getAddressDetails({ network, address: refund }, cbk);
  },

  // Make a temporary server public key to send the swap to
  serverDestinationKey: (cbk) => {
    if (network.startsWith('eth')) {
      return cbk(null, { type: 'ethereum' });
    }

    const swapKeyIndex = Math.round(Date.now() / msPerSec);
    try {
      return cbk(null, serverSwapKeyPair({ network, index: swapKeyIndex }));
    } catch (e) {
      return cbk([500, 'ExpectedValidSwapKeyPair', e]);
    }
  },

  // Determine the refund address hash
  refundAddress: ['getAddressDetails', ({ getAddressDetails }, cbk) => {
    if (network.startsWith('eth')) {
      return cbk(null, { type: 'ethereum' });
    }

    const details = getAddressDetails;

    if (details.type !== 'p2pkh' && details.type !== 'p2wpkh') {
      return cbk([400, 'ExpectedPayToPublicKeyHashAddress']);
    }

    return cbk(null, { public_key_hash: details.hash || details.data });
  }],

  // Create the swap address
  swapAddress: [
    'getInvoice',
    'refundAddress',
    'serverDestinationKey',
    'timeoutBlockHeight',
    'validate',
    (res, cbk) => {
      if (network.startsWith('eth')) {
        return cbk(null, { p2sh_p2wsh_address: process.env.LNSWAP_CONTRACT_ADDRESS });
      }

      let addr;
      try {
        addr = swapAddress({
          network,
          destination_public_key: res.serverDestinationKey.public_key,
          payment_hash: res.getInvoice.id,
          refund_public_key_hash: res.refundAddress.public_key_hash,
          timeout_block_height: res.timeoutBlockHeight,
        });
      } catch (e) {
        return cbk([500, 'SwapAddressCreationFailure', e]);
      }
      return cbk(null, addr);
    }],

  // Swap fee component
  getSwapAmount: ['getInvoice', 'getExchangeRatesAndFees',
    ({ getInvoice, getExchangeRatesAndFees }, cbk) => {
      let rate;
      let feePercentage;
      switch (network) {
        case 'testnet':
        case 'bitcoin':
          rate = 1.0;
          feePercentage = parseFloat(getExchangeRatesAndFees.fees.BTC) / 10000;
          break;

        case 'ltctestnet':
        case 'litecoin':
          rate = parseFloat(getExchangeRatesAndFees.LTCBTC);
          feePercentage = parseFloat(getExchangeRatesAndFees.fees.LTC) / 10000;
          break;

        case 'eth_rinkeby':
        case 'ethereum':
          rate = parseFloat(getExchangeRatesAndFees.ETHBTC);
          feePercentage = parseFloat(getExchangeRatesAndFees.fees.ETH) / 10000;
          break;

        default:
          return cbk([400, 'UnknownNetwork']);
          break;
      }

      const convertedAmount = parseFloat(getInvoice.tokens) / 100000000 / rate;
      const fee = convertedAmount * feePercentage;
      return cbk(null, { tokens: (convertedAmount + fee).toFixed(8), fee: fee.toFixed(8) });
    },
  ],

  // Swap details
  swap: [
    'getInvoice',
    'getSwapAmount',
    'refundAddress',
    'serverDestinationKey',
    'swapAddress',
    'timeoutBlockHeight',
    (res, cbk) => {
      let onchainCurrency = 'BTC';
      if (network === 'ltc' || network === 'ltctest') {
        onchainCurrency = 'LTC';
      } else if (network.startsWith('eth')) {
        onchainCurrency = 'ETH';
      }
      redisClient.hmset(
        `SwapOrder:${invoice}`,
        'onchainCurrency', onchainCurrency,
        'onchainNetwork', network,
        'onchainAmount', res.getSwapAmount.tokens,
        'orderCreationTime', new Date().toISOString(),
        'swapAddress', res.swapAddress.p2sh_p2wsh_address,
        'swapKeyIndex', res.serverDestinationKey.swapKeyIndex || 'ethereum',
        'refundAddress', refund || 'ethereum',
        'redeemScript', res.swapAddress.redeem_script || 'ethereum',
        'timeoutBlockNo', res.timeoutBlockHeight,
        'state', 'WaitingForFunding',
        (err) => {
          if (err) return cbk([400, 'Error creating order in redis']);
          // TODO try..catch
          const msg = orderState.encodeMessage({
            state: orderState.WaitingForFunding,
            invoice,
            onchainNetwork: network,
            onchainAmount: res.getSwapAmount.tokens,
            lnPaymentHash: res.getInvoice.id,
            swapAddress: res.swapAddress.p2sh_p2wsh_address,
          });
          redisPub.publish(orderState.channel, msg);
        },
      );
      return cbk(null, {
        invoice,
        destination_public_key: res.serverDestinationKey.public_key,
        payment_hash: res.getInvoice.id,
        redeem_script: res.swapAddress.redeem_script,
        refund_address: refund,
        refund_public_key_hash: res.refundAddress.public_key_hash,
        swap_amount: res.getSwapAmount.tokens,
        swap_fee: res.getSwapAmount.fee,
        swap_key_index: res.serverDestinationKey.swapKeyIndex,
        swap_p2sh_p2wsh_address: res.swapAddress.p2sh_p2wsh_address,
        swap_p2wsh_address: res.swapAddress.p2wsh_address,
        timeout_block_height: res.timeoutBlockHeight,
      });
    }],
}, (err, result) => {
  if (err) {
    logger.error('[ERROR]', err);
    return cbk(err);
  }
  return cbk(null, result.swap);
});

const async = require('async');
const { parseInvoice } = require('ln-service');

const getExchangeRates = require('./get_exchange_rates');
const { redisClient, updateRedisOrderAndPublish, ReplyError } = require('./redis_client');
const logger = require('./logger');
const orderState = require('./order_state');

const estimatedTxVirtualSize = 200;

const minLNInvoiceAmount = 10000; // satoshi
const maxLNInvoiceAmount = 4194304; // satoshi
const maxLNRoutingFeePercentage = 0.01;

function waitForRoutes(invoice, count, cbk) {
  redisClient.hget(`${orderState.prefix}:${invoice}`, 'lnRoutes', (err, reply) => {
    if (err) {
      logger.error('Error reading lnRoutes', err);
      return cbk([400, 'CannotReadLNRoutes']);
    }

    if (reply) {
      return cbk(null, JSON.parse(reply));
    }

    if (count < 20) {
      setTimeout(waitForRoutes, 300, invoice, count + 1, cbk);
      return null;
    }

    return cbk(null, 'END');
  });
}

/** Get invoice details in the context of a swap

  {
    invoice: <Invoice String>
    network: <Network of Chain Swap String>
  }

  @returns via cbk
  {
    created_at: <Created At ISO 8601 Date String>
    description: <Payment Description String>
    destination_public_key: invoice.destination,
    expires_at: <Expires At ISO 8601 Date String>
    fee: <Swap Fee Tokens Number>
    [fee_fiat_value]: <Fee Fiat Cents Value Number>
    [fiat_currency_code]: <Fiat Currency Code String>
    [fiat_value]: <Fiat Value in Cents Number>
    id: <Invoice Id String>
    is_expired: <Invoice is Expired Bool>
    network: <Network of Invoice String>
    tokens: <Tokens to Send Number>
  }
*/
module.exports = ({ invoice, network }, cbk) => {
  async.auto({
    // Check arguments and decode the supplied invoice
    parsedInvoice: (cbk) => {
      if (!invoice) {
        return cbk([400, 'ExpectedInvoiceForInvoiceDetails']);
      }

      if (!network) {
        return cbk([400, 'ExpectedNetworkForInvoiceDetails']);
      }

      let parsed;
      try {
        parsed = parseInvoice({ invoice });
      } catch (e) {
        return cbk([400, 'DecodeInvoiceFailure']);
      }

      if (parsed.is_expired) {
        return cbk([400, 'InvoiceIsExpired']);
      }

      const now = Date.now();
      const expiry = Date.parse(parsed.expires_at);
      if (expiry - now < 1000 * 60 * 20) {
        return cbk([400, 'InvoiceExpiresTooSoon']);
      }

      if (parsed.tokens < minLNInvoiceAmount) {
        return cbk([400, 'InvoiceAmountTooSmall']);
      }

      if (parsed.tokens > maxLNInvoiceAmount) {
        return cbk([400, 'InvoiceAmountTooLarge']);
      }

      updateRedisOrderAndPublish(`${orderState.prefix}:${invoice}`, {
        state: orderState.Init,
        invoice,
        onchainNetwork: network,
        lnCreationDate: parsed.created_at,
        lnDescription: parsed.description,
        lnDestPubKey: parsed.destination,
        lnExpiryDate: parsed.expires_at,
        lnPaymentHash: parsed.id,
        lnPreimage: '',
        lnCurrency: 'BTC',
        lnAmount: parsed.tokens,
        lnPaymentLock: '',
      }).then(() => cbk(null, parsed))
        .catch((e) => {
          if (e instanceof ReplyError && e.command === 'HMSET') {
            logger.error('Error when updating DB:', e);
            return cbk([400, 'Error when updating DB']);
          }
          logger.error('Error when publish msg:', e);
          return cbk(null, parsed);
        });
    },

    // Get the current fee rate and fiat rates
    getExchangeRates: cbk => getExchangeRates(cbk),

    // See if this invoice is payable
    getRoutes: ['parsedInvoice', ({ parsedInvoice }, cbk) => {
      waitForRoutes(invoice, 0, cbk);
    }],

    // Check to make sure the invoice can be paid
    checkPayable: ['getExchangeRates', 'getRoutes', 'parsedInvoice', ({ getExchangeRates, getRoutes, parsedInvoice }, cbk) => {
      // check route to dest exist and routing fee
      if (!Array.isArray(getRoutes.routes)) {
        logger.error('ExpectedRoutesToCheck:', getRoutes);
        return cbk([400, 'CannotReadLNRoutes']);
      }
      // Is there a route available that can send the tokens?
      if (!getRoutes.routes.length) {
        logger.error('NoRouteForInvoicePayment');
        return cbk([400, 'CannotReadLNRoutes']);
      }

      // TODO: check minRoutingFee
      const minRoutingFee = Math.min(getRoutes.routes.map(({ fee }) => fee));
      if (parseFloat(minRoutingFee) / parsedInvoice.tokens > maxLNRoutingFeePercentage) {
        logger.error('RoutingFeeTooHigh');
        return cbk([400, 'RoutingFeeTooHigh']);
      }

      return cbk(null, 'checkPayable');
    }],
  }, (err, result) => {
    if (err) {
      return cbk(err);
    }

    let rate;
    let feePercentage;
    let fiatRate;
    switch (network) {
      case 'testnet':
      case 'bitcoin':
        rate = 1.0;
        fiatRate = parseFloat(result.getExchangeRates.BTCUSD);
        feePercentage = parseFloat(result.getExchangeRates.fees.BTC) / 10000;
        break;

      case 'ltctestnet':
      case 'litecoin':
        rate = parseFloat(result.getExchangeRates.LTCBTC);
        fiatRate = parseFloat(result.getExchangeRates.LTCUSD);
        feePercentage = parseFloat(result.getExchangeRates.fees.LTC) / 10000;
        break;

      case 'eth_rinkeby':
      case 'ethereum':
        rate = parseFloat(result.getExchangeRates.ETHBTC);
        fiatRate = parseFloat(result.getExchangeRates.ETHUSD);
        feePercentage = parseFloat(result.getExchangeRates.fees.ETH) / 10000;
        break;

      default:
        return cbk([400, 'UnknownNetwork']);
    }

    const convertedAmount = parseFloat(result.parsedInvoice.tokens) / 100000000 / rate;
    const fee = convertedAmount * feePercentage;
    const feeFiatValue = fee * fiatRate;
    const fiatValue = parseFloat(result.parsedInvoice.tokens) / 100000000
      * parseFloat(result.getExchangeRates.BTCUSD);
    const ret = {
      created_at: result.parsedInvoice.created_at,
      description: result.parsedInvoice.description,
      destination_public_key: result.parsedInvoice.destination,
      expires_at: result.parsedInvoice.expires_at,
      id: result.parsedInvoice.id,
      is_expired: result.parsedInvoice.is_expired,
      network: result.parsedInvoice.network,
      tokens: result.parsedInvoice.tokens,
      fee,
      fee_fiat_value: feeFiatValue,
      fiat_currency_code: 'USD',
      fiat_value: fiatValue,
    };
    return cbk(null, ret);
  });
};

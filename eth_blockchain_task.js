const Web3 = require('web3');
const fs = require('fs');
const log4js = require('log4js');
const { redisClient, redisSub, redisPub } = require('./service/redis_client.js');
const orderState = require('./service/order_state.js');

const BLOCK_HEIGHT_EXPIRATION = 60; // seconds
const FEE_ESTIMATION_EXPIRATION = 60; // seconds

const retryLimit = 10;
const interestedInvoices = new Map(); // invoice => ({onchainAmount, lnPaymentHash})
const interestedTxns = new Map(); // txid => (invoice)

const logger = log4js.getLogger();
logger.level = 'all';

const RINKEBY_WSS = 'wss://rinkeby.infura.io/ws';
// const GETH_WSS = 'ws://127.0.0.1:8546';

const web3 = new Web3();

const { LNSWAP_CHAIN, LNSWAP_CONTRACT_ADDRESS, LNSWAP_CLAIM_PRIVIATE_KEY } = process.env;
if (!LNSWAP_CHAIN || !LNSWAP_CONTRACT_ADDRESS || !LNSWAP_CLAIM_PRIVIATE_KEY) {
  logger.fatal('Please set environment variables LNSWAP_CHAIN, LNSWAP_CONTRACT_ADDRESS and LNSWAP_CLAIM_PRIVIATE_KEY.');
  process.exit();
}

switch (LNSWAP_CHAIN) {
  case 'ethereum':
  case 'eth_rinkeby':
    break;

  default:
    logger.fatal('Unsupported blockchain:', LNSWAP_CHAIN);
    process.exit();
}

const swapContractABI = JSON.parse(fs.readFileSync('swap_contract_abi.json', 'utf8'));
const swapContract = new web3.eth.Contract(swapContractABI, LNSWAP_CONTRACT_ADDRESS);

function claimTransaction({ invoice, lnPreimage }) {
  const input = swapContract.methods.claim(invoice, '0x'.concat(lnPreimage)).encodeABI();
  const rawTxn = {
    to: LNSWAP_CONTRACT_ADDRESS,
    data: input,
    gas: '300000',
  };
  web3.eth.accounts.signTransaction(rawTxn, LNSWAP_CLAIM_PRIVIATE_KEY)
    .then(({ rawTransaction }) => {
      // logger.debug('raw claim transaction:', rawTransaction);
      web3.eth.sendSignedTransaction(rawTransaction)
        .on('transactionHash', (hash) => {
          redisClient.hmset(`${orderState.prefix}:${invoice}`, 'claimingTxn',
            hash, 'state', 'WaitingForClaimingConfirmation');
          // TODO: try..catch
          const msg = orderState.encodeMessage({ state: orderState.WaitingForClaimingConfirmation, invoice, claimingTxn: hash });
          redisPub.publish(orderState.channel, msg);
          logger.info('claimTransaction: hash:', hash);
        })
        .on('error', (err) => {
          logger.error('claimTransaction:', err);
        });
    })
    .catch((err) => {
      logger.error('signTransaction:', err);
    });
}

redisSub.on('subscribe', (channel, count) => {
  logger.info(`[subcribe]channel: ${channel}, count: ${count}`);
});

redisSub.on('message', (channel, msg) => {
  logger.debug(`[message]${channel}: ${msg}`);
  if (channel !== orderState.channel) return;

  try {
    const {
      state, invoice, onchainNetwork, onchainAmount, lnPaymentHash, fundingTxn, lnPreimage,
    } = orderState.decodeMessage(msg);
    // only handle orders belong to this chain
    if (onchainNetwork !== LNSWAP_CHAIN) return;

    switch (state) {
      case orderState.WaitingForFunding:
        interestedInvoices.set(invoice, { onchainAmount, lnPaymentHash });
        logger.info('added interestedInvoice: ', invoice);
        break;

      case orderState.WaitingForFundingConfirmation:
        interestedTxns.set(fundingTxn, invoice);
        logger.info('added interestedTxn: ', fundingTxn);
        break;

      case orderState.WaitingForClaiming:
        claimTransaction({ invoice, lnPreimage });
        break;

      default:
        break;
    }
  } catch (e) {
    logger.error(e);
  }
});

redisSub.subscribe(orderState.channel);

function updateGasPrice() {
  web3.eth.getGasPrice()
    .then((price) => {
      // Blockchain Fee Estimation JSON format used by swap service:
      // {  feerate: '0.00001', blocks:  '1' }
      const fee = JSON.stringify({ feerate: price, blocks: '1' });
      redisClient.set(`Blockchain:${LNSWAP_CHAIN}:FeeEstimation`, fee, 'EX', FEE_ESTIMATION_EXPIRATION);
      logger.debug('Gas price(wei):', price);
    })
    .catch(e => logger.error('updateGasPrice():', e));
}

function updatePendingTxn({ txn }) {
  const fundedParamsJSON = [
    { name: 'lninvoice', type: 'string' },
    { name: 'paymentHash', type: 'bytes32' }];
  const fundMethodJSON = 'fund(string,bytes32)';
  const fundMethodSig = web3.eth.abi.encodeFunctionSignature(fundMethodJSON);

  const methodSig = txn.input.slice(0, 10);
  const encodedParams = txn.input.slice(10);
  const decodedParams = web3.eth.abi.decodeParameters(fundedParamsJSON, encodedParams);

  // check if a txn is a funding txn:
  // 1. method signature from input data
  // 2. lninvoice from input data
  // 3. payment hash from input data
  // 4. value of txn

  if (methodSig !== fundMethodSig) return;
  const interestedInvoice = interestedInvoices.get(decodedParams.lninvoice);
  if (interestedInvoice
    && interestedInvoice.onchainAmount === web3.utils.fromWei(txn.value)
    && interestedInvoice.lnPaymentHash === decodedParams.paymentHash.slice(2)) {
    redisClient.hmset(
      `${orderState.prefix}:${decodedParams.lninvoice}`,
      'fundingTxn', txn.hash,
      'state', 'WaitingForFundingConfirmation',
    );
    // TODO: try..catch
    const msg = orderState.encodeMessage({
      fundingTxn: txn.hash,
      state: orderState.WaitingForFundingConfirmation,
      invoice: decodedParams.lninvoice,
    });
    redisPub.publish(orderState.channel, msg);

    interestedTxns.set(txn.hash, decodedParams.lninvoice);

    logger.info(`Found interested txn: ${txn.hash}`);
  }
}

function processPendingTxn(hash, retryCount) {
  web3.eth.getTransaction(hash)
    .then((txn) => {
      if (txn.to === LNSWAP_CONTRACT_ADDRESS) updatePendingTxn({ txn });
    })
    .catch((err) => {
      if (retryCount < retryLimit) {
        // retry in 1 second
        setTimeout(processPendingTxn, 1000, hash, retryCount + 1);
      } else {
        logger.error(`Failed to get transaction(${hash}) aftet ${retryCount} retries, error: ${err}`);
      }
    });
}

function setWeb3Subscription() {
  web3.eth.subscribe('pendingTransactions')
    .on('data', hash => processPendingTxn(hash, 0))
    .on('error', (err) => {
      logger.fatal('pendingTransactions subscription:', err);
      process.exit();
    });

  web3.eth.subscribe('newBlockHeaders')
    .on('data', (hdr) => {
      // Blockchain Height format used by swap service: '1254834'
      redisClient.set(`Blockchain:${LNSWAP_CHAIN}:Height`, hdr.number, 'EX', BLOCK_HEIGHT_EXPIRATION);
      updateGasPrice();

      logger.debug('New Block number:', hdr.number, ', hash:', hdr.hash);
    })
    .on('error', (err) => {
      logger.fatal('newBlockHeaders subscription:', err);
      process.exit();
    });
}

function setContractEvents() {
  swapContract.events.allEvents()
    .on('data', (event) => {
      if (event.address !== LNSWAP_CONTRACT_ADDRESS) return;

      redisClient.hmget(
        `${orderState.prefix}:${event.returnValues.lninvoice}`,
        'state', 'onchainAmount', 'lnPaymentHash',
        (err, reply) => {
          if (!reply || reply.includes(null)) {
            logger.error('Event: Unknown txn:', event.transactionHash);
            return;
          }
          const [state, onchainAmount, lnPaymentHash] = reply;

          switch (event.event) {
            case 'orderFunded':
              if ((state === 'WaitingForFunding' || state === 'WaitingForFundingConfirmation')
                && onchainAmount === web3.utils.fromWei(event.returnValues.onchainAmount)
                && lnPaymentHash === event.returnValues.paymentHash.slice(2)) {
                redisClient.hmset(
                  `${orderState.prefix}:${event.returnValues.lninvoice}`,
                  'state', orderState.OrderFunded,
                  'fundingTxn', event.transactionHash,
                  'fundingBlockHash', event.blockHash,
                );
                // TODO: try...catch
                const msg = orderState.encodeMessage({ state: orderState.OrderFunded, invoice: event.returnValues.lninvoice });
                redisPub.publish(orderState.channel, msg);
                logger.info(`Event: orderFunded: ${event.returnValues.lninvoice}`);
              } else {
                logger.error('Event: Unknown fundingTxn:', event.transactionHash);
              }
              break;

            case 'orderClaimed':
              if (state === 'WaitingForClaimingConfirmation') {
                redisClient.hmset(
                  `${orderState.prefix}:${event.returnValues.lninvoice}`,
                  'state', 'OrderClaimed',
                  'claimingTxn', event.transactionHash,
                  'claimingBlockHash', event.blockHash,
                );
                // TODO: try...catch
                const msg = orderState.encodeMessage({
                  state: orderState.OrderClaimed,
                  invoice: event.returnValues.lninvoice,
                  claimingTxn: event.transactionHash,
                  claimingBlockHash: event.blockHash,
                });
                redisPub.publish(orderState.channel, msg);
                logger.info(`Event: orderClaimed: ${event.returnValues.lninvoice}`);
              } else {
                logger.error('Event: Unknown claimingTxn:', event.transactionHash);
              }
              break;

            case 'orderRefunded':
              if (state === 'WaitingForRefund') {
                redisClient.hmset(
                  `${orderState.prefix}:${event.returnValues.lninvoice}`,
                  'state', 'OrderRefunded',
                  'refundTxn', event.transactionHash,
                  'refundBlockHash', event.blockHash,
                );
                // TODO: try...catch
                const msg = orderState.encodeMessage({
                  state: orderState.OrderRefunded,
                  invoice: event.returnValues.lninvoice,
                  refundTxn: event.transactionHash,
                  refundBlockHash: event.blockHash,
                });
                redisPub.publish(orderState.channel, msg);
                logger.info(`Event: orderRefunded: ${event.returnValues.lninvoice}`);
              } else {
                logger.error('Event: Unknown refundTxn:', event.transactionHash);
              }
              break;

            default:
              logger.error('Found unknown event:', event.event, 'at txn:', event.transactionHash);
              break;
          }
        },
      );
    })
    .on('changed', (event) => {
      // remove event from local database
      logger.info('Event changed of txn:', event.transactionHash);
    })
    .on('error', (error) => {
      logger.error('Contract event subscription error:', error);
      // TODO: restart subscription
    });
}

function setWeb3ProviderEvents(_provider) {
  _provider.on('connect', () => {
    logger.info('WSS connected');

    setWeb3Subscription();
    setContractEvents();
  });

  _provider.on('error', e => logger.error('WSS Error:', e));

  _provider.on('end', (e) => {
    logger.error('WSS closed:', e);
    setTimeout(() => {
      logger.error('Attempting to reconnect...');
      startWeb3();
    }, 5000);
  });
}

function startWeb3() {
  const provider = new Web3.providers.WebsocketProvider(RINKEBY_WSS);
  // const provider = new Web3.providers.WebsocketProvider(GETH_WSS, { headers: { Origin: 'http://localhost' } });

  web3.setProvider(provider);
  setWeb3ProviderEvents(provider);
}

startWeb3();

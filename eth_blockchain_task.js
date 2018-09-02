const Web3 = require('web3');
const fs = require('fs');
const log4js = require('log4js');
const { redisClient, redisSub } = require('./service/redis_client.js');

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
          redisClient.hmset(`SwapOrder:${invoice}`, 'claimingTxn',
            hash, 'state', 'WaitingForClaimingConfirmation');
          logger.info('claimTransaction: hash:', hash);
        })
        .on('confirmation', (confNo) => {
          if (confNo === 1) {
            redisClient.hset(`SwapOrder:${invoice}`, 'state', 'OrderClaimed');
            logger.debug('claimTransaction: confNo:', confNo);
          }
        })
        .on('error', (err) => {
          logger.error('claimTransaction:', err);
        });
    })
    .catch((err) => {
      logger.error('signTransaction:', err);
    });
}

redisSub.on('psubscribe', (pattern, count) => {
  logger.info('[psubcribe]pattern: ', pattern, ', count: ', count);
});

redisSub.on('pmessage', (pattern, channel, message) => {
  logger.debug('[pmessage]channel ', channel, ': ', message);
  if (message === 'hset') {
    const [, prefix, invoice] = channel.split(':');
    // get order from redis
    redisClient.hmget(
      `${prefix}:${invoice}`,
      'state', 'fundingTxn', 'onchainAmount', 'lnPaymentHash',
      'lnPreimage', 'onchainNetwork',
      (err, reply) => {
        const [state, fundingTxn, onchainAmount, lnPaymentHash, lnPreimage,
          onchainNetwork] = reply;

        // only handle order belong to this network
        if (onchainNetwork !== LNSWAP_CHAIN) return;

        // waiting for funding
        if (state === 'WaitingForFunding' && !fundingTxn) {
          interestedInvoices.set(invoice, { onchainAmount, lnPaymentHash });
          logger.info('added interestedInvoice: ', invoice);
        } else if (state === 'WaitingForFundingConfirmation' && fundingTxn) {
          interestedTxns.set(fundingTxn, invoice);
          logger.info('added interestedTxn: ', fundingTxn);
        } else if (state === 'WaitingForClaiming' && lnPreimage) {
          claimTransaction({ invoice, lnPreimage });
        }
      },
    );
  }
});

redisSub.psubscribe('__keyspace@0__:SwapOrder:*');

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
      `SwapOrder:${decodedParams.lninvoice}`,
      'fundingTxn', txn.hash,
      'state', 'WaitingForFundingConfirmation',
    );

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
        `SwapOrder:${event.returnValues.lninvoice}`,
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
                  `SwapOrder:${event.returnValues.lninvoice}`,
                  'state', 'WaitingForPayment',
                  'fundingTxn', event.transactionHash,
                  'fundingBlockHash', event.blockHash,
                );
                logger.info(`Event: orderFunded: ${event.returnValues.lninvoice}`);
              } else {
                logger.error('Event: Unknown fundingTxn:', event.transactionHash);
              }
              break;

            case 'orderClaimed':
              if (state === 'WaitingForClaimingConfirmation') {
                redisClient.hmset(
                  `SwapOrder:${event.returnValues.lninvoice}`,
                  'state', 'OrderClaimed',
                  'claimingTxn', event.transactionHash,
                  'claimingBlockHash', event.blockHash,
                );
                logger.info(`Event: orderClaimed: ${event.returnValues.lninvoice}`);
              } else {
                logger.error('Event: Unknown claimingTxn:', event.transactionHash);
              }
              break;

            case 'orderRefunded':
              if (state === 'WaitingForRefund') {
                redisClient.hmset(
                  `SwapOrder:${event.returnValues.lninvoice}`,
                  'state', 'OrderRefunded',
                  'refundTxn', event.transactionHash,
                );
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

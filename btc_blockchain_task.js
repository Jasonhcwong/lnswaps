const zmq = require('zmq');
const bitcoinRpc = require('node-bitcoin-rpc');
const bitcoin = require('bitcoinjs-lib');
const { networks, crypto } = require('bitcoinjs-lib');
const { mnemonicToSeed, validateMnemonic } = require('bip39');
const bip65Encode = require('bip65').encode;
const log4js = require('log4js');
const { HDNode, Transaction } = require('./tokenslib');
const { redisClient, redisSub } = require('./service/redis_client.js');

const logger = log4js.getLogger();
logger.level = 'all';

const BLOCK_HEIGHT_EXPIRATION = 60; // seconds
const BLOCK_HEIGHT_INTERVAL = 6000; // miliseconds
const FEE_ESTIMATION_EXPIRATION = 60; // seconds
const FEE_ESTIMATION_INTERVAL = 6000; // miliseconds

const DEC_BASE = 10;

const interestedAddrs = new Map(); // addr => ({token, invoice})
const interestedTxns = new Map(); // txid => (invoice)

const {
  LNSWAP_CHAIN, LNSWAP_CHAIN_RPC_API, LNSWAP_CLAIM_ADDRESS,
  LNSWAP_CLAIM_BIP39_SEED, LNSWAP_CHAIN_ZMQ_URL,
} = process.env;

switch (LNSWAP_CHAIN) {
  case 'bitcoin':
  case 'testnet':
  case 'litecoin':
  case 'ltctestnet':
    break;

  default:
    logger.fatal('Unsupported blockchain:', LNSWAP_CHAIN);
    process.exit();
}
const bitcoinjsNetwork = networks[LNSWAP_CHAIN];
const [partA, partB] = LNSWAP_CHAIN_RPC_API.split('@');
const [rpcUsername, rpcPassword] = partA.split(':');
const [rpcHost, rpcPort] = partB.split(':');

if (!LNSWAP_CLAIM_ADDRESS) {
  logger.fatal('Please set variable LNSWAP_CLAIM_ADDRESS');
  process.exit();
}

if (!validateMnemonic(LNSWAP_CLAIM_BIP39_SEED)) {
  logger.fatal('ExpectedValidMnemonic');
  process.exit();
}
const seed = mnemonicToSeed(LNSWAP_CLAIM_BIP39_SEED);
const root = HDNode.fromSeedBuffer(seed, bitcoinjsNetwork);

const zmqSocket = zmq.socket('sub');

let currentBlockHeight = 0;

function getAddressesFromOuts(outs) {
  const outputAddresses = [];
  outs.forEach(({ script, value }, index) => {
    try {
      const address = bitcoin.address.fromOutputScript(script, bitcoinjsNetwork);
      outputAddresses.push({ address, tokens: value, index });
    } catch (e) {
      // OP_RETURN
      // logger.error('getAddressesFromOuts(): OP_RETURN');
    }
  });

  return outputAddresses;
}

// create claim transaction to claim fund
// TODO: calculate weight and txn fee
// TODO: batching claimning txns
function claimTransaction({
  invoice, onchainAmount, fundingTxnIndex, fundingTxn, redeemScript, swapKeyIndex, lnPreimage,
}) {
  const tx = new bitcoin.Transaction();

  // add output: claimAddress and (onchainAmount - txnFee)
  const scriptPubKey = bitcoin.address.toOutputScript(LNSWAP_CLAIM_ADDRESS, bitcoinjsNetwork);
  tx.addOutput(scriptPubKey, onchainAmount - 1000);

  // add input: fundingTxn, fundingTxnIndex and sequence
  tx.addInput(Buffer.from(fundingTxn, 'hex').reverse(), parseInt(fundingTxnIndex, DEC_BASE));
  tx.ins[0].sequence = 0;

  // set locktime
  tx.locktime = bip65Encode({ blocks: currentBlockHeight });

  // set scriptSig
  const redeemBuf = Buffer.from(redeemScript, 'hex');
  // '22' => length, '00' => OP_0, '20' => len of sha256
  const witnessInput = Buffer.concat([Buffer.from('220020', 'hex'), crypto.sha256(redeemBuf)]);
  tx.setInputScript(0, witnessInput);

  // set witness data
  const { keyPair } = root.derivePath(`m/0'/0/${swapKeyIndex}`);
  const sigHash = tx.hashForWitnessV0(0, redeemBuf,
    parseInt(onchainAmount, DEC_BASE), Transaction.SIGHASH_ALL);
  const signature = keyPair.sign(sigHash).toScriptSignature(Transaction.SIGHASH_ALL);
  const witness = [signature, Buffer.from(lnPreimage, 'hex'), redeemBuf];
  tx.setWitness(0, witness);

  logger.info('claimTransaction:', tx.toHex());

  bitcoinRpc.call('sendrawtransaction', [tx.toHex()], (err) => {
    if (err) {
      logger.error(`sendrawtransaction(): ${err}`);
    } else {
      logger.info('claim transaction sent, ID:', tx.getId());

      redisClient.hmset(
        `SwapOrder:${invoice}`,
        'claimningTxn', tx.getId(),
        'state', 'WaitingForClaimingConfirmation',
        (redisErr) => {
          if (redisErr) {
            logger.error(`updating order: ${invoice}: ${redisErr}`);
          }
        },
      );
    }
  });
}

bitcoinRpc.init(rpcHost, parseInt(rpcPort, DEC_BASE), rpcUsername, rpcPassword);

zmqSocket.on('message', (topic, message) => {
  if (topic.toString() === 'rawtx') {
    const txn = bitcoin.Transaction.fromHex(message.toString('hex'));
    const outputAddresses = getAddressesFromOuts(txn.outs);

    outputAddresses.forEach(({ address, tokens, index }) => {
      const addrInfo = interestedAddrs.get(address);
      if (addrInfo && parseInt(addrInfo.reqTokens, DEC_BASE) === tokens) {
        redisClient.hmset(
          `SwapOrder:${addrInfo.invoice}`,
          'fundingTxn', txn.getId(),
          'fundingTxnIndex', index,
          'state', 'WaitingForFundingConfirmation',
          (err) => {
            if (err) {
              logger.error('updating order:', addrInfo.invoice);
            } else {
              logger.info(`found funding outpoint ${txn.getId()}:${index} for addr ${address} for invoice ${addrInfo.invoice}`);
            }
          },
        );
        interestedAddrs.delete(address);
      }
    });
  }

  if (topic.toString() === 'rawblock') {
    const blk = bitcoin.Block.fromHex(message.toString('hex'));
    const txns = blk.transactions;
    txns.forEach((txn) => {
      const invoice = interestedTxns.get(txn.getId());
      if (invoice) {
        redisClient.hmset(
          `SwapOrder:${invoice}`,
          'fundingBlockHash', blk.getId(),
          'state', 'WaitingForPayment',
          (err) => {
            if (err) {
              logger.error('updating order:', invoice);
            } else {
              logger.info(`confirmed txn ${txn.getId()} at block ${blk.getId()}`);
            }
          },
        );
        interestedTxns.delete(txn.getId());
      }
    });
  }
});

zmqSocket.connect(LNSWAP_CHAIN_ZMQ_URL);
zmqSocket.subscribe('rawtx');
zmqSocket.subscribe('rawblock');

redisSub.on('psubscribe', (pattern, count) => {
  logger.info('[psubcribe]pattern: ', pattern, ', count: ', count);
});

redisSub.on('pmessage', (pattern, channel, message) => {
  logger.debug('[pmessage]pattern: ', pattern, ', channel ', channel, ': ', message);
  if (message === 'hset') {
    const [, prefix, invoice] = channel.split(':');

    // get order from redis
    redisClient.hmget(
      `${prefix}:${invoice}`,
      'state', 'fundingTxn', 'fundingTxnIndex', 'swapAddress', 'onchainAmount',
      'swapKeyIndex', 'redeemScript', 'lnPreimage', 'onchainNetwork',
      (err, reply) => {
        if (!err) {
          if (!reply) {
            logger.error('order is NULL:', invoice);
          } else {
            const [state, fundingTxn, fundingTxnIndex, swapAddress, onchainAmount,
              swapKeyIndex, redeemScript, lnPreimage, onchainNetwork] = reply;

            // only handle order belong to this network
            if (onchainNetwork !== LNSWAP_CHAIN) return;

            // waiting for funding
            if (state === 'WaitingForFunding' && !fundingTxn) {
              interestedAddrs.set(swapAddress, { reqTokens: onchainAmount, invoice });
              logger.info(`added interestedAddr: ${swapAddress}, onchainAmount: ${onchainAmount}, invoice: ${invoice}`);

            // online txn found
            } else if (state === 'WaitingForFundingConfirmation' && fundingTxn) {
              interestedTxns.set(fundingTxn, invoice);
            } else if (state === 'WaitingForClaiming') {
              // offline payment finished
              if (!fundingTxn
                  || !fundingTxnIndex
                  || !onchainAmount
                  || !swapKeyIndex
                  || !redeemScript
                  || !lnPreimage) {
                logger.error('WaitingForClaiming: cannot get data from redis');
              } else {
                claimTransaction({
                  invoice,
                  fundingTxn,
                  fundingTxnIndex,
                  onchainAmount,
                  swapKeyIndex,
                  redeemScript,
                  lnPreimage,
                });
              }
            }
          }
        } else {
          logger.error('Cannot get order from redis:', invoice);
        }
      },
    );
  }
});

redisSub.psubscribe('__keyspace@0__:SwapOrder:*');

// Blockchain Height format used by swap service: '1254834'
setInterval(() => {
  bitcoinRpc.call('getblockcount', [], (err, res) => {
    if (err) {
      logger.error(`getblockcount(): ${err}`);
    } else {
      currentBlockHeight = res.result;
      redisClient.set(`Blockchain:${LNSWAP_CHAIN}:Height`, res.result, 'EX', BLOCK_HEIGHT_EXPIRATION);
    }
  });
}, BLOCK_HEIGHT_INTERVAL);

// Blockchain Fee Estimation JSON format used by swap service:
// {
//   feerate: '0.00001',
//   blocks:  '1'
// }
setInterval(() => {
  bitcoinRpc.call('estimatesmartfee', [1], (err, res) => {
    if (err) {
      logger.error(`estimatesmartfee(): ${err}`);
    } else {
      const fee = JSON.stringify(res.result);
      redisClient.set(`Blockchain:${LNSWAP_CHAIN}:FeeEstimation`, fee, 'EX', FEE_ESTIMATION_EXPIRATION);
    }
  });
}, FEE_ESTIMATION_INTERVAL);

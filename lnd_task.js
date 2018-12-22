const { lightningDaemon, getRoutes, pay } = require('ln-service');
const log4js = require('log4js');

const { redisClient, redisSub, updateRedisOrderAndPublish } = require('./service/redis_client.js');
const orderState = require('./service/order_state.js');

const logger = log4js.getLogger();
logger.level = 'all';

let lnd;
try {
  const { LNSWAP_LND_SOCKET, LNSWAP_LND_CERT, LNSWAP_LND_MACAROON } = process.env;
  lnd = lightningDaemon({
    socket: LNSWAP_LND_SOCKET,
    cert: LNSWAP_LND_CERT,
    macaroon: LNSWAP_LND_MACAROON,
  });
} catch (e) {
  logger.fatal('Error initialize connection with lnd:', e);
  process.exit();
}

redisSub.on('subscribe', (channel, count) => {
  logger.info(`[subcribe]channel: ${channel}, count: ${count}`);
});

redisSub.on('message', (channel, msg) => {
  logger.debug(`[message]${channel}: ${msg}`);
  if (channel !== orderState.channel) return;
  let decodedMsg;

  try {
    decodedMsg = orderState.decodeMessage(msg);
  } catch (e) {
    logger.error(`decodeMessage: ${e}`);
    return;
  }

  const {
    state, invoice, onchainNetwork, lnDestPubKey, lnAmount,
  } = decodedMsg;
  if (state === orderState.Init) {
    getRoutes({ destination: lnDestPubKey, lnd, tokens: lnAmount }, (err, routes) => {
      if (err) {
        logger.error(`getRoutes to ${lnDestPubKey}, amount: ${lnAmount}, invoice: ${invoice}, err: ${err}`);
      } else {
        // do NOT pubulish any message
        redisClient.hset(`${orderState.prefix}:${invoice}`, 'lnRoutes', JSON.stringify(routes));
        logger.info(`getRoutes to ${lnDestPubKey}, routes: ${JSON.stringify(routes)}`);
      }
    });
  } else if (state === orderState.OrderFunded) {
    // TODO: set lnPaymentLock and state before pay
    pay({ lnd, request: invoice }, (err, payResult) => {
      const refundReason = 'Lightning payment failed.';
      const newState = err ? orderState.WaitingForRefund : orderState.WaitingForClaiming;
      const lnPreimage = payResult ? payResult.secret : '';

      if (err) logger.error(`payInvoice ${invoice} failed: ${err}`);
      updateRedisOrderAndPublish(`${orderState.prefix}:${invoice}`, {
        state: newState,
        invoice,
        onchainNetwork,
        refundReason,
        lnPreimage,
      }).then(() => logger.info(`payInvoice: ${invoice}, preimage: ${lnPreimage}`))
        .catch(e => logger.error(`Error updateRedisOrderAndPublish after payInvoice: ${e}`));
    });
  }
});

redisSub.subscribe(orderState.channel);

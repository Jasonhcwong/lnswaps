const { getRoutes, payInvoice } = require('ln-service');
const log4js = require('log4js');
const { redisClient, redisSub, publishRedisMessage } = require('./service/redis_client.js');
const { lnd } = require('./service/lnd.js');
const orderState = require('./service/order_state.js');

const logger = log4js.getLogger();
logger.level = 'all';

redisSub.on('subscribe', (channel, count) => {
  logger.info(`[subcribe]channel: ${channel}, count: ${count}`);
});

redisSub.on('message', (channel, msg) => {
  logger.debug(`[message]${channel}: ${msg}`);
  if (channel !== orderState.channel) return;

  try {
    const {
      state, invoice, onchainNetwork, lnDestPubKey, lnAmount,
    } = orderState.decodeMessage(msg);

    if (state === orderState.Init) {
      getRoutes({ destination: lnDestPubKey, lnd, tokens: lnAmount }, (err, routes) => {
        if (err) {
          logger.error(`getRoutes to ${lnDestPubKey}, amount: ${lnAmount}, invoice: ${invoice}, err: ${err}`);
        } else {
          redisClient.hset(`${orderState.prefix}:${invoice}`, 'lnRoutes', JSON.stringify(routes));
          logger.info(`getRoutes to ${lnDestPubKey}, routes: ${JSON.stringify(routes)}`);
        }
      });
    } else if (state === orderState.OrderFunded) {
      // TODO: set lnPaymentLock and state before pay
      payInvoice({ lnd, invoice }, (err, payResult) => {
        const refundReason = 'Lightning payment failed.';
        let newState = orderState.WaitingForRefund;
        let lnPreimage;

        if (err) {
          redisClient.hmset(`${orderState.prefix}:${invoice}`, 'state', 'WaitingForRefund', 'refundReason', refundReason);
          logger.error(`payInvoice: ${invoice}, err: ${err}`);
        } else {
          redisClient.hmset(`${orderState.prefix}:${invoice}`, 'lnPreimage', payResult.payment_secret, 'state', 'WaitingForClaiming');
          logger.info(`payInvoice: ${invoice}, preimage: ${payResult.payment_secret}`);
          newState = orderState.WaitingForClaiming;
          lnPreimage = payResult.payment_secret;
        }
        publishRedisMessage({
          state: newState,
          invoice,
          onchainNetwork,
          refundReason,
          lnPreimage,
        });
      });
    }
  } catch (e) {
    logger.error(`encodeing msg: ${e.message}`);
  }
});

redisSub.subscribe(orderState.channel);

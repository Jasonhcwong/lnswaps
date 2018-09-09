const { getRoutes, payInvoice } = require('ln-service');
const log4js = require('log4js');
const { redisClient, redisSub, redisPub } = require('./service/redis_client.js');
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
      state, invoice, lnDestPubKey, lnAmount,
    } = orderState.decodeMessage(msg);

    if (state === orderState.Init) {
      getRoutes({ destination: lnDestPubKey, lnd, tokens: lnAmount }, (err, routes) => {
        if (err) {
          logger.error(`getRoutes to ${lnDestPubKey}, amount: ${lnAmount}, invoice: ${invoice}, err: ${err}`);
        } else {
          redisClient.hset(`SwapOrder:${invoice}`, 'lnRoutes', JSON.stringify(routes));
          logger.info(`getRoutes to ${lnDestPubKey}, routes: ${JSON.stringify(routes)}`);
        }
      });
    } else if (state === orderState.OrderFunded) {
      // TODO: set lnPaymentLock and state before pay
      payInvoice({ lnd, invoice }, (err, payResult) => {
        if (err) {
          const refundReason = 'Lightning payment failed.';
          redisClient.hmset(`SwapOrder:${invoice}`, 'state', 'WaitingForRefund', 'refundReason', refundReason);
          logger.error(`payInvoice: ${invoice}, err: ${err}`);
          try {
            const refundMsg = orderState.encodeMessage({
              invoice,
              state: orderState.WaitingForRefund,
              refundReason,
            });
            redisPub.publish(orderState.channel, refundMsg);
          } catch (e) {
            logger.error(`encodeing msg: ${e.message}`);
          }
        } else {
          redisClient.hmset(`SwapOrder:${invoice}`, 'lnPreimage', payResult.payment_secret, 'state', 'WaitingForClaiming');
          logger.info(`payInvoice: ${invoice}, preimage: ${payResult.payment_secret}`);
          try {
            const claimMsg = orderState.encodeMessage({
              invoice,
              state: orderState.WaitingForClaiming,
            });
            redisPub.publish(orderState.channel, claimMsg);
          } catch (e) {
            logger.error(`encodeing msg: ${e.message}`);
          }
        }
      });
    }
  } catch (e) {
    logger.error(`encodeing msg: ${e.message}`);
  }
});

redisSub.subscribe(orderState.channel);

const { getRoutes, payInvoice } = require('ln-service');
const log4js = require('log4js');
const { redisClient, redisSub } = require('./service/redis_client.js');
const { lnd } = require('./service/lnd.js');

const logger = log4js.getLogger();
logger.level = 'all';

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
      'state', 'lnDestPubKey', 'lnAmount', 'lnRoutes',
      (err, reply) => {
        if (err) {
          logger.error('Cannot get order from redis:', invoice);
          return;
        }

        if (!reply) {
          logger.error('order is NULL:', invoice);
          return;
        }

        const [state, lnDestPubKey, lnAmount, lnRoutes] = reply;

        if (state === 'Init' && lnDestPubKey && lnAmount && !lnRoutes) {
          getRoutes({ destination: lnDestPubKey, lnd, tokens: lnAmount }, (routeErr, routes) => {
            if (routeErr) {
              logger.error(`getRoutes to ${lnDestPubKey}, amount: ${lnAmount}, invoice: ${invoice}, err: ${routeErr}`);
            } else {
              redisClient.hset(`${prefix}:${invoice}`, 'lnRoutes', JSON.stringify(routes));
              logger.info(`getRoutes to ${lnDestPubKey}, routes: ${JSON.stringify(routes)}`);
            }
          });
        } else if (state === 'WaitingForPayment') {
          // TODO: set lnPaymentLock and state before pay
          payInvoice({ lnd, invoice }, (invoiceErr, payResult) => {
            if (invoiceErr) {
              logger.error(`payInvoice: ${invoice}, err: ${invoiceErr}`);
              redisClient.hmset(`${prefix}:${invoice}`, 'state', 'WaitingForRefund');
            } else {
              redisClient.hmset(`${prefix}:${invoice}`, 'lnPreimage', payResult.payment_secret, 'state', 'WaitingForClaiming');
              logger.info(`payInvoice: ${invoice}, preimage: ${payResult.payment_secret}`);
            }
          });
        }
      },
    );
  }
});

redisSub.psubscribe('__keyspace@0__:SwapOrder:*');

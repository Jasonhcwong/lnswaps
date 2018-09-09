const redis = require('redis');
const log4js = require('log4js');

const orderState = require('./order_state');

const logger = log4js.getLogger();
logger.level = 'all';

const { LNSWAP_REDIS_URL } = process.env; if (!LNSWAP_REDIS_URL) {
  logger.fatal('Please set environment variable LNSWAP_REDIS_URL.');
  process.exit();
}

const redisPub = redis.createClient(LNSWAP_REDIS_URL);
const redisSub = redis.createClient(LNSWAP_REDIS_URL);
const redisClient = redis.createClient(LNSWAP_REDIS_URL);

redisSub.on('error', (err) => {
  logger.fatal('Redis Error ', err);
  process.exit();
});

redisClient.on('error', (err) => {
  logger.fatal('Redis Error ', err);
  process.exit();
});

function updateRedisOrder({ key, newState, params }) {
  redisClient.hmset(key, 'state', newState, params, (err) => {
    if (err) {
      logger.error(`updating order state: ${err}`);
    }
  });
}

function publishRedisMessage(params) {
  try {
    const msg = orderState.encodeMessage(params);
    redisPub.publish(orderState.channel, msg);
  } catch (e) {
    logger.error(`encodeing msg: ${e.message}`);
  }
}

module.exports = {
  redisPub,
  redisSub,
  redisClient,
  updateRedisOrder,
  publishRedisMessage,
};

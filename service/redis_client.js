const redis = require('redis');
const log4js = require('log4js');
const { promisify } = require('util');

const orderState = require('./order_state');

const logger = log4js.getLogger();
logger.level = 'all';

const { LNSWAP_REDIS_URL } = process.env;
if (!LNSWAP_REDIS_URL) {
  logger.fatal('Please set environment variable LNSWAP_REDIS_URL.');
  process.exit();
}

const redisPub = redis.createClient(LNSWAP_REDIS_URL);
const redisSub = redis.createClient(LNSWAP_REDIS_URL);
const redisClient = redis.createClient(LNSWAP_REDIS_URL);

const hmsetAsync = promisify(redisClient.hmset).bind(redisClient);
const publishAsync = promisify(redisPub.publish).bind(redisPub);

redisPub.on('error', (err) => {
  logger.fatal('Redis Error ', err);
  process.exit();
});

redisSub.on('error', (err) => {
  logger.fatal('Redis Error ', err);
  process.exit();
});

redisClient.on('error', (err) => {
  logger.fatal('Redis Error ', err);
  process.exit();
});

function updateRedisOrderAndPublish(orderKey, params) {
  const paramArray = [];
  Object.keys(params).forEach(key => paramArray.push(key, params[key]));
  // TODO: lock order before updating
  return hmsetAsync(orderKey, paramArray)
    .then(() => publishAsync(orderState.channel, orderState.encodeMessage(params)));
}

function publishRedisMessage(params) {
  return publishAsync(orderState.channel, orderState.encodeMessage(params));
}

function redisQuit() {
  redisSub.unsubscribe();
  redisSub.quit();
  redisPub.quit();
  redisClient.quit();
}

module.exports = {
  redisPub,
  redisSub,
  redisClient,
  updateRedisOrderAndPublish,
  publishRedisMessage,
  redisQuit,
  ReplyError: redis.ReplyError,
};

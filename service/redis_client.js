const redis = require('redis');
const log4js = require('log4js');

const logger = log4js.getLogger();
logger.level = 'all';

const { LNSWAP_REDIS_URL } = process.env;
if (!LNSWAP_REDIS_URL) {
  logger.fatal('Please set environment variable LNSWAP_REDIS_URL.');
  process.exit();
}

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

module.exports = {
  redisClient,
  redisSub,
};

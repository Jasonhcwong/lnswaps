const { redisClient } = require('./redis_client');

module.exports = (cbk) => {
  redisClient.mget('SwapFees', 'PriceTicker:BTCUSD', 'PriceTicker:LTCUSD',
    'PriceTicker:ETHUSD', 'PriceTicker:LTCBTC', 'PriceTicker:ETHBTC',
    (err, replies) => {
      if (err || replies.includes(null)) {
        return cbk([400, 'Error getting exchange rates']);
      }
      const json = {
        fees: JSON.parse(replies[0]),
        BTCUSD: JSON.parse(replies[1]).last,
        LTCUSD: JSON.parse(replies[2]).last,
        ETHUSD: JSON.parse(replies[3]).last,
        LTCBTC: JSON.parse(replies[4]).bidPrice,
        ETHBTC: JSON.parse(replies[5]).bidPrice,
      };
      return cbk(null, json);
    });
};

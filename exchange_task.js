const fetch = require('node-fetch');
const log4js = require('log4js');
const { redisClient } = require('./service/redis_client.js');

const logger = log4js.getLogger();
logger.level = 'all';

const CRYPTO_TICKER_EXPIRATION = 5;
const CRYPTO_FETCH_INTERVAL = 2000;
const FIAT_TICKER_EXPIRATION = 12;
const FIAT_FETCH_INTERVAL = 5000;

// cryptocurrency price ticker from Binance, https://github.com/binance-exchange/binance-official-api-docs/blob/master/rest-api.md
// Response:
//   {
//     symbol:  'LTCBTC',
//     bidPrie: '4.00000000',
//     bidQty:  '431.00000000',
//     askPrie: '4.00000200',
//     askQty:  '9.00000000'
//   }

// cryptocurrency price ticker format used by swap service:
// {
//   symbol:   'LTCBTC',
//   bidPrice: '4.00000000',
//   bidQty:   '431.00000000',
//   askPrice: '4.00000200',
//   askQty:   '9.00000000'
// }

setInterval(() => {
  fetch('https://www.binance.com/api/v3/ticker/bookTicker?symbol=LTCBTC')
    .then((res) => { if (res.status === 200) return res.text(); return 'Cannot get LTCBTC price'; })
    .then(body => redisClient.set('PriceTicker:LTCBTC', body, 'EX', CRYPTO_TICKER_EXPIRATION))
    .catch(error => logger.error('PriceTicker:LTCBTC,', error));

  fetch('https://www.binance.com/api/v3/ticker/bookTicker?symbol=ETHBTC')
    .then((res) => { if (res.status === 200) return res.text(); return 'Cannot get ETHBTC price'; })
    .then(body => redisClient.set('PriceTicker:ETHBTC', body, 'EX', CRYPTO_TICKER_EXPIRATION))
    .catch(error => logger.error('PriceTicker:ETHBTC,', error));
}, CRYPTO_FETCH_INTERVAL);


// fiat price ticker from Bitstamp, https://www.bitstamp.net/api/
// Response (JSON)
//   last      Last BTC price.
//   high      Last 24 hours price high.
//   low       Last 24 hours price low.
//   vwap      Last 24 hours volume weighted average price.
//   volume    Last 24 hours volume.
//   bid       Highest buy order.
//   ask       Lowest sell order.
//   timestamp Unix timestamp date and time.
//   open      First price of the day.

// fiat price ticker JSON format used by swap service:
//   {
//     symbol: 'BTCUSD',
//     last:   '1000000'
//   }

setInterval(() => {
  fetch('https://www.bitstamp.net/api/v2/ticker/btcusd/')
    .then((res) => { if (res.status === 200) return res.json(); return 'Cannot get BTCUSD price'; })
    .then(body => redisClient.set('PriceTicker:BTCUSD', JSON.stringify({ symbol: 'BTCUSD', last: body.last }), 'EX', FIAT_TICKER_EXPIRATION))
    .catch(error => logger.error('PriceTicker:BTCUSD,', error));

  fetch('https://www.bitstamp.net/api/v2/ticker/ltcusd/')
    .then((res) => { if (res.status === 200) return res.json(); return 'Cannot get LTCUSD price'; })
    .then(body => redisClient.set('PriceTicker:LTCUSD', JSON.stringify({ symbol: 'LTCUSD', last: body.last }), 'EX', FIAT_TICKER_EXPIRATION))
    .catch(error => logger.error('PriceTicker:LTCUSD,', error));

  fetch('https://www.bitstamp.net/api/v2/ticker/ethusd/')
    .then((res) => { if (res.status === 200) return res.json(); return 'Cannot get ETHUSD price'; })
    .then(body => redisClient.set('PriceTicker:ETHUSD', JSON.stringify({ symbol: 'ETHUSD', last: body.last }), 'EX', FIAT_TICKER_EXPIRATION))
    .catch(error => logger.error('PriceTicker:ETHUSD,', error));
}, FIAT_FETCH_INTERVAL);

const { log } = console;

const { validateMnemonic } = require('bip39');
const browserify = require('browserify-middleware');
const compression = require('compression');
const cors = require('cors');
const express = require('express');
const { hidePoweredBy } = require('helmet');
const morgan = require('morgan');
const serveFavicon = require('serve-favicon');
const walnut = require('walnut');

const apiRouter = require('./routers/api');

const { NODE_ENV } = process.env;
const { LNSWAP_PORT } = process.env;
const { PORT } = process.env;

const { LNSWAP_CLAIM_BIP39_SEED } = process.env;
if (!validateMnemonic(LNSWAP_CLAIM_BIP39_SEED)) {
  console.log([500, 'ExpectedValidMnemonic']);
  process.exit();
}

const browserifyPath = `${__dirname}/public/browserify/index.js`;
const isProduction = NODE_ENV === 'production';
const morganLogLevel = 'dev';
const port = PORT || LNSWAP_PORT || 9889;

const app = express();

app.use(hidePoweredBy());
app.use(compression());
app.use(cors());
app.get('/js/blockchain.js', browserify(browserifyPath));
app.use(serveFavicon(`${__dirname}/public/favicon.ico`));
app.use(express.static('public'));
app.use(morgan(morganLogLevel));
app.set('view engine', 'pug');
app.get('/', ({ path }, res) => res.render('index', { path }));
app.use('/api/v0', apiRouter());
app.get('/refund', ({ path }, res) => res.render('refund', { path }));

app.listen(port, () => log(`Server listening on port ${port}.`));

if (!isProduction) {
  walnut.check(require('./package'));
}

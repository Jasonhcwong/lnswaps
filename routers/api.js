const bodyParser = require('body-parser');
const { Router } = require('express');

const { checkSwapStatus } = require('./../service');
const { createSwap } = require('./../service');
const { getExchangeRates } = require('./../service');
const { getInvoiceDetails } = require('./../service');

const badRequestCode = 400;

function marshResponse(err, result, res) {
  const [errCode, errMessage] = err || [];
  if (errCode && errCode !== badRequestCode) {
    console.log(errMessage);
  }
  return err ? res.status(errCode).send(errMessage) : res.json(result);
}

/** Make an api router

  {
  }

  @returns
  <Router Object>
*/
module.exports = () => {
  const router = Router({ caseSensitive: true });

  router.use(bodyParser.json());

  // GET exchange rate information
  router.get('/exchange_rates/', (err, res) => getExchangeRates((err2, result) => marshResponse(err2, result, res)));

  // GET details about an invoice
  router.get('/invoice_details/:network/:invoice', ({ params }, res) => getInvoiceDetails({
    invoice: params.invoice,
    network: params.network,
  }, (err, result) => marshResponse(err, result, res)));

  // POST a new swap
  router.post('/swaps/', ({ body }, res) => createSwap({
    invoice: body.invoice,
    network: body.network,
    refund: body.refund,
  }, (err, result) => marshResponse(err, result, res)));

  // POST a swap check request
  router.post('/swaps/check', ({ body }, res) => checkSwapStatus({
    invoice: body.invoice,
    network: body.network,
    script: body.redeem_script,
  }, (err, result) => marshResponse(err, result, res)));

  return router;
};

const async = require('async');
const log4js = require('log4js');
const { redisClient } = require('./redis_client');

const logger = log4js.getLogger();
logger.level = 'all';

/** Check the status of a swap

  This will attempt to execute the swap if it detects a funded swap.

  {
    invoice: <Lightning Invoice String>
    network: <Network Name String>
    script: <Redeem Script Hex String>
  }

  @returns via cbk
  {
    [output_index]: <Output Index Of Funding Output Number>
    [output_tokens]: <Output Tokens Value For Funding Output Number>
    [payment_secret]: <Payment Secret Hex String> // With claim present
    transaction_id: <Funding Transaction Id Hex String>
  }
*/
module.exports = ({ invoice, network, script }, cbk) => {
  async.auto({
    getOrderFromDB: (gcbk) => {
      if (!invoice) {
        return cbk([400, 'ExpectedInvoice']);
      }

      if (!network) {
        return cbk([400, 'ExpectedNetwork']);
      }

      if (!network.startsWith('eth') && !script) {
        return cbk([400, 'ExpectedRedeemScript']);
      }

      redisClient.hmget(
        `SwapOrder:${invoice}`,
        'fundingTxn', 'onchainAmount', 'lnPreimage', 'fundingTxnIndex',
        (err, reply) => {
          if (err) return gcbk([400, 'ErrorGettingOrderFromDatabase']);
          const [fundingTxn, onchainAmount, lnPreimage, fundingTxnIndex] = reply;
          return gcbk(null, {
            output_index: fundingTxnIndex || 0,
            output_tokens: onchainAmount,
            payment_secret: lnPreimage,
            transaction_id: fundingTxn,
            conf_wait_count: 1,
          });
        },
      );
    },
  }, (err, result) => {
    if (err) {
      logger.error('Getting order from redis', err);
      return cbk(err);
    }
    return cbk(null, result.getOrderFromDB);
  });
};

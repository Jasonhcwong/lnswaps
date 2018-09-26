const assert = require('assert');
const orderState = require('../service/order_state');

const { redisSub, updateRedisOrderAndPublish, redisQuit } = require('../service/redis_client');

const lnDestPubKey = 'myLnDestPubKey';
const lnAmount = '100000';
const lnPaymentHash = '9145319a403efa020b135bc03cb5d48bb49a9cb5d15249267a408d85a90de3bc';
const lnPreimage = '257c734425dd83f583343a1611cc663af4dd888af75448d6ca8f518ef79af341';
const invoice = 'lntb1m1pde2qzmpp5j9znrxjq8maqyzcnt0qredw53w6f489469fyjfn6gzxct2gduw7qdqqcqzyszv7ex5mhchnhtg42xaxxe9retlm8ktu96hwjna25qaaqcqfwytfxvydz4sl5dlz86akxk5c8yu6fntwt8qswhldyzkdka6f3ffjjceqqq0mlav';

const onchainNetwork = 'eth_rinkeby';
const onchainAmount = '2130000';
const swapAddress = '0x3427f002e69500189b4c6c11dca68b9447f98ad3';
const fundingTxn = '0x54f3087140aeb894512cb698312237c05d8c7290e9abe9762b2705841ae4f416';
const fundingTxnIndex = '0';
const fundingBlockHash = '0x1d495aa6c99311111fd89cbc6c52c40b50ca1e88c879e2999399c4e2054ef5af';
const claimingTxn = '0x54f308714024b894512cb698312237c05d8c7290e9abe9762b2705841ae4f416';
const claimingBlockHash = '0x1d495a56c89311111fd89cbc6c52c40b50ca1e88c879e2999399c4e2054ef5af';
const refundReason = 'TestRefund';
const refundTxn = '0x54f308714024b894512cb698312237c05d8c7290e9abe9762b2705841ae4f416';
const refundBlockHash = '0x1d495a56c89311111fd89cbc6c52c40b50ca1e88c879e2999399c4e2054ef5af';

redisSub.subscribe(orderState.channel);

describe('Redis', () => {
  it('[Redis]updateRedisOrderAndPublish: catch error', (done) => {
    updateRedisOrderAndPublish('TestKey:error', {
      state: orderState.OrderRefunded,
      invoice: undefined,
      onchainNetwork,
      refundTxn,
      refundBlockHash,
    }).then(() => assert.fail('failed to catch Error.'))
      .catch((e) => {
        if (e.message === orderState.errorInvoiceMissing) return done();
        return assert.fail('Unexpected error.');
      });
  });

  it('[Redis]updateRedisOrderAndPublish: Init', (done) => {
    redisSub.on('message', (channel, msg) => {
      if (channel !== orderState.channel) return;

      const ret = orderState.decodeMessage(msg);
      if (ret.state !== orderState.Init) return;

      assert.strictEqual(ret.invoice, invoice);
      assert.strictEqual(ret.onchainNetwork, onchainNetwork);
      assert.strictEqual(ret.lnDestPubKey, lnDestPubKey);
      assert.strictEqual(ret.lnAmount, lnAmount);

      done();
    });


    updateRedisOrderAndPublish(`TestKey:${orderState.Init}`, {
      state: orderState.Init,
      invoice,
      onchainNetwork,
      lnDestPubKey,
      lnAmount,
    }).catch(() => assert.fail('failed.'));
  });

  it('[Redis]updateRedisOrderAndPublish: WaitingForFunding', (done) => {
    redisSub.on('message', (channel, msg) => {
      if (channel !== orderState.channel) return;

      const ret = orderState.decodeMessage(msg);
      if (ret.state !== orderState.WaitingForFunding) return;

      assert.strictEqual(ret.state, orderState.WaitingForFunding);
      assert.strictEqual(ret.invoice, invoice);
      assert.strictEqual(ret.onchainNetwork, onchainNetwork);
      assert.strictEqual(ret.onchainAmount, onchainAmount);
      assert.strictEqual(ret.swapAddress, swapAddress);
      assert.strictEqual(ret.lnPaymentHash, lnPaymentHash);

      done();
    });


    updateRedisOrderAndPublish(`TestKey:${orderState.WaitingForFunding}`, {
      state: orderState.WaitingForFunding,
      invoice,
      onchainNetwork,
      onchainAmount,
      swapAddress,
      lnPaymentHash,
    }).catch(() => assert.fail('failed.'));
  });

  it('[Redis]updateRedisOrderAndPublish: WaitingForFundingConfirmation', (done) => {
    redisSub.on('message', (channel, msg) => {
      if (channel !== orderState.channel) return;

      const ret = orderState.decodeMessage(msg);
      if (ret.state !== orderState.WaitingForFundingConfirmation) return;

      assert.strictEqual(ret.state, orderState.WaitingForFundingConfirmation);
      assert.strictEqual(ret.invoice, invoice);
      assert.strictEqual(ret.onchainNetwork, onchainNetwork);
      assert.strictEqual(ret.fundingTxn, fundingTxn);
      assert.strictEqual(ret.fundingTxnIndex, fundingTxnIndex);

      done();
    });

    updateRedisOrderAndPublish(`TestKey:${orderState.WaitingForFundingConfirmation}`, {
      state: orderState.WaitingForFundingConfirmation,
      invoice,
      onchainNetwork,
      fundingTxn,
      fundingTxnIndex,
    }).catch(() => assert.fail('failed.'));
  });

  it('[Redis]updateRedisOrderAndPublish: OrderFunded', (done) => {
    redisSub.on('message', (channel, msg) => {
      if (channel !== orderState.channel) return;

      const ret = orderState.decodeMessage(msg);
      if (ret.state !== orderState.OrderFunded) return;

      assert.strictEqual(ret.state, orderState.OrderFunded);
      assert.strictEqual(ret.invoice, invoice);
      assert.strictEqual(ret.onchainNetwork, onchainNetwork);
      assert.strictEqual(ret.fundingTxn, fundingTxn);
      assert.strictEqual(ret.fundingBlockHash, fundingBlockHash);

      done();
    });

    updateRedisOrderAndPublish(`TestKey:${orderState.OrderFunded}`, {
      state: orderState.OrderFunded,
      invoice,
      onchainNetwork,
      fundingTxn,
      fundingBlockHash,
    }).catch(() => assert.fail('failed.'));
  });

  it('[Redis]updateRedisOrderAndPublish: WaitingForClaiming', (done) => {
    redisSub.on('message', (channel, msg) => {
      if (channel !== orderState.channel) return;

      const ret = orderState.decodeMessage(msg);
      if (ret.state !== orderState.WaitingForClaiming) return;

      assert.strictEqual(ret.state, orderState.WaitingForClaiming);
      assert.strictEqual(ret.invoice, invoice);
      assert.strictEqual(ret.onchainNetwork, onchainNetwork);
      assert.strictEqual(ret.lnPreimage, lnPreimage);

      done();
    });

    updateRedisOrderAndPublish(`TestKey:${orderState.WaitingForClaiming}`, {
      state: orderState.WaitingForClaiming,
      invoice,
      onchainNetwork,
      lnPreimage,
    }).catch(() => assert.fail('failed.'));
  });

  it('[Redis]updateRedisOrderAndPublish: WaitingForClaimingConfirmation', (done) => {
    redisSub.on('message', (channel, msg) => {
      if (channel !== orderState.channel) return;

      const ret = orderState.decodeMessage(msg);
      if (ret.state !== orderState.WaitingForClaimingConfirmation) return;

      assert.strictEqual(ret.state, orderState.WaitingForClaimingConfirmation);
      assert.strictEqual(ret.invoice, invoice);
      assert.strictEqual(ret.onchainNetwork, onchainNetwork);
      assert.strictEqual(ret.claimingTxn, claimingTxn);

      done();
    });

    updateRedisOrderAndPublish(`TestKey:${orderState.WaitingForClaimingConfirmation}`, {
      state: orderState.WaitingForClaimingConfirmation,
      invoice,
      onchainNetwork,
      claimingTxn,
    }).catch(() => assert.fail('failed.'));
  });

  it('[Redis]updateRedisOrderAndPublish: OrderClaimed', (done) => {
    redisSub.on('message', (channel, msg) => {
      if (channel !== orderState.channel) return;

      const ret = orderState.decodeMessage(msg);
      if (ret.state !== orderState.OrderClaimed) return;

      assert.strictEqual(ret.state, orderState.OrderClaimed);
      assert.strictEqual(ret.invoice, invoice);
      assert.strictEqual(ret.onchainNetwork, onchainNetwork);
      assert.strictEqual(ret.claimingTxn, claimingTxn);
      assert.strictEqual(ret.claimingBlockHash, claimingBlockHash);

      done();
    });

    updateRedisOrderAndPublish(`TestKey:${orderState.OrderClaimed}`, {
      state: orderState.OrderClaimed,
      invoice,
      onchainNetwork,
      claimingTxn,
      claimingBlockHash,
    }).catch(() => assert.fail('failed.'));
  });

  it('[Redis]updateRedisOrderAndPublish: WaitingForRefund', (done) => {
    redisSub.on('message', (channel, msg) => {
      if (channel !== orderState.channel) return;

      const ret = orderState.decodeMessage(msg);
      if (ret.state !== orderState.WaitingForRefund) return;

      assert.strictEqual(ret.state, orderState.WaitingForRefund);
      assert.strictEqual(ret.invoice, invoice);
      assert.strictEqual(ret.onchainNetwork, onchainNetwork);
      assert.strictEqual(ret.refundReason, refundReason);

      done();
    });

    updateRedisOrderAndPublish(`TestKey:${orderState.WaitingForRefund}`, {
      state: orderState.WaitingForRefund,
      invoice,
      onchainNetwork,
      refundReason,
    }).catch(() => assert.fail('failed.'));
  });

  it('[Redis]updateRedisOrderAndPublish: WaitingForRefundConfirmation', (done) => {
    redisSub.on('message', (channel, msg) => {
      if (channel !== orderState.channel) return;

      const ret = orderState.decodeMessage(msg);
      if (ret.state !== orderState.WaitingForRefundConfirmation) return;

      assert.strictEqual(ret.state, orderState.WaitingForRefundConfirmation);
      assert.strictEqual(ret.invoice, invoice);
      assert.strictEqual(ret.onchainNetwork, onchainNetwork);
      assert.strictEqual(ret.refundTxn, refundTxn);

      done();
    });

    updateRedisOrderAndPublish(`TestKey:${orderState.WaitingForRefundConfirmation}`, {
      state: orderState.WaitingForRefundConfirmation,
      invoice,
      onchainNetwork,
      refundTxn,
    }).catch(() => assert.fail('failed.'));
  });

  it('[Redis]updateRedisOrderAndPublish: OrderRefunded', (done) => {
    redisSub.on('message', (channel, msg) => {
      if (channel !== orderState.channel) return;

      const ret = orderState.decodeMessage(msg);
      if (ret.state !== orderState.OrderRefunded) return;

      assert.strictEqual(ret.state, orderState.OrderRefunded);
      assert.strictEqual(ret.invoice, invoice);
      assert.strictEqual(ret.onchainNetwork, onchainNetwork);
      assert.strictEqual(ret.refundTxn, refundTxn);
      assert.strictEqual(ret.refundBlockHash, refundBlockHash);

      redisQuit();
      done();
    });

    updateRedisOrderAndPublish(`TestKey:${orderState.OrderRefunded}`, {
      state: orderState.OrderRefunded,
      invoice,
      onchainNetwork,
      refundTxn,
      refundBlockHash,
    }).catch(() => assert.fail('failed.'));
  });
});

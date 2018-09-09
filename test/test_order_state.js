const assert = require('assert');

const orderState = require('./../service/order_state.js');

const lnDestPubKey = 'myLnDestPubKey';
const lnAmount = '100000';
const lnPaymentHash = '9145319a403efa020b135bc03cb5d48bb49a9cb5d15249267a408d85a90de3bc';
const lnPreimage = '257c734425dd83f583343a1611cc663af4dd888af75448d6ca8f518ef79af341';
const invoice = 'lntb1m1pde2qzmpp5j9znrxjq8maqyzcnt0qredw53w6f489469fyjfn6gzxct2gduw7qdqqcqzyszv7ex5mhchnhtg42xaxxe9retlm8ktu96hwjna25qaaqcqfwytfxvydz4sl5dlz86akxk5c8yu6fntwt8qswhldyzkdka6f3ffjjceqqq0mlav';

const onchainNetwork = 'eth_rinkeby';
const onchainAmount = '2130000';
const swapAddress = '0x3427f002e69500189b4c6c11dca68b9447f98ad3';
const fundingTxn = '0x54f3087140aeb894512cb698312237c05d8c7290e9abe9762b2705841ae4f416';
const fundingBlockHash = '0x1d495aa6c99311111fd89cbc6c52c40b50ca1e88c879e2999399c4e2054ef5af';
const claimingTxn = '0x54f308714024b894512cb698312237c05d8c7290e9abe9762b2705841ae4f416';
const claimingBlockHash = '0x1d495a56c89311111fd89cbc6c52c40b50ca1e88c879e2999399c4e2054ef5af';
const refundReason = 'TestRefund';
const refundTxn = '0x54f308714024b894512cb698312237c05d8c7290e9abe9762b2705841ae4f416';
const refundBlockHash = '0x1d495a56c89311111fd89cbc6c52c40b50ca1e88c879e2999399c4e2054ef5af';

describe('Order State Tests', () => {
  it('[OrderState]encodeMessage: errorInvoiceMissing', (done) => {
    try {
      orderState.encodeMessage({ });
    } catch (e) {
      if (e.message === orderState.errorInvoiceMissing) done();
    }
    assert.fail('No error caught.');
  });

  it('[OrderState]encodeMessage: errorUnknownOrderState', (done) => {
    try {
      orderState.encodeMessage({ invoice, state: 'Unknow state', onchainNetwork });
    } catch (e) {
      if (e.message === orderState.errorUnknownOrderState) done();
    }
    assert.fail('No error caught.');
  });

  it('[OrderState]encodeMessage: errorIncompleteParameters', (done) => {
    try {
      orderState.encodeMessage({ invoice, state: orderState.OrderFunded, fundingTxn });
    } catch (e) {
      if (e.message === orderState.errorIncompleteParameters) done();
    }
    assert.fail('No error caught.');
  });

  it('[OrderState]decodeMessage: errorEmptyMessage', (done) => {
    try {
      orderState.decodeMessage();
    } catch (e) {
      if (e.message === orderState.errorEmptyMessage) done();
    }
    assert.fail('No error caught.');
  });

  it('[OrderState]decodeMessage: errorInvoiceMissing', (done) => {
    try {
      orderState.decodeMessage('This is a malformed message');
    } catch (e) {
      if (e.message === orderState.errorInvoiceMissing) done();
    }
    assert.fail('No error caught.');
  });

  it('[OrderState]decodeMessage: errorUnknownOrderState', (done) => {
    try {
      orderState.decodeMessage('UnknowState:invoice:onchainNetwork');
    } catch (e) {
      if (e.message === orderState.errorUnknownOrderState) done();
    }
    assert.fail('No error caught.');
  });

  it('[OrderState]decodeMessage: errorIncompleteParameters', (done) => {
    try {
      orderState.decodeMessage('OrderFunded:invoice:fundTxn');
    } catch (e) {
      if (e.message === orderState.errorIncompleteParameters) done();
    }
    assert.fail('No error caught.');
  });

  it('[OrderState]encodeMessage and decodeMessage: Init', (done) => {
    const ret = orderState.decodeMessage(orderState.encodeMessage({
      state: orderState.Init,
      invoice,
      onchainNetwork,
      lnDestPubKey,
      lnAmount,
    }));
    assert.strictEqual(ret.state, orderState.Init);
    assert.strictEqual(ret.invoice, invoice);
    assert.strictEqual(ret.onchainNetwork, onchainNetwork);
    assert.strictEqual(ret.lnDestPubKey, lnDestPubKey);
    assert.strictEqual(ret.lnAmount, lnAmount);
    done();
  });

  it('[OrderState]encodeMessage and decodeMessage: WaitingForFunding', (done) => {
    const ret = orderState.decodeMessage(orderState.encodeMessage({
      state: orderState.WaitingForFunding,
      invoice,
      onchainNetwork,
      onchainAmount,
      swapAddress,
      lnPaymentHash,
    }));
    assert.strictEqual(ret.state, orderState.WaitingForFunding);
    assert.strictEqual(ret.invoice, invoice);
    assert.strictEqual(ret.onchainNetwork, onchainNetwork);
    assert.strictEqual(ret.onchainAmount, onchainAmount);
    assert.strictEqual(ret.swapAddress, swapAddress);
    assert.strictEqual(ret.lnPaymentHash, lnPaymentHash);
    done();
  });

  it('[OrderState]encodeMessage and decodeMessage: WaitingForFundingConfirmation', (done) => {
    const ret = orderState.decodeMessage(orderState.encodeMessage({
      state: orderState.WaitingForFundingConfirmation,
      invoice,
      onchainNetwork,
      fundingTxn,
    }));
    assert.strictEqual(ret.state, orderState.WaitingForFundingConfirmation);
    assert.strictEqual(ret.invoice, invoice);
    assert.strictEqual(ret.onchainNetwork, onchainNetwork);
    assert.strictEqual(ret.fundingTxn, fundingTxn);
    done();
  });

  it('[OrderState]encodeMessage and decodeMessage: OrderFunded', (done) => {
    const ret = orderState.decodeMessage(orderState.encodeMessage({
      state: orderState.OrderFunded,
      invoice,
      onchainNetwork,
      fundingTxn,
      fundingBlockHash,
    }));
    assert.strictEqual(ret.state, orderState.OrderFunded);
    assert.strictEqual(ret.invoice, invoice);
    assert.strictEqual(ret.onchainNetwork, onchainNetwork);
    assert.strictEqual(ret.fundingTxn, fundingTxn);
    assert.strictEqual(ret.fundingBlockHash, fundingBlockHash);
    done();
  });

  it('[OrderState]encodeMessage and decodeMessage: WaitingForClaiming', (done) => {
    const ret = orderState.decodeMessage(orderState.encodeMessage({
      state: orderState.WaitingForClaiming,
      invoice,
      onchainNetwork,
      lnPreimage,
    }));
    assert.strictEqual(ret.state, orderState.WaitingForClaiming);
    assert.strictEqual(ret.invoice, invoice);
    assert.strictEqual(ret.onchainNetwork, onchainNetwork);
    assert.strictEqual(ret.lnPreimage, lnPreimage);
    done();
  });

  it('[OrderState]encodeMessage and decodeMessage: WaitingForClaimingConfirmation', (done) => {
    const ret = orderState.decodeMessage(orderState.encodeMessage({
      state: orderState.WaitingForClaimingConfirmation,
      invoice,
      onchainNetwork,
      claimingTxn,
    }));
    assert.strictEqual(ret.state, orderState.WaitingForClaimingConfirmation);
    assert.strictEqual(ret.invoice, invoice);
    assert.strictEqual(ret.onchainNetwork, onchainNetwork);
    assert.strictEqual(ret.claimingTxn, claimingTxn);
    done();
  });

  it('[OrderState]encodeMessage and decodeMessage: OrderClaimed', (done) => {
    const ret = orderState.decodeMessage(orderState.encodeMessage({
      state: orderState.OrderClaimed,
      invoice,
      onchainNetwork,
      claimingTxn,
      claimingBlockHash,
    }));
    assert.strictEqual(ret.state, orderState.OrderClaimed);
    assert.strictEqual(ret.invoice, invoice);
    assert.strictEqual(ret.onchainNetwork, onchainNetwork);
    assert.strictEqual(ret.claimingTxn, claimingTxn);
    assert.strictEqual(ret.claimingBlockHash, claimingBlockHash);
    done();
  });

  it('[OrderState]encodeMessage and decodeMessage: WaitingForRefund', (done) => {
    const ret = orderState.decodeMessage(orderState.encodeMessage({
      state: orderState.WaitingForRefund,
      invoice,
      onchainNetwork,
      refundReason,
    }));
    assert.strictEqual(ret.state, orderState.WaitingForRefund);
    assert.strictEqual(ret.invoice, invoice);
    assert.strictEqual(ret.onchainNetwork, onchainNetwork);
    assert.strictEqual(ret.refundReason, refundReason);
    done();
  });

  it('[OrderState]encodeMessage and decodeMessage: WaitingForRefundConfirmation', (done) => {
    const ret = orderState.decodeMessage(orderState.encodeMessage({
      state: orderState.WaitingForRefundConfirmation,
      invoice,
      onchainNetwork,
      refundTxn,
    }));
    assert.strictEqual(ret.state, orderState.WaitingForRefundConfirmation);
    assert.strictEqual(ret.invoice, invoice);
    assert.strictEqual(ret.onchainNetwork, onchainNetwork);
    assert.strictEqual(ret.refundTxn, refundTxn);
    done();
  });

  it('[OrderState]encodeMessage and decodeMessage: OrderRefunded', (done) => {
    const ret = orderState.decodeMessage(orderState.encodeMessage({
      state: orderState.OrderRefunded,
      invoice,
      onchainNetwork,
      refundTxn,
      refundBlockHash,
    }));
    assert.strictEqual(ret.state, orderState.OrderRefunded);
    assert.strictEqual(ret.invoice, invoice);
    assert.strictEqual(ret.onchainNetwork, onchainNetwork);
    assert.strictEqual(ret.refundTxn, refundTxn);
    assert.strictEqual(ret.refundBlockHash, refundBlockHash);
    done();
  });
});

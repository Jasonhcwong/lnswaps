const orderState = {
  Init: 'Init',

  WaitingForFunding: 'WaitingForFunding',
  WaitingForFundingConfirmation: 'WaitingForFundingConfirmation',
  OrderFunded: 'OrderFunded',

  WaitingForClaiming: 'WaitingForClaiming',
  WaitingForClaimingConfirmation: 'WaitingForClaimingConfirmation',
  OrderClaimed: 'OrderClaimed',

  WaitingForRefund: 'WaitingForRefund',
  WaitingForRefundConfirmation: 'WaitingForRefundConfirmation',
  OrderRefunded: 'OrderRefunded',
};

const errorIncompleteParameters = 'Incomplete parameters.';
const errorInvoiceMissing = 'invoice is missing.';
const errorUnknownOrderState = 'Unknown order state.';
const errorEmptyMessage = 'Empty Message.';

function encodeMessage({
  state, invoice, lnDestPubKey, lnPaymentHash, lnAmount, lnPreimage, swapAddress, refundReason,
  onchainNetwork, onchainAmount, fundingTxn, fundingTxnIndex, fundingBlockHash, claimingTxn,
  claimingBlockHash, refundTxn, refundBlockHash,
}) {
  if (!invoice) throw new Error(errorInvoiceMissing);
  if (!onchainNetwork) throw new Error(errorIncompleteParameters);

  if (state === orderState.Init) {
    if (!lnDestPubKey || !lnAmount) throw new Error(errorIncompleteParameters);
    return `${state}:${invoice}:${onchainNetwork}:${lnDestPubKey}:${lnAmount}`;
  }

  if (state === orderState.WaitingForFunding) {
    if (!onchainAmount || !swapAddress || !lnPaymentHash) {
      throw new Error(errorIncompleteParameters);
    }
    return `${state}:${invoice}:${onchainNetwork}:${onchainAmount}:${swapAddress}:${lnPaymentHash}`;
  }

  if (state === orderState.WaitingForFundingConfirmation) {
    if (!fundingTxn || !fundingTxnIndex) throw new Error(errorIncompleteParameters);
    return `${state}:${invoice}:${onchainNetwork}:${fundingTxn}:${fundingTxnIndex}`;
  }

  if (state === orderState.OrderFunded) {
    if (!fundingTxn || !fundingBlockHash) throw new Error(errorIncompleteParameters);
    return `${state}:${invoice}:${onchainNetwork}:${fundingTxn}:${fundingBlockHash}`;
  }

  if (state === orderState.WaitingForClaiming) {
    if (!lnPreimage) throw new Error(errorIncompleteParameters);
    return `${state}:${invoice}:${onchainNetwork}:${lnPreimage}`;
  }

  if (state === orderState.WaitingForClaimingConfirmation) {
    if (!claimingTxn) throw new Error(errorIncompleteParameters);
    return `${state}:${invoice}:${onchainNetwork}:${claimingTxn}`;
  }

  if (state === orderState.OrderClaimed) {
    if (!claimingTxn || !claimingBlockHash) throw new Error(errorIncompleteParameters);
    return `${state}:${invoice}:${onchainNetwork}:${claimingTxn}:${claimingBlockHash}`;
  }

  if (state === orderState.WaitingForRefund) {
    if (!refundReason) throw new Error(errorIncompleteParameters);
    return `${state}:${invoice}:${onchainNetwork}:${refundReason}`;
  }

  if (state === orderState.WaitingForRefundConfirmation) {
    if (!refundTxn) throw new Error(errorIncompleteParameters);
    return `${state}:${invoice}:${onchainNetwork}:${refundTxn}`;
  }

  if (state === orderState.OrderRefunded) {
    if (!refundTxn || !refundBlockHash) throw new Error(errorIncompleteParameters);
    return `${state}:${invoice}:${onchainNetwork}:${refundTxn}:${refundBlockHash}`;
  }

  throw new Error(errorUnknownOrderState);
}

function decodeMessage(msg) {
  if (!msg) throw new Error(errorEmptyMessage);

  const tokens = msg.split(':');
  const [state, invoice, onchainNetwork, ...rest] = tokens;
  if (!invoice) throw new Error(errorInvoiceMissing);
  if (!onchainNetwork) throw new Error(errorIncompleteParameters);

  if (state === orderState.Init) {
    const [lnDestPubKey, lnAmount] = rest;
    if (!lnDestPubKey || !lnAmount) throw new Error(errorIncompleteParameters);
    return {
      state, invoice, onchainNetwork, lnDestPubKey, lnAmount,
    };
  }

  if (state === orderState.WaitingForFunding) {
    const [onchainAmount, swapAddress, lnPaymentHash] = rest;
    if (!onchainAmount || !swapAddress || !lnPaymentHash) {
      throw new Error(errorIncompleteParameters);
    }
    return {
      state, invoice, onchainNetwork, onchainAmount, swapAddress, lnPaymentHash,
    };
  }

  if (state === orderState.WaitingForFundingConfirmation) {
    const [fundingTxn, fundingTxnIndex] = rest;
    if (!fundingTxn) throw new Error(errorIncompleteParameters);
    if (!fundingTxnIndex) throw new Error(errorIncompleteParameters);
    return {
      state, invoice, onchainNetwork, fundingTxn, fundingTxnIndex,
    };
  }

  if (state === orderState.OrderFunded) {
    const [fundingTxn, fundingBlockHash] = rest;
    if (!fundingTxn || !fundingBlockHash) throw new Error(errorIncompleteParameters);
    return {
      state, invoice, onchainNetwork, fundingTxn, fundingBlockHash,
    };
  }

  if (state === orderState.WaitingForClaiming) {
    const [lnPreimage] = rest;
    if (!lnPreimage) throw new Error(errorIncompleteParameters);
    return {
      state, invoice, onchainNetwork, lnPreimage,
    };
  }

  if (state === orderState.WaitingForClaimingConfirmation) {
    const [claimingTxn] = rest;
    if (!claimingTxn) throw new Error(errorIncompleteParameters);
    return {
      state, invoice, onchainNetwork, claimingTxn,
    };
  }

  if (state === orderState.OrderClaimed) {
    const [claimingTxn, claimingBlockHash] = rest;
    if (!claimingTxn || !claimingBlockHash) throw new Error(errorIncompleteParameters);
    return {
      state, invoice, onchainNetwork, claimingTxn, claimingBlockHash,
    };
  }

  if (state === orderState.WaitingForRefund) {
    const [refundReason] = rest;
    if (!refundReason) throw new Error(errorIncompleteParameters);
    return {
      state, invoice, onchainNetwork, refundReason,
    };
  }

  if (state === orderState.WaitingForRefundConfirmation) {
    const [refundTxn] = rest;
    if (!refundTxn) throw new Error(errorIncompleteParameters);
    return {
      state, invoice, onchainNetwork, refundTxn,
    };
  }

  if (state === orderState.OrderRefunded) {
    const [refundTxn, refundBlockHash] = rest;
    if (!refundTxn || !refundBlockHash) throw new Error(errorIncompleteParameters);
    return {
      state, invoice, onchainNetwork, refundTxn, refundBlockHash,
    };
  }

  throw new Error(errorUnknownOrderState);
}

module.exports = {
  // key of swap order in redis: 'prefix:invoice'
  prefix: 'SwapOrder',
  // channel name used in redis pubsub
  channel: 'OrderStateChannel',

  // functions for pubsub message
  encodeMessage,
  decodeMessage,

  // errors
  errorIncompleteParameters,
  errorInvoiceMissing,
  errorUnknownOrderState,
  errorEmptyMessage,

  // order states
  Init: orderState.Init,
  WaitingForFunding: orderState.WaitingForFunding,
  WaitingForFundingConfirmation: orderState.WaitingForFundingConfirmation,
  OrderFunded: orderState.OrderFunded,
  WaitingForClaiming: orderState.WaitingForClaiming,
  WaitingForClaimingConfirmation: orderState.WaitingForClaimingConfirmation,
  OrderClaimed: orderState.OrderClaimed,
  WaitingForRefund: orderState.WaitingForRefund,
  WaitingForRefundConfirmation: orderState.WaitingForRefundConfirmation,
  OrderRefunded: orderState.OrderRefunded,
};

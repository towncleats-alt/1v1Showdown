const VALID_PAYMENT_METHODS = new Set(['Easypaisa', 'JazzCash', 'Bank Transfer', 'Cash', 'Other']);
const REVIEW_DECISIONS = {
  APPROVE: 'APPROVED',
  VERIFY_PAYMENT: 'PAYMENT_VERIFIED',
  REJECT: 'REJECTED',
  SUSPEND: 'SUSPENDED',
  WITHDRAW: 'WITHDRAWN',
  CHECK_IN: 'CHECKED_IN',
};

export function validatePaymentSubmission(payload = {}) {
  const paymentMethod = String(payload.paymentMethod ?? '').trim();
  const paymentReference = String(payload.paymentReference ?? '').trim();
  const paymentAmountRaw = payload.paymentAmount ?? payload.amount ?? 0;
  const paymentAmount = Number(paymentAmountRaw);

  if (!paymentMethod || !paymentReference || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error('Payment reference and amount are required and the amount must be greater than zero.');
  }

  if (!VALID_PAYMENT_METHODS.has(paymentMethod) && paymentMethod.length > 1) {
    // allow custom methods but keep normalization strict
  }

  if (paymentMethod.length > 80 || paymentReference.length > 120) {
    throw new Error('Payment details are too long.');
  }

  return {
    paymentMethod,
    paymentReference,
    paymentAmount: Number(paymentAmount.toFixed(2)),
  };
}

export function validatePlayerReviewAction(payload = {}) {
  const rawDecision = String(payload.decision ?? '').trim().toUpperCase();
  const noteText = String(payload.notes ?? '').trim();
  const targetStatus = REVIEW_DECISIONS[rawDecision];

  if (!targetStatus) {
    throw new Error('Decision must be one of APPROVE, VERIFY_PAYMENT, REJECT, SUSPEND, WITHDRAW, or CHECK_IN.');
  }

  return {
    decision: rawDecision,
    normalizedDecision: targetStatus,
    notes: noteText || 'Reviewed by admin.',
  };
}

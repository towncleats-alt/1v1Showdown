import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePaymentSubmission, validatePlayerReviewAction } from '../playerReview.js';

test('rejects incomplete payment submission', () => {
  assert.throws(() => validatePaymentSubmission({ paymentMethod: 'Easypaisa' }), /Payment reference and amount are required/i);
});

test('accepts valid payment submission', () => {
  const result = validatePaymentSubmission({ paymentMethod: 'JazzCash', paymentReference: 'JC-12345', paymentAmount: '2500' });
  assert.equal(result.paymentMethod, 'JazzCash');
  assert.equal(result.paymentReference, 'JC-12345');
  assert.equal(Number(result.paymentAmount), 2500);
});

test('accepts valid approval decision and rejects invalid one', () => {
  const review = validatePlayerReviewAction({ decision: 'APPROVE', notes: 'Verified bank transfer' });
  assert.equal(review.decision, 'APPROVE');
  assert.match(review.notes, /Verified bank transfer/i);
  assert.throws(() => validatePlayerReviewAction({ decision: 'WRONG' }), /Decision must be one of/i);
});

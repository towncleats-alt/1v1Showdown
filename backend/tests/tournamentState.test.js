import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlayerCheckIn, validateTournamentMatchState } from '../tournamentState.js';

test('approved players with verified payment can check in', () => {
  const result = canPlayerCheckIn({
    approval_status: 'APPROVED',
    payment_status: 'VERIFIED',
    profile_completed: true,
    registration_status: 'APPROVED',
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'eligible');
});

test('unapproved players cannot check in', () => {
  const result = canPlayerCheckIn({
    approval_status: 'PENDING',
    payment_status: 'NOT_SUBMITTED',
    profile_completed: true,
    registration_status: 'PENDING',
  });

  assert.equal(result.allowed, false);
  assert.match(result.reason, /approval|payment|profile/i);
});

test('valid match state transitions pass validation', () => {
  const ok = validateTournamentMatchState('UPCOMING', 'LIVE');
  const blocked = validateTournamentMatchState('FINISHED', 'LIVE');

  assert.equal(ok, true);
  assert.equal(blocked, false);
});

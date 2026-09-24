import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTournamentEvent, validateTournamentMatchState, validateTournamentScore } from '../tournamentState.js';

test('score validation rejects negative numbers', () => {
  assert.equal(validateTournamentScore(2, -1), false);
  assert.equal(validateTournamentScore(2, 3), true);
});

test('live events with valid payload pass validation', () => {
  const good = validateTournamentEvent({ eventType: 'GOAL', minute: '12:04', side: 'A', playerName: 'Ali' });
  const bad = validateTournamentEvent({ eventType: 'INVALID', minute: '12:00' });

  assert.equal(good, true);
  assert.equal(bad, false);
});

test('match lifecycle transition guard blocks invalid flow', () => {
  assert.equal(validateTournamentMatchState('LIVE', 'UPCOMING'), false);
  assert.equal(validateTournamentMatchState('UPCOMING', 'LIVE'), true);
  assert.equal(validateTournamentMatchState('PAUSED', 'FINISHED'), true);
});

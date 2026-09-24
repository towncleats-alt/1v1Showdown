const VALID_MATCH_STATES = new Set(['UPCOMING', 'SCHEDULED', 'LIVE', 'PAUSED', 'FINISHED']);
const MATCH_TRANSITIONS = {
  UPCOMING: new Set(['SCHEDULED', 'LIVE']),
  SCHEDULED: new Set(['LIVE', 'UPCOMING']),
  LIVE: new Set(['PAUSED', 'FINISHED']),
  PAUSED: new Set(['LIVE', 'FINISHED']),
  FINISHED: new Set(['FINISHED']),
};

export function canPlayerCheckIn(player = {}) {
  const approvalStatus = String(player.approval_status ?? '').toUpperCase();
  const paymentStatus = String(player.payment_status ?? '').toUpperCase();
  const registrationStatus = String(player.registration_status ?? '').toUpperCase();
  const profileCompleted = Boolean(player.profile_completed);

  const checks = [];

  if (approvalStatus !== 'APPROVED' && approvalStatus !== 'CHECKED_IN') checks.push('approval');
  if (paymentStatus !== 'VERIFIED') checks.push('payment');
  if (!profileCompleted) checks.push('profile');
  if (registrationStatus !== 'APPROVED' && registrationStatus !== 'CHECKED_IN') checks.push('registration');

  if (checks.length === 0) {
    return { allowed: true, reason: 'eligible' };
  }

  return { allowed: false, reason: checks.join(', ') };
}

export function validateTournamentMatchState(currentState, nextState) {
  const current = String(currentState ?? '').toUpperCase();
  const next = String(nextState ?? '').toUpperCase();

  if (!VALID_MATCH_STATES.has(current) || !VALID_MATCH_STATES.has(next)) return false;
  if (!MATCH_TRANSITIONS[current]?.has(next)) return false;
  if (current === 'FINISHED' && next !== 'FINISHED') return false;
  return true;
}

export function validateTournamentScore(scoreA, scoreB) {
  const a = Number(scoreA);
  const b = Number(scoreB);

  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a < 0 || b < 0) return false;
  return true;
}

export function validateTournamentEvent(event = {}) {
  const eventType = String(event.eventType ?? event.type ?? '').toUpperCase();
  const allowed = new Set(['GOAL', 'OWN_GOAL', 'YELLOW_CARD', 'RED_CARD', 'FOUL', 'SHOT', 'SAVE', 'OFFSIDE', 'MATCH_STARTED', 'MATCH_PAUSED', 'MATCH_RESUMED', 'MATCH_FINISHED']);
  if (!allowed.has(eventType)) return false;
  if (typeof event.minute !== 'string' && typeof event.minute !== 'number') return false;
  if (event.side && !['A', 'B', 'a', 'b'].includes(String(event.side))) return false;
  return true;
}

export function buildTournamentEligibilitySummary(players = []) {
  return players.map((player) => ({
    id: player.id,
    fullName: player.full_name || player.display_name || 'Unknown player',
    ...player,
    checkInStatus: canPlayerCheckIn(player),
  }));
}

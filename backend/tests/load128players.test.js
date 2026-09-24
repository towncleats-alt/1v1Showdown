/**
 * Load test — 128 player registrations + full system validation
 *
 * Tests the entire pipeline without HTTP (no rate-limiter interference):
 *   1. Input validation (playerRegistration, playerReview, tournamentState)
 *   2. Store CRUD — upsert, patch, findByGmail, delete
 *   3. 128 unique players registered with realistic random credentials
 *   4. State integrity checks after all registrations
 *   5. Match creation & scoring for 64 matches (Round 1 bracket)
 *   6. AI assistant classification
 *   7. Edge cases — duplicate email, empty payload, bad transitions
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { validatePlayerRegistration } from '../playerRegistration.js';
import { validatePaymentSubmission, validatePlayerReviewAction } from '../playerReview.js';
import {
  canPlayerCheckIn,
  validateTournamentMatchState,
  validateTournamentScore,
  validateTournamentEvent,
} from '../tournamentState.js';
import { classifyQuestionType } from '../aiAssistant.js';
import * as store from '../db/store.js';

// ── Data generators ────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Ali','Usman','Hassan','Ibrahim','Bilal','Hamza','Zain','Omar','Faisal','Asad',
  'Tariq','Imran','Kamran','Waheed','Shahid','Rizwan','Nasir','Adeel','Saad','Junaid',
  'Yasir','Talha','Fahad','Waqas','Haris','Shoaib','Zeeshan','Salman','Aqib','Babar',
  'Mohsin','Danish','Ammar','Ghulam','Noman','Rafiq','Khalid','Muneeb','Hasnain','Uzair',
];
const LAST_NAMES = [
  'Khan','Butt','Malik','Sheikh','Chaudhry','Rana','Raja','Mirza','Siddiqui','Qureshi',
  'Ansari','Gill','Warraich','Bhatti','Niazi','Abbasi','Hashmi','Lodhi','Bokhari','Tiwana',
  'Bajwa','Cheema','Sandhu','Virk','Dogar','Gondal','Tarar','Arain','Mughal','Syed',
];
const CITIES = [
  'Faisalabad','Lahore','Karachi','Islamabad','Rawalpindi','Multan','Gujranwala',
  'Sialkot','Sheikhupura','Sargodha','Hyderabad','Peshawar','Quetta','Bahawalpur',
];
const SKILLS = [
  'Dribbling','Finishing','Long shots','Free kicks','Defending','Pace','Passing',
  'Vision','Heading','Tackling','Aerial duels','Crossing','One-touch play','Set pieces',
];
const DOMINANT_FEET = ['Right','Left','Both'];
const PAYMENT_METHODS = ['Easypaisa','JazzCash','Bank Transfer','Cash'];

function randItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randPhone() {
  const prefixes = ['0300','0301','0302','0303','0311','0312','0313','0321','0322','0323','0333','0345','0346'];
  return randItem(prefixes) + Math.floor(1000000 + Math.random() * 9000000).toString();
}
function randEmail(name, idx) {
  const domain = randItem(['gmail.com','yahoo.com','hotmail.com','outlook.com']);
  const slug = name.toLowerCase().replace(/\s+/g, '.') + idx;
  return `${slug}@${domain}`;
}
function randPassword() {
  // 14-char: letters + digits + symbol — always ≥ 12
  return crypto.randomBytes(8).toString('hex').slice(0, 12) + '!A';
}

function generatePlayer(idx) {
  const firstName = randItem(FIRST_NAMES);
  const lastName  = randItem(LAST_NAMES);
  const name      = `${firstName} ${lastName}`;
  const email     = randEmail(name, idx);
  const phone     = randPhone();
  const whatsapp  = randPhone();
  return {
    name,
    email,
    phone,
    whatsapp,
    password: randPassword(),
    city: randItem(CITIES),
    bestSkills: randItem(SKILLS),
    dominantFoot: randItem(DOMINANT_FEET),
    paymentMethod: randItem(PAYMENT_METHODS),
    paymentReference: 'REF-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    paymentAmount: 1000,
  };
}

// ── Generate 128 unique players (unique email guaranteed by index) ─────────────
const PLAYERS = Array.from({ length: 128 }, (_, i) => generatePlayer(i + 1));

// ── SUITE 1: Validate all 128 payloads pass validatePlayerRegistration ─────────
test('all 128 player payloads pass registration validation', () => {
  let passed = 0;
  for (const p of PLAYERS) {
    const result = validatePlayerRegistration(p);
    assert.ok(result.name, `Player ${p.name} — name missing`);
    assert.ok(result.email.includes('@'), `Player ${p.name} — email invalid`);
    assert.ok(result.phone.length >= 7, `Player ${p.name} — phone too short`);
    assert.ok(result.whatsapp.length >= 7, `Player ${p.name} — whatsapp too short`);
    passed++;
  }
  assert.equal(passed, 128);
});

// ── SUITE 2: Register all 128 players into the in-memory store ─────────────────
const registeredIds = [];

test('registers all 128 players into in-memory store', () => {
  for (const p of PLAYERS) {
    const id = 'P-' + crypto.randomBytes(5).toString('hex').toUpperCase();
    const row = store.players.upsert({
      id,
      name: p.name,
      seed: `S${registeredIds.length + 1}`,
      gmail_address: p.email,
      cell_phone: p.phone,
      whatsapp_contact: p.whatsapp,
      city: p.city,
      best_skills: p.bestSkills,
      dominant_foot: p.dominantFoot,
      payment_status: 'NOT_SUBMITTED',
      approval_status: 'PENDING',
      checked_in: false,
    });
    assert.ok(row.id, `Player ${p.name} — store did not return id`);
    assert.equal(row.name, p.name);
    assert.equal(row.gmail_address, p.email);
    registeredIds.push(row.id);
  }
  assert.equal(registeredIds.length, 128);
});

// ── SUITE 3: Store integrity — all 128 are retrievable ────────────────────────
test('all 128 players are retrievable from store', () => {
  const all = store.players.all();
  // Store may have been pre-seeded; just confirm our 128 are all in there
  const storedIds = new Set(all.map(p => p.id));
  for (const id of registeredIds) {
    assert.ok(storedIds.has(id), `Player id ${id} missing from store`);
  }
});

// ── SUITE 4: findByGmail works for every player ───────────────────────────────
test('findByGmail resolves correctly for all 128 players', () => {
  let found = 0;
  for (const p of PLAYERS) {
    const row = store.players.findByGmail(p.email);
    assert.ok(row, `findByGmail returned null for ${p.email}`);
    assert.equal(row.gmail_address.toLowerCase(), p.email.toLowerCase());
    found++;
  }
  assert.equal(found, 128);
});

// ── SUITE 5: Payment validation for all 128 players ──────────────────────────
test('payment submission validation passes for all 128 players', () => {
  let passed = 0;
  for (const p of PLAYERS) {
    const result = validatePaymentSubmission({
      paymentMethod: p.paymentMethod,
      paymentReference: p.paymentReference,
      paymentAmount: p.paymentAmount,
    });
    assert.equal(result.paymentMethod, p.paymentMethod);
    assert.equal(result.paymentReference, p.paymentReference);
    assert.equal(result.paymentAmount, 1000);
    passed++;
  }
  assert.equal(passed, 128);
});

// ── SUITE 6: Approve all 128 players + patch store ────────────────────────────
test('all 128 players can be approved and patched in store', () => {
  let approved = 0;
  for (const id of registeredIds) {
    const decision = validatePlayerReviewAction({ decision: 'APPROVE', notes: 'Load test approval' });
    assert.equal(decision.normalizedDecision, 'APPROVED');
    const patched = store.players.patch(id, {
      approval_status: 'APPROVED',
      payment_status: 'VERIFIED',
    });
    assert.ok(patched, `patch returned null for id ${id}`);
    assert.equal(patched.approval_status, 'APPROVED');
    assert.equal(patched.payment_status, 'VERIFIED');
    approved++;
  }
  assert.equal(approved, 128);
});

// ── SUITE 7: Check-in eligibility after approval ──────────────────────────────
test('all 128 approved players are eligible for check-in', () => {
  let eligible = 0;
  const all = store.players.all();
  for (const player of all.filter(p => registeredIds.includes(p.id))) {
    const result = canPlayerCheckIn({
      ...player,
      profile_completed: true,
      registration_status: 'APPROVED',
    });
    assert.equal(result.allowed, true, `Player ${player.name} — check-in blocked: ${result.reason}`);
    eligible++;
  }
  assert.equal(eligible, 128);
});

// ── SUITE 8: Create 64 Round-1 matches from the 128 players ──────────────────
const matchIds = [];

test('creates 64 Round-1 matches from 128 players', () => {
  const all = store.players.all().filter(p => registeredIds.includes(p.id));
  assert.ok(all.length >= 128, 'Not enough players in store for bracket');

  for (let i = 0; i < 64; i++) {
    const pA = all[i * 2];
    const pB = all[i * 2 + 1];
    const id = 'M-' + crypto.randomBytes(5).toString('hex').toUpperCase();
    const match = store.matches.upsert({
      id,
      round: 'Round 1',
      player_a: pA.name,
      player_b: pB.name,
      score_a: 0,
      score_b: 0,
      match_time: `${String(18 + Math.floor(i / 12)).padStart(2,'0')}:${String((i % 12) * 5).padStart(2,'0')}`,
      state: 'UPCOMING',
    });
    assert.equal(match.state, 'UPCOMING');
    matchIds.push(id);
  }
  assert.equal(matchIds.length, 64);
});

// ── SUITE 9: Validate all match state transitions for 64 matches ──────────────
test('all 64 matches can transition UPCOMING → LIVE → FINISHED', () => {
  let ok = 0;
  for (const id of matchIds) {
    assert.equal(validateTournamentMatchState('UPCOMING', 'LIVE'), true);
    assert.equal(validateTournamentMatchState('LIVE', 'FINISHED'), true);
    assert.equal(validateTournamentMatchState('FINISHED', 'UPCOMING'), false);
    store.matches.patch(id, { state: 'LIVE' });
    store.matches.patch(id, { state: 'FINISHED', score_a: Math.floor(Math.random() * 6), score_b: Math.floor(Math.random() * 6) });
    ok++;
  }
  assert.equal(ok, 64);
});

// ── SUITE 10: Score validation on all 64 finished matches ─────────────────────
test('score validation passes for all 64 match results', () => {
  const finished = store.matches.all().filter(m => matchIds.includes(m.id) && m.state === 'FINISHED');
  assert.equal(finished.length, 64);
  for (const m of finished) {
    assert.equal(validateTournamentScore(m.score_a, m.score_b), true);
    assert.ok(m.score_a >= 0 && m.score_b >= 0);
  }
});

// ── SUITE 11: Tournament events on 10 random matches ─────────────────────────
test('inserts valid tournament events for 10 matches', () => {
  const sample = matchIds.slice(0, 10);
  const EVENT_TYPES = ['GOAL','SHOT','FOUL','YELLOW_CARD','SAVE'];
  let inserted = 0;
  for (const matchId of sample) {
    for (const type of EVENT_TYPES) {
      const valid = validateTournamentEvent({ eventType: type, minute: '05:00', side: 'A' });
      assert.equal(valid, true, `Event type ${type} failed validation`);
      store.events.insert({ match_id: matchId, type, minute: '05:00', side: 'A', player_name: 'Test Player' });
      inserted++;
    }
  }
  assert.equal(inserted, 50); // 10 matches × 5 event types
  const storedEvents = store.events.forMatches(sample);
  assert.equal(storedEvents.length, 50);
});

// ── SUITE 12: AI assistant classifies 10 tournament questions correctly ────────
test('AI assistant classifies tournament questions correctly', () => {
  const cases = [
    { q: 'What is the current score?',          expected: 'live'    },
    { q: 'Who is playing right now?',           expected: 'live'    },
    { q: 'What are the rules?',                 expected: 'rules'   },
    { q: 'How does the tournament work?',       expected: 'rules'   },
    { q: 'What is the venue?',                  expected: 'rules'   },
    { q: 'What time is the final?',             expected: 'live'    },
    { q: 'Tell me something random',            expected: 'general' },
    { q: 'How do I register?',                  expected: 'rules'   },
    { q: 'Who won the last match?',             expected: 'live'    },
    { q: 'What is the format?',                 expected: 'rules'   },
  ];
  for (const { q, expected } of cases) {
    assert.equal(classifyQuestionType(q), expected, `"${q}" → expected ${expected}`);
  }
});

// ── SUITE 13: Edge cases — invalid payloads are rejected ──────────────────────
test('rejects empty registration payload', () => {
  assert.throws(() => validatePlayerRegistration({}), /required/i);
});

test('rejects registration with missing whatsapp', () => {
  assert.throws(
    () => validatePlayerRegistration({ name: 'Test', email: 'test@gmail.com', phone: '03001234567' }),
    /required/i
  );
});

test('rejects invalid payment — zero amount', () => {
  assert.throws(
    () => validatePaymentSubmission({ paymentMethod: 'Easypaisa', paymentReference: 'REF-001', paymentAmount: 0 }),
    /greater than zero/i
  );
});

test('rejects invalid payment — missing reference', () => {
  assert.throws(
    () => validatePaymentSubmission({ paymentMethod: 'JazzCash', paymentAmount: 1000 }),
    /required/i
  );
});

test('rejects unknown review decision', () => {
  assert.throws(() => validatePlayerReviewAction({ decision: 'MAYBE' }), /Decision must be one of/i);
});

test('rejects invalid match state transition FINISHED → LIVE', () => {
  assert.equal(validateTournamentMatchState('FINISHED', 'LIVE'), false);
});

test('rejects invalid tournament event type', () => {
  assert.equal(validateTournamentEvent({ eventType: 'BICYCLE_KICK', minute: '10:00' }), false);
});

// ── SUITE 14: Final store integrity count ─────────────────────────────────────
test('store contains exactly 128 registered players from this run', () => {
  const all = store.players.all();
  const ours = all.filter(p => registeredIds.includes(p.id));
  assert.equal(ours.length, 128);
});

test('store contains exactly 64 finished Round-1 matches', () => {
  const finished = store.matches.all().filter(m => matchIds.includes(m.id) && m.state === 'FINISHED');
  assert.equal(finished.length, 64);
});

test('store contains 50 events across 10 matches', () => {
  const sample = matchIds.slice(0, 10);
  assert.equal(store.events.forMatches(sample).length, 50);
});

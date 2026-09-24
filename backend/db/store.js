/**
 * In-memory store — exact mirror of the tournament_* DB tables.
 * Used automatically when PostgreSQL is unreachable.
 * All data survives for the lifetime of the Node process.
 */

function now() { return new Date().toISOString(); }
function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─── Tables ───────────────────────────────────────────────────────────────────
const tables = {
  tournament_players: [],
  tournament_matches: [],
  tournament_events: [],
  tournament_timer: [{
    id: 1,
    timer_seconds: 0,
    match_state: 'IDLE',
    live_match_id: null,
    video_url: '',
    updated_at: now(),
  }],
  tournament_settings: [{
    id: 1,
    settings: {
      tournamentName: '1 ON 1 SHOWDOWN FAISALABAD',
      headerTitle: '1 ON 1 SHOWDOWN',
      headerSubtitle: 'Sunday, Oct 11, 2026 · Padel Pavilion, Faisalabad',
      venue: 'Padel Pavilion, Faisalabad',
      timezone: 'Asia/Karachi',
      participantLimit: 0,
      matchDuration: 15,
      tryDuration: 45,
      triesPerPlayer: 5,
      suddenDuration: 15,
      timeoutAllowance: 90,
      footerText: '1 ON 1 SHOWDOWN FAISALABAD — Official Tournament Platform',
    },
    updated_at: now(),
  }],
  // Admin accounts — seeded from .env at startup
  users: [],
};

// Seed .env admin so login works without DB
let adminSeeded = false;
export function seedEnvAdmin() {
  if (adminSeeded) return;
  adminSeeded = true;
  const email = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  if (email && !tables.users.find(u => u.email === email)) {
    tables.users.push({
      id: 'env-admin',
      email,
      role: 'SUPER_ADMIN',
      is_active: true,
      created_at: now(),
    });
  }
}

// ─── Player helpers ───────────────────────────────────────────────────────────
function rowToPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    seed: p.seed ?? '—',
    status: p.status ?? 'Active',
    goals: p.goals ?? 0,
    shots: p.shots ?? 0,
    matches: p.matches ?? 0,
    gmail_address: p.gmail_address ?? '',
    cell_phone: p.cell_phone ?? '',
    whatsapp_contact: p.whatsapp_contact ?? '',
    photo_url: p.photo_url ?? '',
    preferred_keeper: p.preferred_keeper ?? '',
    dominant_foot: p.dominant_foot ?? 'Right',
    city: p.city ?? 'Faisalabad',
    bio: p.bio ?? '',
    best_skills: p.best_skills ?? '',
    game_videos: p.game_videos ?? [],
    payment_status: p.payment_status ?? 'NOT_SUBMITTED',
    payment_ref: p.payment_ref ?? '',
    payment_method: p.payment_method ?? 'EasyPaisa/Cash',
    approval_status: p.approval_status ?? 'PENDING',
    checked_in: Boolean(p.checked_in),
    notes: p.notes ?? '',
    created_at: p.created_at ?? now(),
    updated_at: p.updated_at ?? now(),
  };
}

// ─── Players ──────────────────────────────────────────────────────────────────
export const players = {
  all() { return tables.tournament_players.map(rowToPlayer); },

  upsert(data) {
    const id = (data.id && String(data.id).trim()) || ('P-' + uid().replace(/-/g,'').slice(0,10).toUpperCase());
    const idx = tables.tournament_players.findIndex(p => p.id === id);
    const existing = tables.tournament_players[idx] ?? {};
    const row = rowToPlayer({ ...existing, ...data, id, updated_at: now(), created_at: existing.created_at ?? now() });
    if (idx >= 0) tables.tournament_players[idx] = row;
    else tables.tournament_players.push(row);
    return row;
  },

  patch(id, data) {
    const idx = tables.tournament_players.findIndex(p => p.id === id);
    if (idx < 0) return null;
    const merged = { ...tables.tournament_players[idx] };
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) merged[k] = v;
    }
    // gameVideos may be explicitly set to empty array
    if (Array.isArray(data.game_videos)) merged.game_videos = data.game_videos;
    if (typeof data.checked_in === 'boolean') merged.checked_in = data.checked_in;
    merged.updated_at = now();
    tables.tournament_players[idx] = merged;
    return tables.tournament_players[idx];
  },

  delete(id) { tables.tournament_players = tables.tournament_players.filter(p => p.id !== id); },

  findByGmail(gmail) {
    const g = (gmail ?? '').toLowerCase();
    return tables.tournament_players.find(p => (p.gmail_address ?? '').toLowerCase() === g) ?? null;
  },
};

// ─── Matches ──────────────────────────────────────────────────────────────────
function rowToMatch(m) {
  return {
    id: m.id,
    round: m.round ?? 'Round 1',
    player_a: m.player_a ?? '',
    player_b: m.player_b ?? '',
    score_a: m.score_a ?? 0,
    score_b: m.score_b ?? 0,
    match_time: m.match_time ?? '18:00',
    state: m.state ?? 'UPCOMING',
    video_url: m.video_url ?? '',
    video_title: m.video_title ?? '',
    created_at: m.created_at ?? now(),
    updated_at: m.updated_at ?? now(),
  };
}

export const matches = {
  all() { return tables.tournament_matches.map(rowToMatch); },

  upsert(data) {
    const id = (data.id && String(data.id).trim()) || ('M-' + uid().replace(/-/g,'').slice(0,10).toUpperCase());
    const idx = tables.tournament_matches.findIndex(m => m.id === id);
    const existing = tables.tournament_matches[idx] ?? {};
    const row = rowToMatch({ ...existing, ...data, id, updated_at: now(), created_at: existing.created_at ?? now() });
    if (idx >= 0) tables.tournament_matches[idx] = row;
    else tables.tournament_matches.push(row);
    return row;
  },

  patch(id, data) {
    const idx = tables.tournament_matches.findIndex(m => m.id === id);
    if (idx < 0) return null;
    const merged = { ...tables.tournament_matches[idx] };
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) merged[k] = v;
    }
    merged.updated_at = now();
    // When match finishes, update player goal/match counts in memory
    if (data.state === 'FINISHED' && tables.tournament_matches[idx].state !== 'FINISHED') {
      const finalA = merged.score_a ?? 0;
      const finalB = merged.score_b ?? 0;
      players.patch(tables.tournament_players.find(p => p.name === merged.player_a)?.id, { matches: (tables.tournament_players.find(p => p.name === merged.player_a)?.matches ?? 0) + 1, goals: (tables.tournament_players.find(p => p.name === merged.player_a)?.goals ?? 0) + finalA });
      players.patch(tables.tournament_players.find(p => p.name === merged.player_b)?.id, { matches: (tables.tournament_players.find(p => p.name === merged.player_b)?.matches ?? 0) + 1, goals: (tables.tournament_players.find(p => p.name === merged.player_b)?.goals ?? 0) + finalB });
    }
    tables.tournament_matches[idx] = merged;
    return tables.tournament_matches[idx];
  },

  delete(id) {
    tables.tournament_matches = tables.tournament_matches.filter(m => m.id !== id);
    tables.tournament_events = tables.tournament_events.filter(e => e.match_id !== id);
    const t = tables.tournament_timer[0];
    if (t && t.live_match_id === id) { t.live_match_id = null; t.match_state = 'IDLE'; }
  },

  find(id) { return tables.tournament_matches.find(m => m.id === id) ?? null; },
};

// ─── Events ───────────────────────────────────────────────────────────────────
export const events = {
  forMatches(ids) { return tables.tournament_events.filter(e => ids.includes(e.match_id)); },

  insert(data) {
    const id = (data.id && String(data.id).trim()) || ('EV-' + uid().replace(/-/g,'').slice(0,10).toUpperCase());
    if (tables.tournament_events.find(e => e.id === id)) return tables.tournament_events.find(e => e.id === id);
    const row = { id, match_id: data.match_id ?? data.matchId, minute: data.minute ?? '00:00', event_type: data.type ?? data.event_type ?? 'ACTION', player_name: data.player ?? data.player_name ?? '', detail: data.detail ?? '', side: (data.side ?? 'A').toUpperCase(), created_at: now() };
    tables.tournament_events.push(row);
    return row;
  },

  delete(id) { tables.tournament_events = tables.tournament_events.filter(e => e.id !== id); },
};

// ─── Timer ────────────────────────────────────────────────────────────────────
export const timer = {
  get() { return tables.tournament_timer[0]; },
  patch(data) {
    const t = tables.tournament_timer[0];
    if (data.timerSeconds !== undefined) t.timer_seconds = data.timerSeconds;
    if (data.matchState !== undefined) t.match_state = data.matchState;
    if ('liveMatchId' in data) t.live_match_id = data.liveMatchId ?? null;
    if (data.videoUrl !== undefined) t.video_url = data.videoUrl;
    t.updated_at = now();
  },
};

// ─── Settings ─────────────────────────────────────────────────────────────────
export const settings = {
  get() { return tables.tournament_settings[0]?.settings ?? {}; },
  merge(patch) {
    const row = tables.tournament_settings[0];
    row.settings = { ...row.settings, ...patch };
    row.updated_at = now();
    return row.settings;
  },
};

// ─── Admin users (for login without DB) ───────────────────────────────────────
export const adminUsers = {
  findByEmail(email) { return tables.users.find(u => u.email === email.toLowerCase()) ?? null; },
  all() { return tables.users.filter(u => ['ADMIN', 'SUPER_ADMIN'].includes(u.role)); },
};

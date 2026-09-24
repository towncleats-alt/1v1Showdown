-- Tournament operational state: registered players, matches, live events, timer

CREATE TABLE IF NOT EXISTS tournament_players (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  seed        TEXT NOT NULL DEFAULT '—',
  status      TEXT NOT NULL DEFAULT 'REGISTERED',
  goals       INTEGER NOT NULL DEFAULT 0 CHECK (goals >= 0),
  shots       INTEGER NOT NULL DEFAULT 0 CHECK (shots >= 0),
  matches     INTEGER NOT NULL DEFAULT 0 CHECK (matches >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_matches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round       TEXT NOT NULL,
  player_a    TEXT NOT NULL,
  player_b    TEXT NOT NULL,
  score_a     INTEGER NOT NULL DEFAULT 0 CHECK (score_a >= 0),
  score_b     INTEGER NOT NULL DEFAULT 0 CHECK (score_b >= 0),
  match_time  TEXT NOT NULL DEFAULT '18:00',
  state       TEXT NOT NULL DEFAULT 'UPCOMING' CHECK (state IN ('UPCOMING','SCHEDULED','LIVE','PAUSED','FINISHED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     UUID NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
  minute       TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  player_name  TEXT NOT NULL DEFAULT '',
  detail       TEXT NOT NULL DEFAULT '',
  side         TEXT NOT NULL DEFAULT 'a',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_timer (
  id             SERIAL PRIMARY KEY,
  timer_seconds  INTEGER NOT NULL DEFAULT 0,
  match_state    TEXT NOT NULL DEFAULT 'IDLE',
  live_match_id  UUID REFERENCES tournament_matches(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row for the timer
INSERT INTO tournament_timer (id, timer_seconds, match_state)
VALUES (1, 0, 'IDLE')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS tournament_events_match_idx ON tournament_events (match_id, created_at DESC);

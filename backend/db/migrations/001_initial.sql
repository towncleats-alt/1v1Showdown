CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'LIVE', 'COMPLETED', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('PLAYER', 'SCORER', 'TOURNAMENT_MANAGER', 'MEDIA_MANAGER', 'ADMIN', 'SUPER_ADMIN')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  jersey_number INTEGER,
  city TEXT,
  status TEXT NOT NULL DEFAULT 'REGISTERED' CHECK (status IN ('REGISTERED', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE', 'ELIMINATED', 'WITHDRAWN', 'DISQUALIFIED', 'REPLACED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
  match_number INTEGER NOT NULL,
  round_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'CONFIRMED', 'STARTING_SOON', 'DELAYED', 'LIVE', 'PAUSED', 'FINISHED', 'POSTPONED', 'CANCELLED', 'ABANDONED', 'WALKOVER', 'DISQUALIFIED')),
  scheduled_start TIMESTAMPTZ,
  estimated_start TIMESTAMPTZ,
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  score_a INTEGER NOT NULL DEFAULT 0 CHECK (score_a >= 0),
  score_b INTEGER NOT NULL DEFAULT 0 CHECK (score_b >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, match_number)
);

CREATE TABLE IF NOT EXISTS match_participants (
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('A', 'B')),
  player_id UUID REFERENCES players(id) ON DELETE RESTRICT,
  routing_type TEXT NOT NULL DEFAULT 'TBD' CHECK (routing_type IN ('SPECIFIC_PLAYER', 'WINNER_OF_MATCH', 'LOSER_OF_MATCH', 'SEED', 'TBD', 'MANUAL_OVERRIDE')),
  routing_match_id UUID REFERENCES matches(id) ON DELETE RESTRICT,
  override_reason TEXT,
  PRIMARY KEY (match_id, slot)
);

CREATE TABLE IF NOT EXISTS match_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
  player_id UUID REFERENCES players(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('GOAL', 'OWN_GOAL', 'ASSIST', 'YELLOW_CARD', 'RED_CARD', 'FOUL', 'SHOT', 'SHOT_ON_TARGET', 'SAVE', 'MATCH_STARTED', 'MATCH_PAUSED', 'MATCH_RESUMED', 'MATCH_FINISHED', 'CORRECTION', 'ADMINISTRATIVE')),
  match_clock_seconds INTEGER CHECK (match_clock_seconds IS NULL OR match_clock_seconds >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  reversed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  previous_state JSONB,
  new_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matches_live_idx ON matches (tournament_id, status) WHERE status IN ('LIVE', 'PAUSED');
CREATE INDEX IF NOT EXISTS matches_schedule_idx ON matches (tournament_id, scheduled_start);
CREATE INDEX IF NOT EXISTS match_events_match_idx ON match_events (match_id, created_at);
CREATE INDEX IF NOT EXISTS players_status_idx ON players (status);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at);

-- 008_tournament_ops_schema.sql
-- Allow string/custom IDs for tournament entities and add full profile, contact, video, and approval fields

ALTER TABLE IF EXISTS tournament_events DROP CONSTRAINT IF EXISTS tournament_events_match_id_fkey;
ALTER TABLE IF EXISTS tournament_timer DROP CONSTRAINT IF EXISTS tournament_timer_live_match_id_fkey;

ALTER TABLE tournament_players ALTER COLUMN id TYPE TEXT;
ALTER TABLE tournament_matches ALTER COLUMN id TYPE TEXT;
ALTER TABLE tournament_events ALTER COLUMN id TYPE TEXT;
ALTER TABLE tournament_events ALTER COLUMN match_id TYPE TEXT;
ALTER TABLE tournament_timer ALTER COLUMN live_match_id TYPE TEXT;

ALTER TABLE tournament_events 
  ADD CONSTRAINT tournament_events_match_id_fkey 
  FOREIGN KEY (match_id) REFERENCES tournament_matches(id) ON DELETE CASCADE;

ALTER TABLE tournament_timer 
  ADD CONSTRAINT tournament_timer_live_match_id_fkey 
  FOREIGN KEY (live_match_id) REFERENCES tournament_matches(id) ON DELETE SET NULL;

-- Rich player fields (WhatsApp, Gmail, Cell, Video links, Skills, Goalkeeper, Payment, Approval)
ALTER TABLE tournament_players
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS gmail_address TEXT,
  ADD COLUMN IF NOT EXISTS cell_phone TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_contact TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS preferred_keeper TEXT,
  ADD COLUMN IF NOT EXISTS dominant_foot TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS best_skills TEXT,
  ADD COLUMN IF NOT EXISTS game_videos JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN IF NOT EXISTS payment_ref TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS checked_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Tournament settings
CREATE TABLE IF NOT EXISTS tournament_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tournament_settings (id, settings)
VALUES (1, '{
  "tournamentName": "1 V 1 SHOWDOWN",
  "headerTitle": "1 V 1 SHOWDOWN",
  "headerSubtitle": "Tournament Operations Center",
  "venue": "Showdown Arena",
  "timezone": "Asia/Karachi",
  "participantLimit": 32,
  "matchDuration": 15,
  "tryDuration": 45,
  "triesPerPlayer": 5,
  "suddenDuration": 15,
  "timeoutAllowance": 90,
  "footerText": "1 V 1 SHOWDOWN — Official Tournament Operations"
}'::jsonb)
ON CONFLICT (id) DO NOTHING;


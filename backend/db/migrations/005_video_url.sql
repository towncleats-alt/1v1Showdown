-- Add live coverage video URL to timer row
ALTER TABLE tournament_timer ADD COLUMN IF NOT EXISTS video_url TEXT NOT NULL DEFAULT '';

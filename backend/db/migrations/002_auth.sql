CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id, expires_at);
CREATE INDEX IF NOT EXISTS sessions_active_idx ON sessions (token_hash, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role, permission_id)
);

INSERT INTO permissions (code, description) VALUES
  ('tournament.view', 'View tournament operations'),
  ('tournament.edit', 'Edit tournament configuration'),
  ('players.view', 'View players'),
  ('players.edit', 'Edit player records'),
  ('players.checkin', 'Check players in'),
  ('matches.view', 'View matches'),
  ('matches.score', 'Record live match events'),
  ('matches.correct', 'Correct match events and results'),
  ('matches.finish', 'Finish matches'),
  ('bracket.edit', 'Edit bracket routing'),
  ('content.edit', 'Edit public content'),
  ('media.publish', 'Publish media'),
  ('users.manage', 'Manage users and permissions'),
  ('audit.view', 'View audit history')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT roles.role, permissions.id
FROM (VALUES
  ('PLAYER', 'tournament.view'), ('PLAYER', 'matches.view'),
  ('SCORER', 'tournament.view'), ('SCORER', 'matches.view'), ('SCORER', 'matches.score'), ('SCORER', 'matches.finish'),
  ('TOURNAMENT_MANAGER', 'tournament.view'), ('TOURNAMENT_MANAGER', 'tournament.edit'), ('TOURNAMENT_MANAGER', 'players.view'), ('TOURNAMENT_MANAGER', 'players.edit'), ('TOURNAMENT_MANAGER', 'players.checkin'), ('TOURNAMENT_MANAGER', 'matches.view'), ('TOURNAMENT_MANAGER', 'matches.correct'), ('TOURNAMENT_MANAGER', 'bracket.edit'),
  ('MEDIA_MANAGER', 'tournament.view'), ('MEDIA_MANAGER', 'content.edit'), ('MEDIA_MANAGER', 'media.publish'),
  ('ADMIN', 'tournament.view'), ('ADMIN', 'tournament.edit'), ('ADMIN', 'players.view'), ('ADMIN', 'players.edit'), ('ADMIN', 'players.checkin'), ('ADMIN', 'matches.view'), ('ADMIN', 'matches.score'), ('ADMIN', 'matches.correct'), ('ADMIN', 'matches.finish'), ('ADMIN', 'bracket.edit'), ('ADMIN', 'content.edit'), ('ADMIN', 'media.publish'), ('ADMIN', 'audit.view'),
  ('SUPER_ADMIN', 'tournament.view'), ('SUPER_ADMIN', 'tournament.edit'), ('SUPER_ADMIN', 'players.view'), ('SUPER_ADMIN', 'players.edit'), ('SUPER_ADMIN', 'players.checkin'), ('SUPER_ADMIN', 'matches.view'), ('SUPER_ADMIN', 'matches.score'), ('SUPER_ADMIN', 'matches.correct'), ('SUPER_ADMIN', 'matches.finish'), ('SUPER_ADMIN', 'bracket.edit'), ('SUPER_ADMIN', 'content.edit'), ('SUPER_ADMIN', 'media.publish'), ('SUPER_ADMIN', 'users.manage'), ('SUPER_ADMIN', 'audit.view')
) AS roles(role, code)
JOIN permissions ON permissions.code = roles.code
ON CONFLICT DO NOTHING;

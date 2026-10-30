ALTER TABLE companies ADD COLUMN IF NOT EXISTS pack text NOT NULL DEFAULT 'warehouse';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS lang text NOT NULL DEFAULT 'ar';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT '';
UPDATE companies c
SET pack = COALESCE(
  (SELECT s.pack FROM sites s WHERE s.company_id = c.id ORDER BY s.created_at ASC LIMIT 1),
  'warehouse'
);
UPDATE companies c
SET lang = COALESCE(
  (SELECT s.lang FROM sites s WHERE s.company_id = c.id ORDER BY s.created_at ASC LIMIT 1),
  'ar'
);
UPDATE companies c
SET timezone = COALESCE(
  (SELECT s.timezone FROM sites s WHERE s.company_id = c.id ORDER BY s.created_at ASC LIMIT 1),
  ''
);

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  magic_token_hash text NOT NULL DEFAULT '',
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_token_hash_key
  ON password_reset_requests (magic_token_hash) WHERE magic_token_hash <> '';

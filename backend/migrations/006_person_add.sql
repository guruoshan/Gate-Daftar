CREATE TABLE IF NOT EXISTS person_add_requests (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  employee_id text NOT NULL DEFAULT '',
  manager_id text NOT NULL,
  status text NOT NULL DEFAULT 'waiting',
  source text NOT NULL DEFAULT 'guard',
  magic_token_hash text NOT NULL DEFAULT '',
  magic_token_expires_at timestamptz,
  magic_token_used_at timestamptz,
  deny_reason text NOT NULL DEFAULT '',
  actor_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS person_add_company_idx ON person_add_requests (company_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS person_add_token_hash_key ON person_add_requests (magic_token_hash) WHERE magic_token_hash <> '';

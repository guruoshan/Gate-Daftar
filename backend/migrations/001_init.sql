-- Gate Daftar schema, batch 4.
-- Timestamp columns are timestamptz; the store layer converts them to ISO
-- strings so the rest of the app keeps its string based comparisons.

CREATE TABLE companies (
  id text PRIMARY KEY,
  name text NOT NULL,
  country_iso text NOT NULL DEFAULT 'SA',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sites (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  pack text NOT NULL DEFAULT 'manufacturing',
  owner_name text NOT NULL DEFAULT '',
  owner_email text NOT NULL DEFAULT '',
  lang text NOT NULL DEFAULT 'ar',
  country_iso text NOT NULL DEFAULT 'SA',
  guard_pin_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE UNIQUE INDEX sites_slug_key ON sites (slug);
CREATE INDEX sites_company_idx ON sites (company_id);

CREATE TABLE users (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE people (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'employee',
  phone text NOT NULL DEFAULT '',
  manager_phone text NOT NULL DEFAULT '',
  employee_id text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX people_site_idx ON people (site_id, created_at DESC);

CREATE TABLE entries (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL,
  name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  purpose text NOT NULL DEFAULT '',
  host_name text NOT NULL DEFAULT '',
  id_number text NOT NULL DEFAULT '',
  card_number text NOT NULL DEFAULT '',
  employee_id text NOT NULL DEFAULT '',
  person_id text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  expected_minutes integer NOT NULL DEFAULT 0,
  manager_name text NOT NULL DEFAULT '',
  manager_phone text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'guard',
  day_token text NOT NULL DEFAULT '',
  magic_token_hash text NOT NULL DEFAULT '',
  magic_token_expires_at timestamptz,
  magic_token_used_at timestamptz,
  deny_reason text NOT NULL DEFAULT '',
  unapproved_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  admitted_at timestamptz,
  exited_at timestamptz,
  requested_at timestamptz,
  decided_at timestamptz,
  out_at timestamptz,
  in_at timestamptz,
  due_at timestamptz
);
CREATE INDEX entries_site_created_idx ON entries (site_id, created_at DESC);
CREATE INDEX entries_day_token_idx ON entries (site_id, day_token);
CREATE INDEX entries_token_idx ON entries (magic_token_hash) WHERE magic_token_hash <> '';

CREATE TABLE approval_tokens (
  id text PRIMARY KEY,
  entry_id text NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX approval_tokens_hash_key ON approval_tokens (token_hash);
CREATE INDEX approval_tokens_entry_idx ON approval_tokens (entry_id);

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  seq bigserial UNIQUE,
  site_id text,
  company_id text,
  action text NOT NULL,
  actor_role text NOT NULL DEFAULT 'system',
  actor_name text NOT NULL DEFAULT '',
  actor_hint text NOT NULL DEFAULT '',
  entry_id text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT '',
  device text NOT NULL DEFAULT '',
  prev_hash text NOT NULL DEFAULT 'genesis',
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_site_idx ON audit_events (site_id, seq);

CREATE TABLE events (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind text NOT NULL,
  message text NOT NULL DEFAULT '',
  extra jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_site_idx ON events (site_id, created_at DESC);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  role text NOT NULL,
  site_id text REFERENCES sites(id) ON DELETE CASCADE,
  company_id text REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE device_sessions (
  id text PRIMARY KEY,
  role text NOT NULL,
  site_id text REFERENCES sites(id) ON DELETE CASCADE,
  company_id text REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX device_sessions_expires_idx ON device_sessions (expires_at);

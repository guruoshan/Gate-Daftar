ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text NOT NULL DEFAULT '';
DROP INDEX IF EXISTS users_email_company_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
CREATE INDEX IF NOT EXISTS people_company_idx ON people (company_id, created_at DESC);

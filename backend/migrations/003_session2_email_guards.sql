-- Session 2: company email domains, manager email, named guard PINs.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS email_domains text NOT NULL DEFAULT '';

ALTER TABLE people ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
ALTER TABLE people ADD COLUMN IF NOT EXISTS manager_id text NOT NULL DEFAULT '';
ALTER TABLE people ADD COLUMN IF NOT EXISTS pin_hash text NOT NULL DEFAULT '';

ALTER TABLE entries ADD COLUMN IF NOT EXISTS manager_email text NOT NULL DEFAULT '';
ALTER TABLE entries ADD COLUMN IF NOT EXISTS manager_id text NOT NULL DEFAULT '';

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS person_id text NOT NULL DEFAULT '';
ALTER TABLE device_sessions ADD COLUMN IF NOT EXISTS person_id text NOT NULL DEFAULT '';

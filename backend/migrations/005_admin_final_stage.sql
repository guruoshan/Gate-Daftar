-- Second approval stage: after the manager approves, HR gives the final approval.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS admin_decided_at timestamptz;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS admin_name text NOT NULL DEFAULT '';

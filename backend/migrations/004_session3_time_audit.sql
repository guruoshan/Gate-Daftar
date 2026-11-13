ALTER TABLE sites ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Riyadh';

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS site_seq bigint;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS legacy boolean NOT NULL DEFAULT false;

UPDATE audit_events SET legacy = true;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY COALESCE(site_id, '') ORDER BY seq ASC) AS n
  FROM audit_events
)
UPDATE audit_events a SET site_seq = numbered.n FROM numbered WHERE a.id = numbered.id;

CREATE UNIQUE INDEX IF NOT EXISTS audit_events_site_seq_idx ON audit_events ((COALESCE(site_id, '')), site_seq);
CREATE INDEX IF NOT EXISTS entries_site_status_idx ON entries (site_id, status);

-- An email can be the owner of more than one company (a person may run two
-- gates). Uniqueness is therefore per company, not global.
DROP INDEX IF EXISTS users_email_key;
CREATE UNIQUE INDEX users_email_company_key ON users (lower(email), company_id);

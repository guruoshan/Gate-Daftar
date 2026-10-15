import crypto from 'crypto';

export const MAGIC_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export function newMagicToken() {
  return crypto.randomBytes(18).toString('base64url');
}

export function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex');
}

export function tokenExpiry(from = Date.now()) {
  return new Date(from + MAGIC_TOKEN_TTL_MS).toISOString();
}

export function isExpired(iso, at = Date.now()) {
  if (!iso) return false;
  return new Date(iso).getTime() < at;
}

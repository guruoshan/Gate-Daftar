import crypto from 'crypto';

const KEYLEN = 32;
const failures = new Map();

export function generatePin(length = Number(process.env.PIN_LENGTH || 6)) {
  const len = Math.max(6, Number(length) || 6);
  let out = '';
  while (out.length < len) {
    out += String(crypto.randomInt(0, 10));
  }
  return out;
}

export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPin(pin, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  const actual = crypto.scryptSync(String(pin || ''), salt, expected.length || KEYLEN);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function pinKey(siteId, ip) {
  return `${siteId}|${ip || 'unknown'}`;
}

export function isLocked(key) {
  const rec = failures.get(key);
  if (!rec || !rec.lockedUntil) return { locked: false };
  if (Date.now() < rec.lockedUntil) {
    return { locked: true, retryAfterMs: rec.lockedUntil - Date.now() };
  }
  failures.delete(key);
  return { locked: false };
}

export function recordFailure(key) {
  const max = Number(process.env.PIN_LOCK_MAX_FAILURES || 5);
  const base = Number(process.env.PIN_LOCK_BASE_MS || 30000);
  const rec = failures.get(key) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= max) {
    const over = rec.count - max;
    rec.lockedUntil = Date.now() + base * 2 ** over;
  }
  failures.set(key, rec);
  return rec;
}

export function clearFailures(key) {
  failures.delete(key);
}

export function resetPinState() {
  failures.clear();
}

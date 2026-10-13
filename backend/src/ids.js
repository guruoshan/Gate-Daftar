import crypto from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function id(prefix = '') {
  return `${prefix}${crypto.randomBytes(8).toString('hex')}`;
}

export function token(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function shortCode(len = 4) {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}

export function now() {
  return new Date().toISOString();
}

export function digits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

const buckets = new Map();
const openStreams = new Map();

function ipOf(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function consume(key, windowMs, max) {
  const now = Date.now();
  const rec = buckets.get(key);
  if (!rec || now >= rec.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  rec.count += 1;
  if (rec.count > max) {
    return { ok: false, retryAfterMs: rec.resetAt - now };
  }
  return { ok: true };
}

function limitEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function rateLimit({ name, windowMs, max, envMax }) {
  return (req, res, next) => {
    const limit = envMax ? limitEnv(envMax, max) : max;
    const key = `${name}:${ipOf(req)}`;
    const result = consume(key, windowMs, limit);
    if (!result.ok) {
      res.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      return res.status(429).json({ error: 'rate_limited' });
    }
    return next();
  };
}

export function acquireStream(siteId, req) {
  const ip = ipOf(req);
  const perIp = limitEnv('RATE_LIMIT_STREAMS_PER_IP', 8);
  const perSite = limitEnv('RATE_LIMIT_STREAMS_PER_SITE', 80);
  const siteCount = openStreams.get(`s:${siteId}`) || 0;
  const ipCount = openStreams.get(`i:${siteId}:${ip}`) || 0;
  if (siteCount >= perSite || ipCount >= perIp) {
    return { ok: false };
  }
  openStreams.set(`s:${siteId}`, siteCount + 1);
  openStreams.set(`i:${siteId}:${ip}`, ipCount + 1);
  return {
    ok: true,
    release() {
      openStreams.set(`s:${siteId}`, Math.max(0, (openStreams.get(`s:${siteId}`) || 1) - 1));
      openStreams.set(`i:${siteId}:${ip}`, Math.max(0, (openStreams.get(`i:${siteId}:${ip}`) || 1) - 1));
    },
  };
}

export function resetRateLimits() {
  buckets.clear();
  openStreams.clear();
}

import crypto from 'crypto';

// Canonical, order independent serialisation of an audit row (minus its hash),
// so the chain can be verified after a database round trip or a re-import.
export function auditBase(row) {
  return {
    id: row.id,
    at: row.at,
    siteId: row.siteId || '',
    companyId: row.companyId || '',
    action: row.action,
    actorRole: row.actorRole || 'system',
    actorName: row.actorName || '',
    actorHint: row.actorHint || '',
    entryId: row.entryId || '',
    reason: row.reason || '',
    ip: row.ip || '',
    device: row.device || '',
    prev: row.prev,
  };
}

export function hashAudit(base) {
  const keys = Object.keys(base).sort();
  return crypto.createHash('sha256').update(base.prev + JSON.stringify(base, keys)).digest('hex');
}

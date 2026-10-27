const inbox = [];

export function resetMail() {
  inbox.length = 0;
}

export function lastMail() {
  return inbox[inbox.length - 1] || null;
}

export function assertMailConfigured(env = process.env) {
  if (env.NODE_ENV === 'production' && !env.SMTP_URL) {
    const err = new Error('mail_not_configured');
    err.code = 'mail_not_configured';
    throw err;
  }
}

function deliver(line, record) {
  assertMailConfigured();
  inbox.push(record);
  process.stdout.write(`${line}\n`);
  return { delivered: true };
}

export function sendPersonAddEmail({ to, pageUrl, token, request, siteName, lang }) {
  const record = {
    kind: 'person_add',
    to: String(to || '').trim().toLowerCase(),
    pageUrl: String(pageUrl || ''),
    token: String(token || ''),
    requestId: request?.id || '',
    lang: lang === 'en' ? 'en' : 'ar',
    siteName: siteName || '',
  };
  return deliver(`gate-daftar add-person mail for ${record.to}: ${record.pageUrl}`, record);
}

export function sendApprovalEmail({ to, pageUrl, token, entry, siteName, lang }) {
  const record = {
    kind: 'approval',
    to: String(to || '').trim().toLowerCase(),
    pageUrl: String(pageUrl || ''),
    token: String(token || ''),
    entryId: entry?.id || '',
    lang: lang === 'en' ? 'en' : 'ar',
    siteName: siteName || '',
  };
  return deliver(`gate-daftar approval mail for ${record.to}: ${record.pageUrl}`, record);
}

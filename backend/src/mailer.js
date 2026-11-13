import nodemailer from 'nodemailer';

// Messages kept in memory for the automatic tests and for local development only.
const inbox = [];

export function resetMail() {
  inbox.length = 0;
}

export function lastMail() {
  return inbox[inbox.length - 1] || null;
}

export function assertMailConfigured(env = process.env) {
  if (env.NODE_ENV === 'production' && !env.SMTP_URL && env.ALLOW_DEV_CODES !== '1') {
    const err = new Error('mail_not_configured');
    err.code = 'mail_not_configured';
    throw err;
  }
}

let cached = { url: '', transport: null };

function getTransport() {
  const url = process.env.SMTP_URL;
  if (!url) return null;
  if (cached.url !== url) {
    cached = { url, transport: nodemailer.createTransport(url) };
  }
  return cached.transport;
}

function fromAddress() {
  return process.env.MAIL_FROM || 'Gate Daftar <no-reply@localhost>';
}

function send(message) {
  const transport = getTransport();
  if (!transport) return;
  // Sent in the background. A failure is logged without the message contents,
  // because those contain login codes and approval links.
  transport
    .sendMail({ from: fromAddress(), ...message })
    .catch((err) => {
      process.stderr.write(`mail could not be sent: ${err?.code || err?.message || 'unknown error'}\n`);
    });
}

function deliver(record, message) {
  assertMailConfigured();
  const real = Boolean(process.env.SMTP_URL);
  if (real) send({ to: record.to, ...message });
  // Local development and tests: keep a copy and print it so it can be read.
  if (!real || process.env.NODE_ENV === 'test') inbox.push(record);
  if (!real) process.stdout.write(`${message.text}\n`);
  return { delivered: true };
}

export function sendLoginCode(email, code) {
  const to = String(email || '').trim().toLowerCase();
  return deliver(
    { kind: 'login', to, code: String(code || '') },
    {
      subject: 'Your Gate Daftar login code',
      text: `Your Gate Daftar login code is ${code}. It works for 10 minutes. If you did not ask for it, ignore this email.`,
    },
  );
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
  const arabic = record.lang === 'ar';
  const subject = arabic ? 'طلب خروج بانتظار موافقتك' : 'A gate out-pass needs your decision';
  const text = arabic
    ? `لديك طلب خروج بانتظار موافقتك. افتح الرابط للموافقة أو الرفض: ${record.pageUrl}\nينتهي الرابط خلال 12 ساعة.`
    : `You have a gate out-pass waiting for your decision. Open this link to approve or deny: ${record.pageUrl}\nThe link expires in 12 hours.`;
  return deliver(record, { subject, text });
}

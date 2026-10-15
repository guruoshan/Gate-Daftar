export function sendLoginCode(email, code) {
  if (process.env.NODE_ENV === 'production' && !process.env.SMTP_URL) {
    throw new Error('mail_not_configured');
  }
  process.stdout.write(`gate-daftar login code for ${email}: ${code}\n`);
  return { delivered: true };
}

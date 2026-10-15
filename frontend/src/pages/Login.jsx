import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function Login({ t }) {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function request(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const d = await api.requestCode({ email });
      setSent(true);
      if (d.devCode) setDevCode(d.devCode);
    } catch {
      setErr(t.required);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const d = await api.verifyCode({ email, code });
      if (d.site?.slug) nav(`/reports/${d.site.slug}`, { replace: true });
      else nav('/', { replace: true });
    } catch {
      setErr(t.pinBad);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <h1>{t.ownerLogin}</h1>
      <form className="card" onSubmit={sent ? verify : request}>
        <label htmlFor="oe">{t.ownerEmail}</label>
        <input
          id="oe"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {sent && (
          <>
            <label htmlFor="oc">{t.enterCode}</label>
            <input id="oc" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
            {devCode && <p className="muted">{`${t.enterCode}: ${devCode}`}</p>}
          </>
        )}
        {err && <div className="field-err">{err}</div>}
        <div className="cta-row">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? t.sending : sent ? t.verify : t.sendCode}
          </button>
        </div>
      </form>
    </main>
  );
}

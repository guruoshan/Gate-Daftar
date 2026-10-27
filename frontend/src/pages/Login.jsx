import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function Login({ t }) {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api.login({ email, password });
      nav('/home', { replace: true });
    } catch {
      setErr(t.badLogin);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <h1>{t.ownerLogin}</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="oe">{t.ownerEmail}</label>
        <input
          id="oe"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="op">{t.password}</label>
        <input
          id="op"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && <div className="field-err">{err}</div>}
        <div className="cta-row">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? t.sending : t.verify}
          </button>
        </div>
      </form>
      <p className="muted">
        <Link to="/setup">{t.signUp}</Link>
      </p>
    </main>
  );
}

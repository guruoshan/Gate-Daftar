import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';

export default function ResetPassword({ t }) {
  const { token } = useParams();
  const [state, setState] = useState('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    api
      .resetGet(token)
      .then(() => {
        if (!stop) setState('form');
      })
      .catch((fail) => {
        if (!stop) setState(fail.status === 410 || fail.status === 404 ? 'expired' : 'expired');
      });
    return () => {
      stop = true;
    };
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (password !== confirm) {
      setErr('mismatch');
      return;
    }
    if (password.length < 8) {
      setErr('short');
      return;
    }
    setBusy(true);
    try {
      await api.resetPost(token, { password, confirm });
      setState('done');
    } catch (fail) {
      const code = fail.body?.error;
      if (code === 'password_short') setErr('short');
      else if (code === 'password_mismatch') setErr('mismatch');
      else if (code === 'token_expired' || fail.status === 410 || fail.status === 404) setState('expired');
      else setErr('fail');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <main className="wrap">
        <p className="lede">{t.resetTitle}</p>
      </main>
    );
  }

  if (state === 'expired') {
    return (
      <main className="wrap">
        <h1>{t.resetTitle}</h1>
        <p className="lede">{t.linkExpired}</p>
        <p>
          <Link to="/login">{t.ownerLogin}</Link>
        </p>
      </main>
    );
  }

  if (state === 'done') {
    return (
      <main className="wrap">
        <h1>{t.resetTitle}</h1>
        <p className="lede">{t.savePassword}</p>
        <p>
          <Link to="/login">{t.ownerLogin}</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="wrap">
      <h1>{t.resetTitle}</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="np">{t.newPassword}</label>
        <input
          id="np"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err === 'short' && <div className="field-err">{t.passwordShort}</div>}
        <label htmlFor="cp">{t.confirmPassword}</label>
        <input
          id="cp"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {err === 'mismatch' && <div className="field-err">{t.passwordMismatch}</div>}
        {err === 'fail' && <div className="field-err">{t.signupFail}</div>}
        <div className="cta-row">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? t.sending : t.savePassword}
          </button>
        </div>
      </form>
    </main>
  );
}

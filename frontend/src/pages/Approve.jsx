import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { IconCheck, IconX } from '../icons.jsx';

export default function Approve({ t, lang, setLang }) {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [denyReason, setDenyReason] = useState('');

  useEffect(() => {
    let stop = false;
    api.approveGet(token)
      .then((d) => {
        if (stop) return;
        setData(d);
      })
      .catch(() => setErr('not_found'));
    return () => {
      stop = true;
    };
  }, [token]);

  async function act(decision, current) {
    setBusy(true);
    try {
      const d = await api.approvePost(token, decision, denyReason);
      setData((prev) => ({ ...(current || prev), ...d, entry: d.entry || prev?.entry, request: d.request || prev?.request }));
    } catch (e) {
      if (e.body?.entry) setData((prev) => ({ ...prev, entry: e.body.entry }));
      else if (e.body?.request) setData((prev) => ({ ...prev, kind: 'person_add', request: e.body.request }));
      else setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const addReq = data?.kind === 'person_add' ? data.request : null;
  const entry = addReq ? null : data?.entry;
  const decided = addReq
    ? addReq.status !== 'waiting'
    : entry && entry.status !== 'waiting_approval';
  const ok = addReq
    ? addReq.status === 'approved'
    : entry?.status === 'approved_out' || entry?.status === 'out' || entry?.status === 'returned';

  return (
    <div>
      <header className="topbar">
        <div className="brand">
          <span className="mark">GD</span>
          <span>
            <span className="brand-name">{addReq ? t.addPersonTitle : t.magicTitle}</span>
            <span className="brand-tag">{t.noLogin}</span>
          </span>
        </div>
        <button type="button" className="lang-btn" onClick={setLang}>
          {t.lang}
        </button>
      </header>
      <main className="wrap">

      {!entry && !addReq && err && (
        <article className="card">
          <h2>{t.linkExpired}</h2>
        </article>
      )}

      {addReq && (
        <article className="card">
          <div className={`badge ${ok ? 'b-ok' : decided ? 'b-bad' : 'b-wait'}`}>
            {ok ? t.approve : decided ? t.denied : t.waitMgr}
          </div>
          <h1 style={{ maxWidth: 'none' }}>{addReq.name}</h1>
          <p className="meta">
            {data.site?.name || ''}
            {addReq.employeeId ? ` · ${addReq.employeeId}` : ''}
          </p>
          {decided ? (
            <h3>{ok ? t.approvedOk : t.deniedOk}</h3>
          ) : (
            <>
              <label htmlFor="dr">{t.denyReason}</label>
              <input id="dr" value={denyReason} onChange={(e) => setDenyReason(e.target.value)} />
              <div className="cta-row">
                <button className="btn-ok" type="button" disabled={busy} onClick={() => act('approve')} style={{ flex: 1, display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                  <IconCheck /> {t.approve}
                </button>
                <button className="btn-bad" type="button" disabled={busy} onClick={() => act('deny')} style={{ flex: 1, display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                  <IconX /> {t.deny}
                </button>
              </div>
            </>
          )}
        </article>
      )}

      {entry && (
        <article className="card">
          <div className={`badge ${ok ? 'b-ok' : decided ? 'b-bad' : 'b-wait'}`}>
            {ok ? t.approve : decided ? t.denied : t.waitMgr}
          </div>
          <h1 style={{ maxWidth: 'none' }}>{entry.name}</h1>
          <p className="meta">
            {data.site?.name || ''}
            {entry.employeeId ? ` · ${entry.employeeId}` : ''}
            {` · ${t.token} ${entry.dayToken}`}
          </p>
          <p>
            <strong>{t.reason}:</strong> {entry.reason}
          </p>
          <p className="muted">
            {t.duration}: {entry.expectedMinutes} {t.minutes}
          </p>

          {decided ? (
            <h3>{ok ? t.approvedOk : t.deniedOk}</h3>
          ) : (
            <>
              <label htmlFor="dr">{t.denyReason}</label>
              <input id="dr" value={denyReason} onChange={(e) => setDenyReason(e.target.value)} />
              <div className="cta-row">
                <button className="btn-ok" type="button" disabled={busy} onClick={() => act('approve')} style={{ flex: 1, display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                  <IconCheck /> {t.approve}
                </button>
                <button className="btn-bad" type="button" disabled={busy} onClick={() => act('deny')} style={{ flex: 1, display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                  <IconX /> {t.deny}
                </button>
              </div>
            </>
          )}
        </article>
      )}
      </main>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { fmtTime, useLive } from '../useLive.js';

// The admin's live list of out-passes: who still waits for the manager, and who waits for the final approval.
export default function Admin({ t, lang }) {
  const { siteId } = useParams();
  const nav = useNavigate();
  const { site, entries, live } = useLive(siteId, lang);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [reasonFor, setReasonFor] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    api.snapshot(siteId, lang).catch((e) => {
      if (e.status === 401 || e.status === 403) nav('/login', { replace: true });
    });
  }, [siteId, lang, nav]);

  const tz = site?.timezone;
  const passes = entries.filter((e) => e.kind === 'outpass');
  const needsFinal = passes.filter((e) => e.status === 'waiting_admin');
  const waitingManager = passes.filter((e) => e.status === 'waiting_approval');
  const canLeave = passes.filter((e) => e.status === 'approved_out');

  async function decide(entry, decision) {
    setBusy(entry.id);
    setErr('');
    try {
      await api.finalDecision(entry.id, decision, decision === 'deny' ? reason : '');
      setReasonFor('');
      setReason('');
    } catch (e) {
      setErr(e.body?.error === 'invalid_state' ? t.linkExpired : t.required);
    } finally {
      setBusy('');
    }
  }

  function Card({ entry, actions }) {
    return (
      <div className="row" key={entry.id}>
        <div className="row-top">
          <div>
            <div className="who">
              {entry.name}
              {entry.employeeId ? ` · ${entry.employeeId}` : ''}
            </div>
            <div className="meta">
              {entry.reason}
              {entry.expectedMinutes ? ` · ${entry.expectedMinutes}${t.minutes}` : ''}
              {entry.dayToken ? ` · ${t.token} ${entry.dayToken}` : ''}
            </div>
            <div className="meta">
              {t.managerLabel}: {entry.managerName || '-'}
              {entry.managerPhone ? ` · ${entry.managerPhone}` : ''}
            </div>
            {entry.decidedAt && (
              <div className="meta">
                {t.approvedByManager} · {t.approvedAtLabel} {fmtTime(entry.decidedAt, lang, tz)}
              </div>
            )}
            {entry.adminDecidedAt && (
              <div className="meta">
                {t.finalBy}: {entry.adminName} · {fmtTime(entry.adminDecidedAt, lang, tz)}
              </div>
            )}
          </div>
        </div>
        {actions}
      </div>
    );
  }

  return (
    <main className="wrap">
      <h1>{t.approvalsTitle}</h1>
      <p className="lede">
        {site?.name || ''} <span className={`badge ${live ? 'b-ok' : 'b-wait'}`}>{t.live}</span>
      </p>
      <div className="cta-row" style={{ marginBottom: 12 }}>
        <Link className="ghost" to={`/setup/${siteId}`}>{t.openSetup}</Link>
        <Link className="ghost" to={`/reports/${siteId}`}>{t.openReports}</Link>
      </div>
      {err && <div className="field-err">{err}</div>}

      <h2>{t.needsFinal}</h2>
      <div className="list" style={{ paddingInline: 0 }}>
        {needsFinal.length === 0 && <p className="muted">{t.noRequests}</p>}
        {needsFinal.map((e) => (
          <Card
            key={e.id}
            entry={e}
            actions={
              <div className="actions">
                {reasonFor === e.id ? (
                  <>
                    <input value={reason} placeholder={t.denyReason} onChange={(ev) => setReason(ev.target.value)} />
                    <button type="button" className="btn-bad" disabled={busy === e.id} onClick={() => decide(e, 'deny')}>
                      {t.finalDeny}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn-ok" disabled={busy === e.id} onClick={() => decide(e, 'approve')}>
                      {t.finalApprove}
                    </button>
                    <button type="button" className="btn-bad" onClick={() => setReasonFor(e.id)}>
                      {t.finalDeny}
                    </button>
                  </>
                )}
              </div>
            }
          />
        ))}
      </div>

      <h2>{t.waitingManager}</h2>
      <div className="list" style={{ paddingInline: 0 }}>
        {waitingManager.length === 0 && <p className="muted">{t.noRequests}</p>}
        {waitingManager.map((e) => (
          <Card key={e.id} entry={e} />
        ))}
      </div>

      <h2>{t.canLeaveNow}</h2>
      <div className="list" style={{ paddingInline: 0 }}>
        {canLeave.length === 0 && <p className="muted">{t.noRequests}</p>}
        {canLeave.map((e) => (
          <Card key={e.id} entry={e} />
        ))}
      </div>
    </main>
  );
}

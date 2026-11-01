import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { IconPlus, IconQr } from '../icons.jsx';
import PhoneField from '../components/PhoneField.jsx';
import { entryFields, matchQuery, phoneOk } from '../countries.js';
import {
  approvedList,
  fmtTime,
  insideList,
  isOverdue,
  useLive,
  waitingList,
} from '../useLive.js';

const DURS = [45, 60, 90, 180];
function statusLabel(t, status) {
  if (status === 'waiting_admit') return t.waitAdmit;
  if (status === 'waiting_approval') return t.waitMgr;
  if (status === 'approved_out') return t.goOut;
  if (status === 'inside') return t.onSite;
  if (status === 'out') return t.stillOut;
  if (status === 'returned') return t.returned;
  if (status === 'denied') return t.denied;
  if (status === 'unapproved_leave') return t.leftUnauth;
  if (status === 'exited') return t.exited;
  return status;
}

function badgeClass(status, overdue) {
  if (overdue || status === 'denied' || status === 'unapproved_leave') return 'b-bad';
  if (status === 'inside' || status === 'returned' || status === 'approved_out') return 'b-ok';
  if (status === 'waiting_admit' || status === 'waiting_approval' || status === 'out') return 'b-wait';
  return 'b-in';
}

export default function Booth({ t, lang, setLang }) {
  const { siteId } = useParams();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [pin, setPin] = useState('');
  const [pinErr, setPinErr] = useState('');
  const [tab, setTab] = useState('waiting');
  const [modal, setModal] = useState(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [q, setQ] = useState('');
  const [una, setUna] = useState(null);
  const [remoteHits, setRemoteHits] = useState([]);
  const [nextCursor, setNextCursor] = useState('');
  const [searching, setSearching] = useState(false);

  const live = useLive(authed ? siteId : '', lang);
  const { site, people, entries, live: isLive } = live;

  useEffect(() => {
    let stop = false;
    api.snapshot(siteId, lang)
      .then(() => {
        if (!stop) setAuthed(true);
      })
      .catch(() => {
        if (!stop) setAuthed(false);
      })
      .finally(() => {
        if (!stop) setChecking(false);
      });
    return () => {
      stop = true;
    };
  }, [siteId, lang]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(id);
  }, [toast]);

  async function unlock(code) {
    setPinErr('');
    try {
        await api.unlock({ slug: siteId, pin: code });
       setAuthed(true);
    } catch {
      setPinErr(t.pinBad);
      setPin('');
    }
  }

  const PIN_LEN = 6;

  function press(n) {
    const next = (pin + n).slice(0, PIN_LEN);
    setPin(next);
    if (next.length === PIN_LEN) unlock(next);
  }

  const waiting = waitingList(entries);
  const approved = approvedList(entries);
  const inside = insideList(entries);
  const overdue = entries.filter(isOverdue);
  useEffect(() => {
    const query = q.trim();
    if (!authed || !query) {
      setRemoteHits([]);
      setNextCursor('');
      return undefined;
    }
    let stop = false;
    setSearching(true);
    api.search(siteId, query)
      .then((d) => {
        if (stop) return;
        setRemoteHits(d.entries || []);
        setNextCursor(d.nextCursor || '');
      })
      .catch(() => {
        if (!stop) setRemoteHits([]);
      })
      .finally(() => {
        if (!stop) setSearching(false);
      });
    return () => {
      stop = true;
    };
  }, [authed, siteId, q]);

  const searched = useMemo(() => {
    const query = q.trim();
    if (!query) return entries;
    const local = entries.filter((e) => matchQuery(entryFields(e), query));
    const seen = new Set(local.map((e) => e.id));
    return [...local, ...remoteHits.filter((e) => !seen.has(e.id))];
  }, [entries, q, remoteHits]);

  const counts = {
    waiting: waiting.length,
    approved: approved.length,
    inside: inside.length,
      search: q.trim() ? searched.length : entries.length,
  };

  if (checking && !authed) {
    return (
      <main className="wrap">
        <p className="lede">{t.booth}</p>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="wrap">
        <h1>{t.pinUnlock}</h1>
        <p className="lede">{siteId === 'demo' ? t.demoHint : t.booth}</p>
        <div className="card">
          <div className="token-xl" style={{ textAlign: 'center' }}>
            {pin.padEnd(PIN_LEN, '·')}
          </div>
          {pinErr && <div className="field-err">{pinErr}</div>}
          <div className="pin-pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) => (
              <button
                key={k || 'sp'}
                type="button"
                disabled={!k}
                aria-label={k === '⌫' ? 'backspace' : k || undefined}
                onClick={() => {
                  if (k === '⌫') setPin((p) => p.slice(0, -1));
                  else if (k) press(k);
                }}
              >
                {k}
              </button>
            ))}
          </div>
          <div className="cta-row">
            <button
              type="button"
              className="btn"
              disabled={pin.length < 4}
              onClick={() => unlock(pin)}
              style={{ flex: 1 }}
            >
              {t.submit}
            </button>
            <button type="button" className="lang-btn" onClick={setLang} style={{ flex: 1 }}>
              {t.lang}
            </button>
          </div>
        </div>
      </main>
    );
  }

  const list =
    tab === 'waiting' ? waiting : tab === 'approved' ? approved : tab === 'inside' ? inside : searched;

  return (
    <div>
      <header className="topbar">
        <div className="brand">
          <span className="mark">GD</span>
          <span>
            <span className="brand-name">{site?.name || t.app}</span>
            <span className="brand-tag">{t.booth}</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="live">
            <span className={`dot ${isLive ? '' : 'off'}`} />
            {isLive ? t.live : t.offline}
          </span>
          <button type="button" className="lang-btn" onClick={setLang}>
            {t.lang}
          </button>
        </div>
      </header>

      {overdue.length > 0 && (
        <div className="overdue-strip">
          {t.overdue}: {overdue.map((e) => e.name).join(' · ')}
        </div>
      )}

      <div className="dual">
        <button type="button" className="btn" onClick={() => setModal('create')} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <IconPlus /> {t.createPass}
        </button>
        <button type="button" className="ghost" onClick={() => setQrOpen(true)} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <IconQr /> {t.gateQr}
        </button>
      </div>

      <div className="search-bar">
        <label htmlFor="q">{t.search}</label>
        <input
          id="q"
          type="search"
          inputMode="search"
          autoComplete="off"
          value={q}
          placeholder={t.searchPh}
          onChange={(e) => {
            setQ(e.target.value);
            setTab('search');
          }}
          onFocus={() => setTab('search')}
        />
      </div>

      <nav className="tabs" aria-label={t.booth}>
        {[
          ['waiting', t.waiting],
          ['approved', t.approved],
          ['inside', t.inside],
          ['search', t.search],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab ${tab === id ? 'on' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
            <small>{counts[id]}</small>
          </button>
        ))}
      </nav>

      <section className="list">
        {list.length === 0 && (
          <div className="empty">
            {tab === 'waiting' && t.emptyWait}
            {tab === 'approved' && t.emptyApproved}
            {tab === 'inside' && t.emptyInside}
            {tab === 'search' && (searching ? t.sending : q ? t.noResults : t.emptySearch)}
          </div>
        )}
        {list.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            t={t}
            lang={lang}
            timeZone={site?.timezone}
            onToast={setToast}
            onUna={setUna}
          />
        ))}
        {tab === 'search' && nextCursor && (
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              try {
                const d = await api.search(siteId, q, nextCursor);
                setRemoteHits((prev) => [...prev, ...(d.entries || [])]);
                setNextCursor(d.nextCursor || '');
              } catch {
                setNextCursor('');
              }
            }}
          >
            {t.loadMore}
          </button>
        )}
      </section>

      {modal === 'create' && (
        <CreatePass
          t={t}
          lang={lang}
          siteId={site?.id || siteId}
          iso={site?.countryIso || 'SA'}
          people={people}
          onClose={() => setModal(null)}
          onToast={setToast}
        />
      )}
      {qrOpen && <QrModal t={t} siteId={site?.slug || siteId} onClose={() => setQrOpen(false)} />}
      {una && (
        <UnapprovedModal
          t={t}
          entry={una}
          onClose={() => setUna(null)}
          onDone={() => {
            setUna(null);
            setToast(t.leftUnauth);
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function EntryCard({ entry, t, lang, timeZone, onToast, onUna }) {
  const overdue = isOverdue(entry);
  async function run(fn, okMsg) {
    try {
      await fn();
      if (okMsg) onToast(okMsg);
    } catch (e) {
      onToast(e.body?.error === 'invalid_state' ? t.invalidState : t.already);
    }
  }

  return (
    <article className="row">
      <div className="row-top">
        <div>
          <div className="who">{entry.name}</div>
          <div className="meta">
            {entry.kind === 'visitor' ? t.visitor : t.outpass}
            {` · ${t.token} ${entry.dayToken}`}
            {entry.phone ? ` · ${entry.phone}` : ''}
            {entry.employeeId ? ` · ${entry.employeeId}` : ''}
            {entry.source === 'qr' ? ` · ${t.sourceQr}` : ` · ${t.sourceGuard}`}
            {entry.createdAt ? ` · ${fmtTime(entry.createdAt, lang, timeZone)}` : ''}
          </div>
          {entry.kind === 'visitor' && (
            <div className="meta">
              {[entry.company, entry.purpose, entry.hostName, entry.vehicle].filter(Boolean).join(' · ')}
            </div>
          )}
          {entry.kind === 'outpass' && (
            <div className="meta">
              {entry.reason}
              {entry.managerName ? ` · ${entry.managerName}` : ''}
              {entry.expectedMinutes ? ` · ${entry.expectedMinutes}${t.minutes}` : ''}
            </div>
          )}
        </div>
        <span className={`badge ${badgeClass(entry.status, overdue)}`}>
          {overdue ? t.overdue : statusLabel(t, entry.status)}
        </span>
      </div>
      <div className="actions">
        {entry.status === 'waiting_admit' && (
          <button type="button" className="btn-ok" onClick={() => run(() => api.admit(entry.id), t.admit)}>
            {t.admit}
          </button>
        )}
        {entry.status === 'inside' && (
          <button type="button" className="btn-in" onClick={() => run(() => api.exit(entry.id), t.exit)}>
            {t.exit}
          </button>
        )}
        {entry.status === 'waiting_approval' && (
          <>
            {entry.managerName ? <span className="meta">{entry.managerName}</span> : null}
            <button type="button" className="ghost" onClick={() => run(() => api.resend(entry.id, lang), t.resent)}>
              {t.resend}
            </button>
            <button type="button" className="btn-bad" onClick={() => onUna(entry)}>
              {t.unapproved}
            </button>
          </>
        )}
        {entry.status === 'approved_out' && (
          <>
            <button type="button" className="btn-ok" onClick={() => run(() => api.logOut(entry.id), t.logOut)}>
              {t.logOut}
            </button>
            <button type="button" className="btn-bad" onClick={() => onUna(entry)}>
              {t.unapproved}
            </button>
          </>
        )}
        {entry.status === 'out' && (
          <button type="button" className="btn-in" onClick={() => run(() => api.logIn(entry.id), t.logIn)}>
            {t.logIn}
          </button>
        )}
      </div>
    </article>
  );
}

function CreatePass({ t, lang, siteId, iso = 'SA', people, onClose, onToast }) {
  const [kind, setKind] = useState('visitor');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState(null);
  const [v, setV] = useState({ name: '', phone: '', company: '', purpose: '', hostName: '', vehicle: '', idNumber: '', cardNumber: '' });
  const [o, setO] = useState({ personId: '', managerId: '', reason: '', expectedMinutes: 60 });
  const [notOnList, setNotOnList] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', employeeId: '', managerId: '' });
  const [addDone, setAddDone] = useState(false);
  const managers = people.filter((p) => p.role === 'manager');
  const employees = people.filter((p) => p.role !== 'manager' && p.role !== 'guard');
  const picked = employees.find((p) => p.id === o.personId);

  function pickEmp(id) {
    const p = employees.find((x) => x.id === id);
    if (!p) {
      setO({ ...o, personId: '', managerId: '' });
      return;
    }
    setO({
      ...o,
      personId: p.id,
      managerId: p.managerId || o.managerId,
    });
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (kind === 'visitor') {
        if (!v.name.trim() || !phoneOk(v.phone)) {
          setErr(!v.name.trim() ? 'req' : 'phone');
          setBusy(false);
          return;
        }
        await api.visitor(siteId, { ...v, source: 'guard' });
        onToast(t.visitor);
      } else {
        if (notOnList) {
          if (!addForm.name.trim() || !addForm.managerId) {
            setErr('req');
            setBusy(false);
            return;
          }
          await api.requestAdd(siteId, { ...addForm, lang });
          setAddDone(true);
          return;
        }
        if (!o.personId || !o.managerId || !o.reason.trim()) {
          setErr('req');
          setBusy(false);
          return;
        }
        const made = await api.outpass(siteId, { ...o, source: 'guard', lang });
        onToast(t.outpass);
        setCreated(made.entry);
        return;
      }
      onClose();
    } catch (fail) {
      const code = fail.body?.error;
      if (code === 'phone_invalid') setErr('phone');
      else if (code === 'email_domain_not_allowed') setErr('email_domain');
      else if (code === 'mail_not_configured') setErr('mail');
      else if (code === 'already_on_list') setErr('already');
      else if (code === 'manager_required') setErr('manager');
      else setErr('fail');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {addDone ? (
          <>
            <h2>{t.addPersonTitle}</h2>
            <p className="muted">{t.addRequested}</p>
            <button type="button" className="btn" onClick={onClose}>{t.close}</button>
          </>
        ) : created ? (
          <>
            <h2>{t.outpass}</h2>
            <p className="muted">{t.sayToken}</p>
            <div className="token-xl">{created.dayToken}</div>
            <p className="muted">{created.managerName ? `${created.name} · ${created.managerName}` : created.name}</p>
            <p className="muted">{t.emailSent}</p>
            <button type="button" className="btn" onClick={onClose}>{t.close}</button>
          </>
        ) : (
          <>
        <h2>{t.createPass}</h2>
        <div className="seg">
          <button type="button" className={kind === 'visitor' ? 'btn' : 'ghost'} onClick={() => setKind('visitor')}>
            {t.visitor}
          </button>
          <button type="button" className={kind === 'outpass' ? 'btn' : 'ghost'} onClick={() => setKind('outpass')}>
            {t.outpass}
          </button>
        </div>
        <form onSubmit={submit}>
          {kind === 'visitor' ? (
            <>
              <label htmlFor="vn">{t.name}<span className="req">*</span></label>
              <input id="vn" value={v.name} placeholder={t.namePh} onChange={(e) => setV({ ...v, name: e.target.value })} />
              <PhoneField
                id="vp"
                label={t.phone}
                required
                iso={iso}
                value={v.phone}
                onChange={(phone) => setV({ ...v, phone })}
                t={t}
                lang={lang}
                error={err === 'phone' ? t.phoneInvalid : ''}
              />
              <label htmlFor="vc">{t.company}</label>
              <input id="vc" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} />
              <label htmlFor="vu">{t.purpose}</label>
              <input id="vu" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })} />
              <label htmlFor="vh">{t.host}</label>
              <input id="vh" value={v.hostName} onChange={(e) => setV({ ...v, hostName: e.target.value })} />
              <label htmlFor="vv">{t.vehicle}</label>
              <input id="vv" value={v.vehicle} onChange={(e) => setV({ ...v, vehicle: e.target.value })} />
              <label htmlFor="vi">{t.idCard}</label>
              <input id="vi" value={v.idNumber} onChange={(e) => setV({ ...v, idNumber: e.target.value })} />
              <label htmlFor="vcd">{t.card}</label>
              <input id="vcd" value={v.cardNumber} onChange={(e) => setV({ ...v, cardNumber: e.target.value })} />
            </>
          ) : (
            <>
              <p className="muted">{t.rosterOnly}</p>
              <button
                type="button"
                className={notOnList ? 'btn' : 'ghost'}
                onClick={() => setNotOnList((v) => !v)}
              >
                {t.notOnList}
              </button>
              {notOnList ? (
                  <>
                    <label htmlFor="an">{t.personName}<span className="req">*</span></label>
                    <input id="an" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
                    <label htmlFor="aid">{t.empId}</label>
                    <input id="aid" value={addForm.employeeId} onChange={(e) => setAddForm({ ...addForm, employeeId: e.target.value })} />
                    <label htmlFor="am">{t.selectManager}<span className="req">*</span></label>
                    <select id="am" value={addForm.managerId} onChange={(e) => setAddForm({ ...addForm, managerId: e.target.value })} disabled={managers.length === 0}>
                      <option value="">{t.selectManager}</option>
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    {managers.length === 0 && <p className="field-err">{t.needManagerFirst}</p>}
                  </>
              ) : employees.length === 0 ? (
                <p className="field-err">{t.noRoster}</p>
              ) : (
                <>
                  <label htmlFor="ep">{t.pickPerson}<span className="req">*</span></label>
                  <select id="ep" value={o.personId} onChange={(e) => pickEmp(e.target.value)}>
                    <option value="">{t.pickPerson}</option>
                    {employees.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.employeeId ? ` · ${p.employeeId}` : ''}</option>
                    ))}
                  </select>
                  {picked && <p className="muted">{picked.name}{picked.employeeId ? ` · ${picked.employeeId}` : ''}</p>}
                  <label htmlFor="om">{t.selectManager}<span className="req">*</span></label>
                  <select id="om" value={o.managerId} onChange={(e) => setO({ ...o, managerId: e.target.value })}>
                    <option value="">{t.selectManager}</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <label htmlFor="or">{t.reason}<span className="req">*</span></label>
                  <input id="or" value={o.reason} placeholder={t.reasonPh} onChange={(e) => setO({ ...o, reason: e.target.value })} />
                  <label>{t.duration}</label>
                  <div className="seg">
                    {DURS.map((m) => (
                      <button key={m} type="button" className={o.expectedMinutes === m ? 'btn' : 'ghost'} onClick={() => setO({ ...o, expectedMinutes: m })}>
                        {m === 180 ? t.duration180 : m === 45 ? t.duration45 : m === 90 ? t.duration90 : t.duration60}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {err === 'phone' && <div className="field-err">{t.phoneInvalid}</div>}
          {err === 'email_domain' && <div className="field-err">{t.emailDomainBad}</div>}
          {err === 'mail' && <div className="field-err">{t.mailNotConfigured}</div>}
          {err === 'already' && <div className="field-err">{t.alreadyOnList}</div>}
          {err === 'manager' && <div className="field-err">{t.noRoster}</div>}
          {err && err !== 'phone' && err !== 'email_domain' && err !== 'mail' && err !== 'already' && err !== 'manager' && <div className="field-err">{t.required}</div>}
          <div className="cta-row">
            <button type="button" className="ghost" onClick={onClose}>{t.cancel}</button>
            <button type="submit" className="btn" disabled={busy || (kind === 'outpass' && !notOnList && employees.length === 0) || (kind === 'outpass' && notOnList && managers.length === 0)}>{busy ? t.sending : t.submit}</button>
          </div>
        </form>
          </>
        )}
      </div>
    </div>
  );
}

function QrModal({ t, siteId, onClose }) {
  return (
    <div className="modal-bg" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <h2>{t.gateQr}</h2>
        <p className="muted">{t.gateHint}</p>
        <div className="cta-row">
          <Link className="btn" to={`/qr/${siteId}`} style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>
            {t.printQr}
          </Link>
          <button type="button" className="ghost" onClick={onClose}>{t.close}</button>
        </div>
      </div>
    </div>
  );
}

function UnapprovedModal({ t, entry, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await api.unapproved(entry.id, reason);
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-bg" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <h2>{t.confirmUnapproved}</h2>
        <p className="muted">{entry.name}</p>
        <label htmlFor="ur">{t.unapprovedReason}</label>
        <input id="ur" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="cta-row">
          <button type="button" className="ghost" onClick={onClose}>{t.cancel}</button>
          <button type="button" className="btn-bad" disabled={busy} onClick={go}>{t.unapproved}</button>
        </div>
      </div>
    </div>
  );
}

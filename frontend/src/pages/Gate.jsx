import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import ManagerFields from '../components/ManagerFields.jsx';
import PhoneField from '../components/PhoneField.jsx';
import ShareBar from '../components/ShareBar.jsx';
import { phoneOk } from '../countries.js';

const DURS = [45, 60, 90, 180];

export default function Gate({ t, lang, setLang }) {
  const { siteId } = useParams();
  const [site, setSite] = useState(null);
  const [people, setPeople] = useState([]);
  const [mode, setMode] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [v, setV] = useState({ name: '', phone: '', company: '', purpose: '', hostName: '', idNumber: '', cardNumber: '' });
  const [o, setO] = useState({ name: '', phone: '', employeeId: '', reason: '', expectedMinutes: 60, managerPhone: '', managerName: '', personId: '' });

  useEffect(() => {
    api.snapshot(siteId, lang).then((d) => {
      setSite(d.site);
      setPeople(d.people || []);
    }).catch(() => setSite({ name: '', slug: siteId, id: siteId }));
  }, [siteId, lang]);

  const managers = useMemo(() => people.filter((p) => p.role === 'manager'), [people]);
  const employees = useMemo(() => people.filter((p) => p.role !== 'manager'), [people]);
  const sid = site?.id || siteId;
  const iso = site?.countryIso || 'SA';

  async function submitVisitor(e) {
    e.preventDefault();
    setErr('');
    if (!v.name.trim() || !phoneOk(v.phone)) {
      setErr(!v.name.trim() ? 'req' : 'phone');
      return;
    }
    setBusy(true);
    try {
      const d = await api.visitor(sid, { ...v, source: 'qr' });
      setDone({ kind: 'visitor', entry: d.entry });
    } catch (fail) {
      setErr(fail.body?.error === 'phone_invalid' ? 'phone' : 'fail');
    } finally {
      setBusy(false);
    }
  }

  async function submitOut(e) {
    e.preventDefault();
    setErr('');
    if (!o.name.trim() || !o.reason.trim() || !o.managerName.trim() || !phoneOk(o.managerPhone)) {
      setErr(!phoneOk(o.managerPhone) ? 'phone' : 'req');
      return;
    }
    setBusy(true);
    try {
      const d = await api.outpass(sid, { ...o, source: 'qr', lang });
      setDone({ kind: 'outpass', entry: d.entry });
    } catch (fail) {
      setErr(fail.body?.error === 'phone_invalid' ? 'phone' : 'fail');
    } finally {
      setBusy(false);
    }
  }

  function pickEmp(id) {
    const p = employees.find((x) => x.id === id);
    if (!p) {
      setO({ ...o, personId: '' });
      return;
    }
    const mgr = people.find((x) => x.phone === p.managerPhone && x.role === 'manager');
    setO({
      ...o,
      personId: p.id,
      name: p.name,
      phone: p.phone || o.phone,
      employeeId: p.employeeId || '',
      managerPhone: p.managerPhone || o.managerPhone,
      managerName: mgr?.name || o.managerName,
    });
  }

  function pickMgr(id) {
    const m = managers.find((x) => x.id === id);
    if (!m) return;
    setO({ ...o, managerPhone: m.phone, managerName: m.name });
  }

  return (
    <div>
      <header className="topbar">
        <div className="brand">
          <span className="mark">GD</span>
          <span>
            <span className="brand-name">{site?.name || t.gateTitle}</span>
            <span className="brand-tag">{t.gateHint}</span>
          </span>
        </div>
        <button type="button" className="lang-btn" onClick={setLang}>
          {t.lang}
        </button>
      </header>
      <main className="wrap">

      {done && (
        <article className="card done-card">
          <h2>{t.thanks}</h2>
          <p className="muted">{t.sayToken}</p>
          <div className="token-xl">{done.entry.dayToken}</div>
          <p className="muted">
            {done.entry.name}
            {done.kind === 'outpass' ? ` · ${t.outpass}` : ` · ${t.visitor}`}
            {done.entry.managerName ? ` · ${done.entry.managerName}` : ''}
          </p>
          {done.kind === 'outpass' && (
            <ShareBar entry={done.entry} t={t} />
          )}
          <button type="button" className="ghost" onClick={() => { setDone(null); setMode(''); }}>
            {t.close}
          </button>
        </article>
      )}

      {!done && !mode && (
        <div className="grid-2">
          <button type="button" className="btn" style={{ minHeight: 88 }} onClick={() => setMode('visitor')}>
            {t.iVisitor}
          </button>
          <button type="button" className="ghost" style={{ minHeight: 88 }} onClick={() => setMode('outpass')}>
            {t.iEmployee}
          </button>
        </div>
      )}

      {!done && mode === 'visitor' && (
        <form className="card" onSubmit={submitVisitor}>
          <h2>{t.visitor}</h2>
          <label htmlFor="vn">{t.name}<span className="req">*</span></label>
          <input id="vn" value={v.name} placeholder={t.namePh} autoComplete="name" onChange={(e) => setV({ ...v, name: e.target.value })} />
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
          <input id="vc" value={v.company} placeholder={t.companyPh} onChange={(e) => setV({ ...v, company: e.target.value })} />
          <label htmlFor="vu">{t.purpose}</label>
          <input id="vu" value={v.purpose} placeholder={t.purposePh} onChange={(e) => setV({ ...v, purpose: e.target.value })} />
          <label htmlFor="vh">{t.host}</label>
          <input id="vh" value={v.hostName} placeholder={t.hostPh} onChange={(e) => setV({ ...v, hostName: e.target.value })} />
          <label htmlFor="vi">{t.idCard}</label>
          <input id="vi" value={v.idNumber} onChange={(e) => setV({ ...v, idNumber: e.target.value })} />
          <label htmlFor="vcd">{t.card}</label>
          <input id="vcd" value={v.cardNumber} onChange={(e) => setV({ ...v, cardNumber: e.target.value })} />
          {err && err !== 'phone' && <div className="field-err">{t.required}</div>}
          <div className="cta-row">
            <button className="ghost" type="button" onClick={() => setMode('')}>{t.cancel}</button>
            <button className="btn" type="submit" disabled={busy}>{busy ? t.sending : t.submit}</button>
          </div>
        </form>
      )}

      {!done && mode === 'outpass' && (
        <form className="card" onSubmit={submitOut}>
          <h2>{t.outpass}</h2>
          {employees.length > 0 && (
            <>
              <label htmlFor="ep">{t.pickPerson}</label>
              <select id="ep" value={o.personId} onChange={(e) => pickEmp(e.target.value)}>
                <option value="">{t.orType}</option>
                {employees.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.employeeId ? ` · ${p.employeeId}` : ''}</option>
                ))}
              </select>
            </>
          )}
          <label htmlFor="on">{t.name}<span className="req">*</span></label>
          <input id="on" value={o.name} placeholder={t.namePh} onChange={(e) => setO({ ...o, name: e.target.value })} />
          <PhoneField
            id="op"
            label={t.phone}
            iso={iso}
            value={o.phone}
            onChange={(phone) => setO({ ...o, phone })}
            t={t}
            lang={lang}
          />
          <label htmlFor="oid">{t.empId}</label>
          <input id="oid" value={o.employeeId} onChange={(e) => setO({ ...o, employeeId: e.target.value })} />
          <label htmlFor="or">{t.reason}<span className="req">*</span></label>
          <input id="or" value={o.reason} placeholder={t.reasonPh} onChange={(e) => setO({ ...o, reason: e.target.value })} />
          <label>{t.duration}</label>
          <div className="seg">
            {DURS.map((m) => (
              <button
                key={m}
                type="button"
                className={o.expectedMinutes === m ? 'btn' : 'ghost'}
                onClick={() => setO({ ...o, expectedMinutes: m })}
              >
                {m === 180 ? t.duration180 : m === 45 ? t.duration45 : m === 90 ? t.duration90 : t.duration60}
              </button>
            ))}
          </div>
          <ManagerFields t={t} lang={lang} iso={iso} o={o} setO={setO} managers={managers} pickMgr={pickMgr} />
          {err === 'phone' && <div className="field-err">{t.phoneInvalid}</div>}
          {err && err !== 'phone' && <div className="field-err">{t.required}</div>}
          <div className="cta-row">
            <button className="ghost" type="button" onClick={() => setMode('')}>{t.cancel}</button>
            <button className="btn" type="submit" disabled={busy}>{busy ? t.sending : t.submit}</button>
          </div>
        </form>
      )}
      </main>
    </div>
  );
}

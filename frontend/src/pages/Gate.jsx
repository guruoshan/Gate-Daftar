import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import PhoneField from '../components/PhoneField.jsx';
import { phoneOk } from '../countries.js';

const DURS = [45, 60, 90, 180];

export default function Gate({ t, lang, setLang }) {
  const { siteId } = useParams();
  const [site, setSite] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [managers, setManagers] = useState([]);
  const [mode, setMode] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [v, setV] = useState({ name: '', phone: '', company: '', purpose: '', hostName: '', vehicle: '', idNumber: '', cardNumber: '' });
  const [o, setO] = useState({ personId: '', managerId: '', reason: '', expectedMinutes: 60 });
  const [notOnList, setNotOnList] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', employeeId: '', managerId: '' });

  useEffect(() => {
    api.publicSite(siteId).then((d) => {
      setSite(d.site);
      setEmployees(d.employees || []);
      setManagers(d.managers || []);
    }).catch(() => setSite({ name: '', slug: siteId, id: siteId }));
  }, [siteId, lang]);

  const sid = site?.id || siteId;
  const iso = site?.countryIso || 'SA';
  const picked = useMemo(() => employees.find((p) => p.id === o.personId), [employees, o.personId]);

  async function submitVisitor(e) {
    e.preventDefault();
    setErr('');
    if (!v.name.trim() || !phoneOk(v.phone)) {
      setErr(!v.name.trim() ? 'req' : 'phone');
      return;
    }
    setBusy(true);
    try {
      const d = await api.gateVisitor(sid, { ...v });
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
    if (notOnList) {
      if (!addForm.name.trim() || !addForm.managerId) {
        setErr('req');
        return;
      }
      setBusy(true);
      try {
        await api.gateRequestAdd(sid, { ...addForm, lang });
        setDone({ kind: 'person_add' });
      } catch (fail) {
        const code = fail.body?.error;
        if (code === 'already_on_list') setErr('already_on_list');
        else if (code === 'manager_required') setErr('manager_required');
        else setErr(code || 'fail');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!o.personId || !o.managerId || !o.reason.trim()) {
      setErr('req');
      return;
    }
    setBusy(true);
    try {
      const d = await api.gateOutpass(sid, { ...o, lang });
      setDone({ kind: 'outpass', entry: d.entry });
    } catch (fail) {
      setErr(fail.body?.error || 'fail');
    } finally {
      setBusy(false);
    }
  }

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

      {done && done.kind === 'person_add' && (
        <article className="card done-card">
          <h2>{t.addPersonTitle}</h2>
          <p className="muted">{t.addRequested}</p>
          <button type="button" className="ghost" onClick={() => { setDone(null); setMode(''); setNotOnList(false); }}>
            {t.close}
          </button>
        </article>
      )}

      {done && done.kind !== 'person_add' && (
        <article className="card done-card">
          <h2>{t.thanks}</h2>
          <p className="muted">{t.sayToken}</p>
          <div className="token-xl">{done.entry.dayToken}</div>
          <p className="muted">
            {done.entry.name}
            {done.kind === 'outpass' ? ` · ${t.outpass}` : ` · ${t.visitor}`}
            {done.entry.managerName ? ` · ${done.entry.managerName}` : ''}
          </p>
          {done.kind === 'outpass' && <p className="muted">{t.emailSent}</p>}
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
          <label htmlFor="vv">{t.vehicle}</label>
          <input id="vv" value={v.vehicle} onChange={(e) => setV({ ...v, vehicle: e.target.value })} />
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
          <p className="muted">{t.rosterOnly}</p>
          <button type="button" className={notOnList ? 'btn' : 'ghost'} onClick={() => setNotOnList((v) => !v)}>
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
            </>
          )}
          {err === 'already_on_list' && <div className="field-err">{t.alreadyOnList}</div>}
          {err && err !== 'already_on_list' && (
            <div className="field-err">{err === 'email_domain_not_allowed' ? t.emailDomainBad : t.required}</div>
          )}
          <div className="cta-row">
            <button className="ghost" type="button" onClick={() => setMode('')}>{t.cancel}</button>
            <button className="btn" type="submit" disabled={busy || (!notOnList && employees.length === 0) || (notOnList && managers.length === 0)}>{busy ? t.sending : t.submit}</button>
          </div>
        </form>
      )}
      </main>
    </div>
  );
}

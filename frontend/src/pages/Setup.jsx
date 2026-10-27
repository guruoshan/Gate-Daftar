import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { IconQr } from '../icons.jsx';
import { PACKS, packLabel } from '../packs.js';
import PhoneField, { CountrySelect } from '../components/PhoneField.jsx';
import { phoneOk } from '../countries.js';
import { SITE_TIMEZONES, timezoneForCountry } from '../time.js';

function copy(text) {
  return navigator.clipboard.writeText(text);
}

export default function Setup({ t, lang }) {
  const { siteId } = useParams();
  const nav = useNavigate();
  const [form, setForm] = useState({
    companyName: '',
    gateName: '',
    ownerName: '',
    ownerEmail: '',
    password: '',
    pack: 'manufacturing',
    countryIso: 'SA',
    timezone: 'Asia/Riyadh',
  });
  const [site, setSite] = useState(null);
  const [people, setPeople] = useState([]);
  const [person, setPerson] = useState({ name: '', role: 'employee', phone: '', email: '', managerId: '', employeeId: '' });
  const [shownGuardPin, setShownGuardPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [csvResult, setCsvResult] = useState(null);
  const [csvBusy, setCsvBusy] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const boothUrl = site ? `${origin}/booth/${site.slug || site.id}` : '';
  const gateUrl = site ? `${origin}/g/${site.slug || site.id}` : '';

  useEffect(() => {
    if (!siteId) return;
    api.snapshot(siteId, lang).then((d) => {
      setSite(d.site);
      setPeople(d.people || []);
    }).catch((fail) => {
      if (fail.status === 401) nav('/login', { replace: true });
      else setErr('site_not_found');
    });
  }, [siteId, lang]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  async function create(e) {
    e.preventDefault();
    setErr('');
    if (!form.companyName.trim() || !form.gateName.trim()) {
      setErr('name');
      return;
    }
    if (!form.ownerEmail.trim()) {
      setErr('email');
      return;
    }
    if (String(form.password || '').length < 8) {
      setErr('password');
      return;
    }
    setBusy(true);
    try {
      await api.signup({
        companyName: form.companyName,
        gateName: form.gateName,
        ownerName: form.ownerName,
        ownerEmail: form.ownerEmail,
        password: form.password,
        lang,
        pack: form.pack,
        countryIso: form.countryIso,
        timezone: form.timezone,
      });
      nav('/home', { replace: true });
    } catch (fail) {
      const code = fail.body?.error;
      if (code === 'email_taken') setErr('email_taken');
      else if (code === 'password_short') setErr('password');
      else setErr('fail');
    } finally {
      setBusy(false);
    }
  }

  const iso = site?.countryIso || form.countryIso || 'SA';

  async function addPerson(e) {
    e.preventDefault();
    if (!person.name.trim() || !site) return;
    if (person.phone && !phoneOk(person.phone)) {
      setErr('phone');
      return;
    }
    if (person.role === 'manager' && !person.email.trim()) {
      setErr('email');
      return;
    }
    setErr('');
    try {
      const d = await api.addPerson(site.id, {
        name: person.name,
        role: person.role,
        phone: person.phone,
        email: person.email,
        managerId: person.managerId,
        employeeId: person.employeeId,
      });
      setPeople((p) => [d.person, ...p]);
      if (d.pin) {
        setShownGuardPin(d.pin);
        setToast(t.newPinOnce);
      }
      setPerson({ name: '', role: person.role, phone: '', email: '', managerId: person.role === 'employee' ? person.managerId : '', employeeId: '' });
    } catch (fail) {
      const code = fail.body?.error;
      if (code === 'phone_invalid') setErr('phone');
      else if (code === 'email_required') setErr('email');
      else if (code === 'email_domain_not_allowed') setErr('email_domain');
      else setErr('fail');
    }
  }

  const managers = useMemo(() => people.filter((p) => p.role === 'manager'), [people]);

  if (!site) {
    return (
      <main className="wrap">
        <h1>{t.createSite}</h1>
        <p className="lede">{t.setupIntro}</p>
        <form className="card setup-card" onSubmit={create}>
          <label htmlFor="cn">
            {t.companyName}
            <span className="req">*</span>
          </label>
          <input id="cn" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          <label htmlFor="sn">
            {t.gateName}
            <span className="req">*</span>
          </label>
          <input id="sn" value={form.gateName} placeholder={t.sitePh} onChange={(e) => setForm({ ...form, gateName: e.target.value })} />
          {err === 'name' && <div className="field-err">{t.required}</div>}
          <label>{t.siteType}</label>
          <div className="pack-grid">
            {PACKS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`pack-opt ${form.pack === p.id ? 'on' : ''}`}
                onClick={() => setForm({ ...form, pack: p.id })}
              >
                {lang === 'en' ? p.en : p.ar}
              </button>
            ))}
          </div>
          <CountrySelect
            id="sc"
            iso={form.countryIso}
            onChange={(countryIso) => setForm({ ...form, countryIso, timezone: timezoneForCountry(countryIso) })}
            t={t}
            lang={lang}
          />
          <label htmlFor="tz">{t.timezone}</label>
          <select id="tz" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
            {SITE_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
          <label htmlFor="on">{t.ownerName}</label>
          <input id="on" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          <label htmlFor="oe">{t.ownerEmail}</label>
          <input id="oe" type="email" autoComplete="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} />
          {err === 'email' && <div className="field-err">{t.required}</div>}
          {err === 'email_taken' && <div className="field-err">{t.emailTaken}</div>}
          <label htmlFor="pw">{t.password}</label>
          <input id="pw" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {err === 'password' && <div className="field-err">{t.passwordShort}</div>}
          {err === 'fail' && <div className="field-err">{t.signupFail}</div>}
          <div className="cta-row">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? t.sending : t.signUp}
            </button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="wrap">
      <h1>{t.setupTitle}</h1>
      <p className="lede">{t.setupSub}</p>

      <div className="grid-2">
        <article className="card">
          <h3>{site.name}</h3>
          <p className="muted">{packLabel(site.pack, lang)}</p>
          {shownGuardPin && (
            <>
              <label>{t.guardPin}</label>
              <div className="token-xl">{shownGuardPin}</div>
              <p className="muted">{t.newPinOnce}</p>
            </>
          )}
          <p className="muted">{t.session2Note}</p>
          <label htmlFor="stz">{t.timezone}</label>
          <select
            id="stz"
            value={site.timezone || timezoneForCountry(site.countryIso)}
            onChange={async (e) => {
              try {
                const d = await api.setTimezone(site.slug || site.id, e.target.value);
                setSite(d.site);
                setToast(t.saved);
              } catch {
                setToast(t.required);
              }
            }}
          >
            {SITE_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
          <p className="muted">
            <Link to="/home">{t.companyHome}</Link>
          </p>
          <label>{t.guardLink}</label>
          <input readOnly value={boothUrl} />
          <div className="cta-row">
            <button
              type="button"
              className="ghost"
              onClick={() => copy(boothUrl).then(() => setToast(t.copied))}
            >
              {t.copy}
            </button>
            <Link className="btn" to={`/booth/${site.slug || site.id}`} style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>
              {t.openBooth}
            </Link>
            <Link className="ghost" to={`/reports/${site.slug || site.id}`} style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>
              {t.openReports}
            </Link>
          </div>
        </article>
        <article className="card">
          <h3>{t.gateQr}</h3>
          <p className="muted">{gateUrl}</p>
          <div className="cta-row">
            <Link className="ghost" to={`/qr/${site.slug || site.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center', textDecoration: 'none' }}>
              <IconQr /> {t.printQr}
            </Link>
            <Link className="btn" to={`/g/${site.slug || site.id}`} style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>
              {t.publicForm}
            </Link>
          </div>
        </article>
      </div>

      <section style={{ marginTop: 20 }}>
        <h2>{t.people}</h2>
        <article className="card">
          <p className="muted">{t.csvHint}</p>
          <div className="cta-row">
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                try {
                  const blob = await api.downloadPeopleSample(site.slug || site.id);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'gate-daftar-people-sample.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  setToast(t.required);
                }
              }}
            >
              {t.downloadSample}
            </button>
            <label className="ghost" style={{ display: 'inline-grid', placeItems: 'center', cursor: 'pointer' }}>
              {csvBusy ? t.sending : t.uploadCsv}
              <input
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setCsvBusy(true);
                  setCsvResult(null);
                  try {
                    const text = await file.text();
                    const d = await api.importPeople(site.slug || site.id, text);
                    setCsvResult(d);
                    const snap = await api.snapshot(site.slug || site.id, lang);
                    setPeople(snap.people || []);
                  } catch {
                    setCsvResult({ error: true });
                  } finally {
                    setCsvBusy(false);
                  }
                }}
              />
            </label>
          </div>
          {csvResult?.error && <div className="field-err">{t.csvInvalid}</div>}
          {csvResult && !csvResult.error && (
            <p className="muted">
              {t.csvAdded}: {csvResult.added} · {t.csvUpdated}: {csvResult.updated} · {t.csvSkipped}: {csvResult.skipped?.length || 0}
            </p>
          )}
          {csvResult?.skipped?.length > 0 && (
            <ul>
              {csvResult.skipped.map((s) => (
                <li key={`${s.line}-${s.name}`} className="muted">
                  {s.line}: {s.name} · {t[`csv_${s.reason}`] || s.reason}
                </li>
              ))}
            </ul>
          )}
        </article>
        <form className="card" onSubmit={addPerson}>
          <div className="grid-2">
            <div>
              <label htmlFor="pn">
                {t.personName}
                <span className="req">*</span>
              </label>
              <input id="pn" value={person.name} placeholder={t.namePh} onChange={(e) => setPerson({ ...person, name: e.target.value })} />
            </div>
            <div>
              <label htmlFor="pr">{t.role}</label>
              <select id="pr" value={person.role} onChange={(e) => setPerson({ ...person, role: e.target.value, email: '', managerId: '' })}>
                <option value="employee">{t.employee}</option>
                <option value="manager">{t.manager}</option>
                <option value="guard">{t.guard}</option>
              </select>
            </div>
            <div>
              <PhoneField
                id="pp"
                label={t.phone}
                iso={iso}
                value={person.phone}
                onChange={(phone) => setPerson({ ...person, phone })}
                t={t}
                lang={lang}
                error={err === 'phone' ? t.phoneInvalid : ''}
              />
            </div>
            {(person.role === 'manager' || person.role === 'employee') && (
              <div>
                <label htmlFor="pe">{t.workEmail}{person.role === 'manager' ? <span className="req">*</span> : null}</label>
                <input
                  id="pe"
                  type="email"
                  autoComplete="email"
                  value={person.email}
                  placeholder={t.workEmailPh}
                  onChange={(e) => setPerson({ ...person, email: e.target.value })}
                />
                {err === 'email' && <div className="field-err">{t.emailRequired}</div>}
                {err === 'email_domain' && <div className="field-err">{t.emailDomainBad}</div>}
              </div>
            )}
            {person.role === 'employee' && managers.length > 0 && (
              <div>
                <label htmlFor="pm">{t.selectManager}</label>
                <select
                  id="pm"
                  value={person.managerId}
                  onChange={(e) => setPerson({ ...person, managerId: e.target.value })}
                >
                  <option value="">{t.selectManager}</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="pid">{t.empId}</label>
              <input id="pid" value={person.employeeId} onChange={(e) => setPerson({ ...person, employeeId: e.target.value })} />
            </div>
          </div>
          {person.role === 'manager' && <p className="muted">{t.managerEmailHint}</p>}
          {person.role === 'guard' && <p className="muted">{t.guardPinHint}</p>}
          {err === 'fail' && <div className="field-err">{t.required}</div>}
          <div className="cta-row">
            <button className="btn" type="submit">
              {t.addPerson}
            </button>
          </div>
        </form>
        {shownGuardPin && (
          <article className="card">
            <label>{t.guardPin}</label>
            <div className="token-xl">{shownGuardPin}</div>
            <p className="muted">{t.newPinOnce}</p>
          </article>
        )}
        <div className="list" style={{ paddingInline: 0 }}>
          {people.map((p) => (
            <div className="row" key={p.id}>
              <div className="row-top">
                <div>
                  <div className="who">{p.name}</div>
                  <div className="meta">
                    {p.role === 'manager' ? t.manager : p.role === 'guard' ? t.guard : t.employee}
                    {p.employeeId ? ` · ${p.employeeId}` : ''}
                    {p.email ? ` · ${p.email}` : ''}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function CompanyHome({ t }) {
  const nav = useNavigate();
  const [company, setCompany] = useState(null);
  const [sites, setSites] = useState([]);
  const [gateName, setGateName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    api
      .me()
      .then((d) => {
        if (stop) return;
        setCompany(d.company);
        setSites(d.sites || []);
      })
      .catch(() => {
        if (!stop) nav('/login', { replace: true });
      });
    return () => {
      stop = true;
    };
  }, [nav]);

  async function addGate(e) {
    e.preventDefault();
    if (!company || !gateName.trim()) return;
    setErr('');
    setBusy(true);
    try {
      const d = await api.addGate(company.id, { name: gateName.trim() });
      setSites((prev) => [...prev, d.site]);
      setGateName('');
    } catch {
      setErr(t.fail || t.required);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* still leave */
    }
    nav('/login', { replace: true });
  }

  if (!company) {
    return (
      <main className="wrap">
        <p className="lede">{t.companyHome}</p>
      </main>
    );
  }

  return (
    <main className="wrap">
      <h1>{company.name}</h1>
      <p className="lede">{t.companyHome}</p>
      <div className="cta-row">
        <button type="button" className="ghost" onClick={logout}>
          {t.logOutOwner}
        </button>
      </div>
      <ul className="card">
        {sites.map((s) => (
          <li key={s.id} style={{ marginBottom: 12 }}>
            <strong>{s.name}</strong>
            <div className="cta-row">
              <Link to={`/booth/${s.slug}`}>{t.openBooth}</Link>
              <Link to={`/setup/${s.slug}`}>{t.people}</Link>
              <Link to={`/reports/${s.slug}`}>{t.reports || t.download}</Link>
            </div>
          </li>
        ))}
      </ul>
      <form className="card" onSubmit={addGate}>
        <label htmlFor="gn">{t.gateName}</label>
        <input id="gn" value={gateName} onChange={(e) => setGateName(e.target.value)} />
        {err && <div className="field-err">{err}</div>}
        <button className="btn" type="submit" disabled={busy}>
          {t.addGate}
        </button>
      </form>
    </main>
  );
}

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, exportUrl } from '../api.js';

function fmtWhen(iso, lang) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'ar-SA', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso).slice(0, 16);
  }
}

export default function Dashboard({ t, lang }) {
  const { siteId } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    let stop = false;
    api.dashboard(siteId)
      .then((d) => {
        if (!stop) setData(d);
      })
      .catch(() => setErr('fail'));
    return () => {
      stop = true;
    };
  }, [siteId]);

  const stats = data?.stats || {};
  const site = data?.site;
  const audit = data?.audit || [];
  const slug = site?.slug || siteId;
  const qs = { kind, status };

  function download(format) {
    window.location.href = exportUrl(slug, format, qs);
  }

  return (
    <main className="wrap">
      <h1>{t.dashboard}</h1>
      <p className="lede">{site?.name || t.reports}</p>
      {err && <div className="field-err">{t.required}</div>}

      <div className="stats-grid">
        <article className="stat-card">
          <div className="stat-label">{t.todayTraffic}</div>
          <div className="stat-num">{stats.todayTotal || 0}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">{t.visitorsToday}</div>
          <div className="stat-num">{stats.todayVisitors || 0}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">{t.outToday}</div>
          <div className="stat-num">{stats.todayOutpass || 0}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">{t.insideCount}</div>
          <div className="stat-num">{stats.inside || 0}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">{t.pending}</div>
          <div className="stat-num">{stats.waiting || 0}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">{t.overdueCount}</div>
          <div className="stat-num warn">{stats.overdue || 0}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">{t.stillOutCount}</div>
          <div className="stat-num">{stats.stillOut || 0}</div>
        </article>
        <article className="stat-card">
          <div className="stat-label">{t.avgTurnaround}</div>
          <div className="stat-num">
            {stats.avgMinutes || 0}
            <small>{t.minutesShort}</small>
          </div>
        </article>
      </div>

      <article className="card" style={{ marginTop: 20 }}>
        <h2>{t.download}</h2>
        <div className="grid-2">
          <div>
            <label htmlFor="fk">{t.filterKind}</label>
            <select id="fk" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">{t.all}</option>
              <option value="visitor">{t.visitor}</option>
              <option value="outpass">{t.outpass}</option>
            </select>
          </div>
          <div>
            <label htmlFor="fs">{t.filterStatus}</label>
            <select id="fs" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t.all}</option>
              <option value="waiting_admit">{t.waitAdmit}</option>
              <option value="waiting_approval">{t.waitMgr}</option>
              <option value="approved_out">{t.goOut}</option>
              <option value="inside">{t.onSite}</option>
              <option value="out">{t.stillOut}</option>
              <option value="returned">{t.returned}</option>
              <option value="denied">{t.denied}</option>
              <option value="unapproved_leave">{t.leftUnauth}</option>
              <option value="exited">{t.exited}</option>
            </select>
          </div>
        </div>
        <div className="cta-row">
          <button type="button" className="btn" onClick={() => download('csv')}>
            {t.exportCsv}
          </button>
          <button type="button" className="ghost" onClick={() => download('xls')}>
            {t.exportExcel}
          </button>
          <Link className="ghost" to={`/setup/${slug}`} style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>
            {t.createSite}
          </Link>
        </div>
      </article>

      <section style={{ marginTop: 24 }}>
        <h2>{t.auditLog}</h2>
        {audit.length === 0 && <div className="empty">{t.emptyAudit}</div>}
        <div className="list" style={{ paddingInline: 0 }}>
          {audit.map((row) => (
            <article className="row" key={row.id}>
              <div className="row-top">
                <div>
                  <div className="who">{row.reason || row.action}</div>
                  <div className="meta">
                    {t.action}: {row.action}
                    {row.actorName ? ` · ${t.actor} ${row.actorName}` : ''}
                    {row.ip ? ` · ${row.ip}` : ''}
                  </div>
                </div>
                <span className="badge b-in">{fmtWhen(row.at, lang)}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

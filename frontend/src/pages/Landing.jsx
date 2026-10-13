import { Link } from 'react-router-dom';

export default function Landing({ t }) {
  return (
    <main className="wrap">
      <section className="hero">
        <div className="kicker">{t.notVms}</div>
        <h1>{t.hero}</h1>
        <p className="lede">{t.sub}</p>
        <div className="cta-row">
          <Link className="btn" to="/setup" style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>
            {t.createSite}
          </Link>
          <Link className="ghost" to="/booth/demo" style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>
            {t.openDemo}
          </Link>
        </div>
      </section>

      <div className="grid-2">
        <article className="card">
          <h3>{t.vsPaper}</h3>
          <p className="muted">{t.landingCta}</p>
        </article>
        <article className="card">
          <h3>{t.vsEnvoy}</h3>
          <p className="muted">{t.footer}</p>
        </article>
      </div>

      <section style={{ marginTop: 28 }}>
        <h2>{t.how}</h2>
        <div className="card steps">
          {[t.h1, t.h2, t.h3, t.h4].map((s, i) => (
            <div className="step" key={s}>
              <div className="num">{i + 1}</div>
              <div>{s}</div>
            </div>
          ))}
        </div>
      </section>
      <p className="foot">{t.footer}</p>
    </main>
  );
}

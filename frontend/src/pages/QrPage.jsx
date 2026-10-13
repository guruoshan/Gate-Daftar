import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api.js';

export default function QrPage({ t }) {
  const { siteId } = useParams();
  const [site, setSite] = useState(null);
  const [dataUrl, setDataUrl] = useState('');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const gateUrl = `${origin}/g/${siteId}`;

  useEffect(() => {
    api.site(siteId).then((d) => setSite(d.site)).catch(() => setSite({ name: siteId, slug: siteId }));
    QRCode.toDataURL(gateUrl, { width: 640, margin: 1, color: { dark: '#070B14', light: '#FFFFFF' } }).then(setDataUrl);
  }, [siteId, gateUrl]);

  return (
    <main className="wrap">
      <h1>{t.gateQr}</h1>
      <p className="lede">
        {site?.name || t.app}. {t.gateHint}
      </p>
      <article className="card" style={{ textAlign: 'center' }}>
        <div className="qr-box">
          {dataUrl && <img src={dataUrl} alt="Gate QR" />}
        </div>
        <p className="token-xl" style={{ marginTop: 12, letterSpacing: '0.04em', fontSize: '1.4rem' }}>
          {t.app}
        </p>
        <p className="muted">{gateUrl}</p>
        <div className="cta-row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn" onClick={() => window.print()}>
            {t.printQr}
          </button>
          <Link className="ghost" to={`/g/${siteId}`} style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>
            {t.publicForm}
          </Link>
        </div>
      </article>
    </main>
  );
}

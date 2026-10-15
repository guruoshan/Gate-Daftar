import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { STR, applyDir, readLang, writeLang } from './i18n.js';
import Landing from './pages/Landing.jsx';
import Setup from './pages/Setup.jsx';
import Booth from './pages/Booth.jsx';
import Gate from './pages/Gate.jsx';
import Approve from './pages/Approve.jsx';
import QrPage from './pages/QrPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Login from './pages/Login.jsx';

export default function App() {
  const [lang, setLang] = useState(readLang);
  const t = useMemo(() => STR[lang] || STR.ar, [lang]);
  const loc = useLocation();

  useEffect(() => {
    applyDir(lang);
  }, [lang]);

  function toggleLang() {
    const next = lang === 'ar' ? 'en' : 'ar';
    writeLang(next);
    setLang(next);
  }

  const hideChrome =
    loc.pathname.startsWith('/booth') ||
    loc.pathname.startsWith('/a/') ||
    loc.pathname.startsWith('/g/');

  return (
    <div className="app-shell">
      {!hideChrome && (
        <header className="topbar">
          <Link className="brand" to="/">
            <span className="mark">GD</span>
            <span>
              <span className="brand-name">{t.app}</span>
              <span className="brand-tag">{t.tag}</span>
            </span>
          </Link>
          <button type="button" className="lang-btn" onClick={toggleLang}>
            {t.lang}
          </button>
        </header>
      )}
      <Routes>
        <Route path="/" element={<Landing t={t} lang={lang} />} />
        <Route path="/setup" element={<Setup t={t} lang={lang} />} />
        <Route path="/setup/:siteId" element={<Setup t={t} lang={lang} />} />
        <Route
          path="/booth/:siteId"
          element={<Booth t={t} lang={lang} setLang={toggleLang} />}
        />
        <Route path="/g/:siteId" element={<Gate t={t} lang={lang} setLang={toggleLang} />} />
        <Route path="/qr/:siteId" element={<QrPage t={t} lang={lang} />} />
        <Route path="/reports/:siteId" element={<Dashboard t={t} lang={lang} />} />
        <Route path="/login" element={<Login t={t} />} />
        <Route path="/a/:token" element={<Approve t={t} lang={lang} setLang={toggleLang} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

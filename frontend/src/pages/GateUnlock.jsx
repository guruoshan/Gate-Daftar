import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const PIN_LEN = 6;

export default function GateUnlock({ t, setLang }) {
  const nav = useNavigate();
  const [pin, setPin] = useState('');
  const [pinErr, setPinErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function unlock(code) {
    if (busy) return;
    setPinErr('');
    setBusy(true);
    try {
      const d = await api.unlock({ pin: code });
      nav(`/booth/${d.site.slug}`, { replace: true });
    } catch {
      setPinErr(t.pinBad);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  function press(n) {
    const next = (pin + n).slice(0, PIN_LEN);
    setPin(next);
    if (next.length === PIN_LEN) unlock(next);
  }

  return (
    <main className="wrap">
      <h1>{t.pinUnlock}</h1>
      <p className="lede">{t.gateDoor}</p>
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
              disabled={!k || busy}
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
            disabled={pin.length < PIN_LEN || busy}
            onClick={() => unlock(pin)}
            style={{ flex: 1 }}
          >
            {t.submit}
          </button>
          {setLang && (
            <button type="button" className="lang-btn" onClick={setLang} style={{ flex: 1 }}>
              {t.lang}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

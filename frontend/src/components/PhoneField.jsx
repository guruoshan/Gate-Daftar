import { useEffect, useState } from 'react';
import { COUNTRIES, composePhone, countryOf, guessIso, nationalDigits } from '../countries.js';

export function CountrySelect({ id, iso = 'SA', onChange, t, lang }) {
  return (
    <div>
      <label htmlFor={id}>{t.country}</label>
      <select id={id} value={iso} onChange={(e) => onChange(e.target.value)}>
        {COUNTRIES.map((c) => (
          <option key={c.iso} value={c.iso}>
            {lang === 'en' ? c.en : c.ar} (+{c.dial})
          </option>
        ))}
      </select>
    </div>
  );
}

export default function PhoneField({
  id,
  label,
  required,
  iso = 'SA',
  value,
  onChange,
  t,
  lang,
  error,
}) {
  const [picked, setPicked] = useState(() => guessIso(value, iso));

  useEffect(() => {
    const fromValue = guessIso(value, picked || iso);
    if (value && fromValue !== picked && String(value).replace(/\D/g, '').startsWith(countryOf(fromValue).dial)) {
      setPicked(fromValue);
    }
  }, [value, iso, picked]);

  const active = picked || iso;
  const c = countryOf(active);
  const national = nationalDigits(value, active);

  function setIso(next) {
    setPicked(next);
    onChange(composePhone(national, next));
  }

  return (
    <div>
      {label && (
        <label htmlFor={id}>
          {label}
          {required ? <span className="req">*</span> : null}
        </label>
      )}
      <div className="phone-row">
        <select
          className="phone-dial-select"
          aria-label={t.country}
          value={active}
          onChange={(e) => setIso(e.target.value)}
        >
          {COUNTRIES.map((row) => (
            <option key={row.iso} value={row.iso}>
              {lang === 'en' ? row.en : row.ar} +{row.dial}
            </option>
          ))}
        </select>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={national}
          placeholder={''.padStart(c.digits, '0')}
          onChange={(e) => onChange(composePhone(e.target.value, active))}
        />
      </div>
      <p className="muted phone-hint">
        {lang === 'en'
          ? `${c.en}: ${c.digits} digits after +${c.dial}`
          : `${c.ar}: ${c.digits} خانات بعد +${c.dial}`}
      </p>
      {error && <div className="field-err">{error}</div>}
    </div>
  );
}

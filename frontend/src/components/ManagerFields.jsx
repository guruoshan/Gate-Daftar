import PhoneField from './PhoneField.jsx';

export default function ManagerFields({ t, lang, o, setO, managers, pickMgr, iso = 'SA' }) {
  return (
    <div className="manager-box">
      <p className="manager-title">{t.managerManual}</p>
      <label htmlFor="mn">
        {t.managerName}
        <span className="req">*</span>
      </label>
      <input
        id="mn"
        value={o.managerName}
        placeholder={t.managerNamePh}
        autoComplete="name"
        onChange={(e) => setO({ ...o, managerName: e.target.value })}
      />
      <PhoneField
        id="mp"
        label={t.managerPhone}
        required
        iso={iso}
        value={o.managerPhone}
        onChange={(phone) => setO({ ...o, managerPhone: phone })}
        t={t}
        lang={lang}
      />
      {managers.length > 0 && (
        <>
          <label htmlFor="om">{t.selectManager}</label>
          <select
            id="om"
            value={managers.find((m) => m.phone === o.managerPhone)?.id || ''}
            onChange={(e) => pickMgr(e.target.value)}
          >
            <option value="">{t.selectManager}</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.phone}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

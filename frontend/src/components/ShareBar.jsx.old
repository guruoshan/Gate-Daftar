import { publicize, shareOutpass } from '../api.js';
import { IconShare, IconWa } from '../icons.jsx';

export default function ShareBar({ entry, t, onToast, compact }) {
  if (!entry) return null;
  const wa = publicize(entry.waLink);
  const sms = publicize(entry.smsBody || '');
  if (!wa && !sms && !entry.pageUrl) return null;
  const phone = String(entry.managerPhone || '').replace(/\D/g, '');
  const smsHref = phone ? `sms:+${phone}?&body=${encodeURIComponent(sms)}` : '';

  async function share() {
    const r = await shareOutpass(entry);
    if (r === 'copied') onToast?.(t.copied);
  }

  return (
    <div className={compact ? 'actions' : 'share-bar'}>
      {!compact && <p className="share-hint">{t.shareHint}</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={share}>
          <IconShare /> {t.share}
        </button>
        {wa && (
          <a className="btn-ok" href={wa} target="_blank" rel="noreferrer">
            <IconWa /> {t.sendWa}
          </a>
        )}
        {smsHref && (
          <a className="ghost" href={smsHref}>
            {t.smsMgr}
          </a>
        )}
        {sms && (
          <button
            type="button"
            className="ghost"
            onClick={() => navigator.clipboard.writeText(sms).then(() => onToast?.(t.copied))}
          >
            {t.copyMsg}
          </button>
        )}
      </div>
    </div>
  );
}

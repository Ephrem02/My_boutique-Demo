import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';

const NUMBER_FIELDS = [
  ['reminder_lead_minutes', 0, 720],
  ['critical_delay_minutes', 15, 1440],
  ['attention_variance_rwf', 0, 1e9],
  ['critical_variance_rwf', 0, 1e9],
];

// Daily closing rules. Every save is validated and audited by the server.
export default function ClosingTab() {
  const { t } = useTranslation();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get('/admin/closing-settings').then(({ data }) => setForm(data)).catch((err) => setError(err.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const payload = { ...form };
      for (const [key] of NUMBER_FIELDS) payload[key] = Number(form[key]);
      setForm((await client.put('/admin/closing-settings', payload)).data);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!form) return error ? <div className="error-banner">{error}</div> : <p style={{ color: 'var(--ink-muted)' }}>{t('common.loading')}</p>;

  return (
    <form onSubmit={save} style={{ maxWidth: 560 }}>
      <p className="hint-text">{t('admin.closing.intro')}</p>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{t('admin.closing.saved')}</div>}
      <div className="field">
        <label htmlFor="expected_closing_time">{t('admin.closing.expected_closing_time')}</label>
        <input id="expected_closing_time" type="time" required value={form.expected_closing_time}
          onChange={(e) => setForm({ ...form, expected_closing_time: e.target.value })} />
      </div>
      {NUMBER_FIELDS.map(([key, min, max]) => (
        <div className="field" key={key}>
          <label htmlFor={key}>{t(`admin.closing.${key}`)}</label>
          <input id={key} type="number" min={min} max={max} step="1" required value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          <p className="hint">{t(`admin.closing.${key}_hint`)}</p>
        </div>
      ))}
      <div className="field">
        <label htmlFor="timezone">{t('admin.closing.timezone')}</label>
        <input id="timezone" required value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</button>
    </form>
  );
}

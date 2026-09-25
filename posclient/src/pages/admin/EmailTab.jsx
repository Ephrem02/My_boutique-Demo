import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';

// Non-secret email settings only. SMTP host/credentials are configured in the
// server's environment and are never sent to the browser.
export default function EmailTab() {
  const { t } = useTranslation();
  const [form, setForm] = useState(null);
  const [transport, setTransport] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get('/admin/email-settings')
      .then(({ data }) => {
        setForm(data.settings);
        setTransport(data.transport);
      })
      .catch((err) => setError(err.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        ...form,
        max_attempts: Number(form.max_attempts),
        daily_limit: Number(form.daily_limit),
        per_recipient_hourly_limit: Number(form.per_recipient_hourly_limit),
      };
      const { data } = await client.put('/admin/email-settings', payload);
      setForm(data.settings);
      setMessage(t('admin.email.saved'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { data } = await client.post('/admin/email-settings/test');
      const d = data.delivery;
      if (!d) setMessage(t('admin.email.testQueued'));
      else if (d.status === 'sent') setMessage(t('admin.email.testSent'));
      else setError(t('admin.email.testResult', { status: d.status, reason: d.skip_reason || d.last_error || '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!form) return error ? <div className="error-banner">{error}</div> : <p style={{ color: 'var(--ink-muted)' }}>{t('common.loading')}</p>;

  return (
    <form onSubmit={save} style={{ maxWidth: 560 }}>
      <div className={transport.configured ? 'success-banner' : 'warn-banner'}>
        {transport.configured
          ? t('admin.email.transportOk', { host: transport.host })
          : t('admin.email.transportMissing')}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {message && <div className="success-banner">{message}</div>}

      <div className="field">
        <label className="check-label">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          {t('admin.email.enabled')}
        </label>
        <p className="hint">{t('admin.email.enabledHint')}</p>
      </div>
      <div className="field">
        <label htmlFor="sender_name">{t('admin.email.senderName')}</label>
        <input id="sender_name" maxLength={80} value={form.sender_name} onChange={(e) => setForm({ ...form, sender_name: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="sender_address">{t('admin.email.senderAddress')}</label>
        <input id="sender_address" type="email" value={form.sender_address} onChange={(e) => setForm({ ...form, sender_address: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="max_attempts">{t('admin.email.maxAttempts')}</label>
        <input id="max_attempts" type="number" min="1" max="10" value={form.max_attempts} onChange={(e) => setForm({ ...form, max_attempts: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="daily_limit">{t('admin.email.dailyLimit')}</label>
        <input id="daily_limit" type="number" min="0" max="10000" value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="hourly">{t('admin.email.perRecipientHourly')}</label>
        <input id="hourly" type="number" min="1" max="500" value={form.per_recipient_hourly_limit} onChange={(e) => setForm({ ...form, per_recipient_hourly_limit: e.target.value })} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</button>
        <button type="button" className="btn" onClick={sendTest} disabled={busy}>{t('admin.email.sendTest')}</button>
      </div>
      <p className="hint-text" style={{ marginTop: 16 }}>{t('admin.email.secretsHint')}</p>
    </form>
  );
}

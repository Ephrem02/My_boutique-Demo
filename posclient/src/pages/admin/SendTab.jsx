import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';

const ROLES = ['cashier', 'store_keeper', 'store_manager'];

// Manual notification to whole roles. Plain text only; the sender's name is
// always appended by the server so it can't be passed off as a system alert.
export default function SendTab() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ title: '', message: '', recipient_roles: [], email: false });
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [sending, setSending] = useState(false);

  function toggleRole(role) {
    setForm((f) => ({
      ...f,
      recipient_roles: f.recipient_roles.includes(role) ? f.recipient_roles.filter((r) => r !== role) : [...f.recipient_roles, role],
    }));
  }

  async function send(e) {
    e.preventDefault();
    setSending(true);
    setError('');
    setResult('');
    try {
      const { data } = await client.post('/admin/notifications/manual', form);
      setResult(t('admin.send.sent', { count: data.recipient_count }));
      setForm({ title: '', message: '', recipient_roles: [], email: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} style={{ maxWidth: 560 }}>
      <p className="hint-text">{t('admin.send.intro')}</p>
      {error && <div className="error-banner">{error}</div>}
      {result && <div className="success-banner">{result}</div>}
      <div className="field">
        <label htmlFor="title">{t('admin.send.title')}</label>
        <input id="title" required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="message">{t('admin.send.message')} <span className="hint">({form.message.length}/1000)</span></label>
        <textarea id="message" required rows={4} maxLength={1000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
      </div>
      <div className="field">
        <label>{t('admin.send.recipients')}</label>
        <div className="check-row">
          {ROLES.map((role) => (
            <label key={role} className="check-label">
              <input type="checkbox" checked={form.recipient_roles.includes(role)} onChange={() => toggleRole(role)} />
              {t(`roles.${role}`, { defaultValue: role })}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="check-label">
          <input type="checkbox" checked={form.email} onChange={(e) => setForm({ ...form, email: e.target.checked })} />
          {t('admin.send.alsoEmail')}
        </label>
      </div>
      <button type="submit" className="btn btn-primary" disabled={sending || !form.recipient_roles.length}>
        {sending ? t('admin.send.sending') : t('admin.send.send')}
      </button>
    </form>
  );
}

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { humanizeType } from '../utils/notificationDisplay';

// A user's own opt-outs. The server only lists types this user can actually
// receive, and ignores changes to mandatory (security/fraud) types.
export default function NotificationPreferences() {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    client.get('/notifications/preferences')
      .then(({ data }) => setPrefs(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function toggle(type, field) {
    setSaved(false);
    setPrefs((list) => list.map((p) => (p.type === type ? { ...p, [field]: !p[field] } : p)));
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const { data } = await client.put('/notifications/preferences', {
        preferences: prefs.filter((p) => !p.mandatory).map(({ type, in_app_enabled, email_enabled }) => ({ type, in_app_enabled, email_enabled })),
      });
      setPrefs(data);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{t('notifications.preferencesTitle')}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn" to="/notifications">{t('notifications.backToInbox')}</Link>
          <button className="btn btn-primary" onClick={save} disabled={saving || loading}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
      <p className="hint-text">{t('notifications.preferencesHint')}</p>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{t('notifications.preferencesSaved')}</div>}

      {!loading && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('notifications.type')}</th>
              <th>{t('notifications.category')}</th>
              <th>{t('notifications.inApp')}</th>
              <th>{t('notifications.email')}</th>
            </tr>
          </thead>
          <tbody>
            {prefs.map((p) => (
              <tr key={p.type}>
                <td>
                  {t(`notificationTypes.${p.type}`, { defaultValue: humanizeType(p.type) })}
                  {p.mandatory && <span className="badge partial" style={{ marginLeft: 8 }}>{t('notifications.required')}</span>}
                </td>
                <td>{t(`notifications.categories.${p.category}`)}</td>
                <td>
                  <input type="checkbox" checked={p.in_app_enabled} disabled={p.mandatory} onChange={() => toggle(p.type, 'in_app_enabled')}
                    aria-label={`${p.type} ${t('notifications.inApp')}`} />
                </td>
                <td>
                  {p.email_available ? (
                    <input type="checkbox" checked={p.email_enabled} disabled={p.mandatory} onChange={() => toggle(p.type, 'email_enabled')}
                      aria-label={`${p.type} ${t('notifications.email')}`} />
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

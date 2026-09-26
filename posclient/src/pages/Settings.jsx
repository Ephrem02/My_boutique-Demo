import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, Languages, Monitor, Moon, Palette, Sun, UserRound } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { humanizeType } from '../utils/notificationDisplay';
import { PageHeader, Panel, StatusBadge, SkeletonPanel, ErrorState, DescriptionList } from '../ui/display';
import { RadioCards } from '../ui/Field';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import LanguageSwitcher from '../components/LanguageSwitcher';

function NotificationPreferences() {
  const { t } = useTranslation();
  const toast = useToast();
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);

  const load = () => client.get('/notifications/preferences').then(({ data }) => setPrefs(data)).catch(setError);
  useEffect(() => {
    load();
  }, []);

  function toggle(type, field) {
    setDirty(true);
    setPrefs((list) => list.map((p) => (p.type === type ? { ...p, [field]: !p[field] } : p)));
  }

  async function save() {
    try {
      const { data } = await client.put('/notifications/preferences', {
        preferences: prefs.filter((p) => !p.mandatory).map(({ type, in_app_enabled, email_enabled }) => ({ type, in_app_enabled, email_enabled })),
      });
      setPrefs(data);
      setDirty(false);
      toast.success(t('notifications.preferencesSaved'));
    } catch (err) {
      setError(err);
    }
  }

  if (error) return <ErrorState error={error} onRetry={() => { setError(null); load(); }} />;
  if (!prefs) return <SkeletonPanel lines={6} />;

  return (
    <>
      <div className="table-wrap prefs-table">
        <table className="table">
          <caption className="sr-only">{t('notifications.preferencesTitle')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('notifications.type')}</th>
              <th scope="col" className="align-center">{t('notifications.inApp')}</th>
              <th scope="col" className="align-center">{t('notifications.email')}</th>
            </tr>
          </thead>
          <tbody>
            {prefs.map((p) => {
              const name = t(`notificationTypes.${p.type}`, { defaultValue: humanizeType(p.type) });
              return (
                <tr key={p.type}>
                  <td>
                    <div className="pref-name">{name}</div>
                    <div className="pref-meta">
                      {t(`notifications.categories.${p.category}`)}
                      {p.mandatory && <StatusBadge tone="warning">{t('notifications.required')}</StatusBadge>}
                    </div>
                  </td>
                  <td className="align-center">
                    <input type="checkbox" className="toggle" checked={p.in_app_enabled} disabled={p.mandatory}
                      onChange={() => toggle(p.type, 'in_app_enabled')} aria-label={`${name}: ${t('notifications.inApp')}`} />
                  </td>
                  <td className="align-center">
                    {p.email_available ? (
                      <input type="checkbox" className="toggle" checked={p.email_enabled} disabled={p.mandatory}
                        onChange={() => toggle(p.type, 'email_enabled')} aria-label={`${name}: ${t('notifications.email')}`} />
                    ) : <span className="text-muted" aria-label={t('notifications.emailNotAvailable')}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel-footer-actions">
        <Button variant="primary" onClick={save} disabled={!dirty} loadingText={t('common.saving')}>{t('common.save')}</Button>
      </div>
    </>
  );
}

/** Personal preferences - separate from the Admin (global) settings area. */
export default function Settings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { preference, setPreference } = useTheme();
  const [params] = useSearchParams();
  const notificationsRef = useRef(null);

  useEffect(() => {
    if (params.get('section') === 'notifications') notificationsRef.current?.scrollIntoView({ block: 'start' });
  }, [params]);

  return (
    <div className="page page-narrow">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="stack">
        <Panel title={t('settings.appearance')} subtitle={t('settings.appearanceHint')} icon={Palette}>
          <RadioCards
            name="appearance"
            label={<span className="sr-only">{t('settings.appearance')}</span>}
            value={preference}
            onChange={setPreference}
            options={[
              { value: 'light', label: t('settings.appearanceOptions.light'), description: t('settings.appearanceDescriptions.light'), icon: Sun },
              { value: 'dark', label: t('settings.appearanceOptions.dark'), description: t('settings.appearanceDescriptions.dark'), icon: Moon },
              { value: 'system', label: t('settings.appearanceOptions.system'), description: t('settings.appearanceDescriptions.system'), icon: Monitor },
            ]}
          />
        </Panel>

        <Panel title={t('settings.language')} subtitle={t('settings.languageHint')} icon={Languages}>
          <LanguageSwitcher />
        </Panel>

        <div ref={notificationsRef} id="notifications">
          <Panel title={t('notifications.preferencesTitle')} subtitle={t('notifications.preferencesHint')} icon={Bell}>
            <NotificationPreferences />
          </Panel>
        </div>

        <Panel title={t('settings.account')} icon={UserRound}>
          <DescriptionList items={[
            { label: t('common.name'), value: user?.full_name },
            { label: t('settings.email'), value: user?.email || '—' },
            { label: t('settings.role'), value: t(`roles.${user?.role}`, { defaultValue: user?.role }) },
          ]} />
          <p className="field-hint account-hint">{t('settings.accountHint')}</p>
        </Panel>
      </div>
    </div>
  );
}

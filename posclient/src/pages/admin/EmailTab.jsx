import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MailCheck } from 'lucide-react';
import client from '../../api/client';
import Button from '../../ui/Button';
import { Checkbox, Field, Input } from '../../ui/Field';
import { Alert, ErrorState, Panel, SkeletonPanel } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import AdminSection from './AdminSection';

// Non-secret email settings only. SMTP host/credentials are configured in the
// server's environment and are never sent to the browser.
export default function EmailTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [transport, setTransport] = useState(null);
  const [error, setError] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    client.get('/admin/email-settings')
      .then(({ data }) => {
        setForm(data.settings);
        setTransport(data.transport);
      })
      .catch(setError);
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { data } = await client.put('/admin/email-settings', {
        ...form,
        max_attempts: Number(form.max_attempts),
        daily_limit: Number(form.daily_limit),
        per_recipient_hourly_limit: Number(form.per_recipient_hourly_limit),
      });
      setForm(data.settings);
      toast.success(t('admin.email.saved'));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTestResult(null);
    try {
      const { data } = await client.post('/admin/email-settings/test');
      const d = data.delivery;
      setTestResult(!d ? { tone: 'info', text: t('admin.email.testQueued') }
        : d.status === 'sent' ? { tone: 'success', text: t('admin.email.testSent') }
          : { tone: 'warning', text: t('admin.email.testResult', { status: t(`admin.deliveries.status.${d.status}`), reason: d.skip_reason ? t(`admin.deliveries.skip.${d.skip_reason}`, { defaultValue: d.skip_reason }) : d.last_error || '' }) });
    } catch (err) {
      setError(err);
    }
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <AdminSection title={t('admin.sections.email.title')} description={t('admin.sections.email.description')}>
      {!form && !error && <SkeletonPanel lines={6} />}
      {!form && error && <ErrorState error={error} />}
      {form && (
        <Panel className="form-panel">
          <form onSubmit={save}>
            <Alert tone={transport.configured ? 'success' : 'warning'}
              title={transport.configured ? t('admin.email.transportOk', { host: transport.host }) : t('admin.email.transportMissing')} />
            {error && <ErrorState error={error} />}
            {testResult && <Alert tone={testResult.tone} title={testResult.text} />}

            <Checkbox label={t('admin.email.enabled')} description={t('admin.email.enabledHint')} checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <div className="form-row">
              <Field label={t('admin.email.senderName')}><Input maxLength={80} value={form.sender_name} onChange={set('sender_name')} /></Field>
              <Field label={t('admin.email.senderAddress')} required={form.enabled}><Input type="email" value={form.sender_address} onChange={set('sender_address')} /></Field>
            </div>
            <div className="form-row">
              <Field label={t('admin.email.maxAttempts')}><Input type="number" inputMode="numeric" min="1" max="10" value={form.max_attempts} onChange={set('max_attempts')} /></Field>
              <Field label={t('admin.email.dailyLimit')}><Input type="number" inputMode="numeric" min="0" max="10000" value={form.daily_limit} onChange={set('daily_limit')} /></Field>
              <Field label={t('admin.email.perRecipientHourly')}><Input type="number" inputMode="numeric" min="1" max="500" value={form.per_recipient_hourly_limit} onChange={set('per_recipient_hourly_limit')} /></Field>
            </div>
            <p className="field-hint">{t('admin.email.secretsHint')}</p>
            <div className="panel-footer-actions">
              <Button icon={MailCheck} onClick={sendTest}>{t('admin.email.sendTest')}</Button>
              <Button type="submit" variant="primary" loading={saving} loadingText={t('common.saving')}>{t('common.save')}</Button>
            </div>
          </form>
        </Panel>
      )}
    </AdminSection>
  );
}

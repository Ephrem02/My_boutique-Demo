import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';
import Button from '../../ui/Button';
import { Field, Input } from '../../ui/Field';
import { ErrorState, Panel, SkeletonPanel } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { formatRwf } from '../../ui/format';
import AdminSection from './AdminSection';

const NUMBER_FIELDS = [
  ['reminder_lead_minutes', 0, 720],
  ['critical_delay_minutes', 15, 1440],
  ['attention_variance_rwf', 0, 1e9],
  ['critical_variance_rwf', 0, 1e9],
];

// Daily closing rules. Every save is validated and audited by the server.
export default function ClosingTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    client.get('/admin/closing-settings').then(({ data }) => setForm(data)).catch(setError);
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form };
      for (const [key] of NUMBER_FIELDS) payload[key] = Number(form[key]);
      setForm((await client.put('/admin/closing-settings', payload)).data);
      toast.success(t('admin.closing.saved'));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminSection title={t('admin.sections.closing.title')} description={t('admin.closing.intro')}>
      {!form && !error && <SkeletonPanel lines={6} />}
      {!form && error && <ErrorState error={error} />}
      {form && (
        <Panel className="form-panel">
          <form onSubmit={save}>
            {error && <ErrorState error={error} />}
            <div className="form-section-title">{t('admin.closing.scheduleTitle')}</div>
            <div className="form-row">
              <Field label={t('admin.closing.expected_closing_time')} required>
                <Input type="time" required value={form.expected_closing_time} onChange={(e) => setForm({ ...form, expected_closing_time: e.target.value })} />
              </Field>
              <Field label={t('admin.closing.timezone')} required>
                <Input required value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
              </Field>
            </div>
            <div className="form-row">
              {NUMBER_FIELDS.slice(0, 2).map(([key, min, max]) => (
                <Field key={key} label={t(`admin.closing.${key}`)} hint={t(`admin.closing.${key}_hint`)} required>
                  <Input type="number" inputMode="numeric" min={min} max={max} step="1" required value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
                </Field>
              ))}
            </div>
            <div className="form-section-title">{t('admin.closing.varianceTitle')}</div>
            <div className="form-row">
              {NUMBER_FIELDS.slice(2).map(([key, min, max]) => (
                <Field key={key} label={t(`admin.closing.${key}`)} hint={t(`admin.closing.${key}_hint`)} required>
                  <Input type="number" inputMode="numeric" min={min} max={max} step="1" required value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
                </Field>
              ))}
            </div>
            <p className="field-hint">
              {t('admin.closing.bandsSummary', { attention: formatRwf(form.attention_variance_rwf), critical: formatRwf(form.critical_variance_rwf) })}
            </p>
            <div className="panel-footer-actions">
              <Button type="submit" variant="primary" loading={saving} loadingText={t('common.saving')}>{t('common.save')}</Button>
            </div>
          </form>
        </Panel>
      )}
    </AdminSection>
  );
}

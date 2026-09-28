import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';
import Button from '../../ui/Button';
import { Field, Input, Textarea } from '../../ui/Field';
import { ErrorState, Panel, SkeletonPanel } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import AdminSection from './AdminSection';

// The shop's identity printed on reports and proformas. Saved changes are audited.
export default function BusinessTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    client.get('/documents/settings').then(({ data }) => setForm(data)).catch(setError);
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      setForm((await client.put('/documents/settings', form)).data);
      toast.success(t('admin.business.saved'));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const field = (key, props = {}) => (
    <Field label={t(`admin.business.${key}`)} hint={props.hint} required={props.required}>
      <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} maxLength={props.max || 200} type={props.type} required={props.required} />
    </Field>
  );

  return (
    <AdminSection title={t('admin.sections.business.title')} description={t('admin.business.intro')}>
      {!form && !error && <SkeletonPanel lines={6} />}
      {!form && error && <ErrorState error={error} />}
      {form && (
        <Panel className="form-panel">
          <form onSubmit={save}>
            {error && <ErrorState error={error} />}
            {field('name', { required: true, max: 120 })}
            <div className="form-row">
              {field('tin', { max: 40 })}
              {field('phone', { max: 60, type: 'tel' })}
            </div>
            <div className="form-row">
              {field('email', { max: 120, type: 'email' })}
              {field('address')}
            </div>
            {field('document_footer', { max: 300, hint: t('admin.business.document_footerHint') })}
            <Field label={t('admin.business.proforma_terms')} hint={t('admin.business.proforma_termsHint')}>
              <Textarea value={form.proforma_terms} onChange={(e) => setForm({ ...form, proforma_terms: e.target.value })} rows={3} maxLength={1000} />
            </Field>
            <Button type="submit" variant="primary" loading={saving} loadingText={t('common.saving')}>{t('common.save')}</Button>
          </form>
        </Panel>
      )}
    </AdminSection>
  );
}

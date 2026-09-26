import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';
import client from '../../api/client';
import Button from '../../ui/Button';
import { Checkbox, Field, Input, Textarea } from '../../ui/Field';
import { ErrorState, Panel } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import AdminSection from './AdminSection';

const ROLES = ['cashier', 'store_keeper', 'store_manager'];

// Manual message to whole roles. Plain text only; the server appends the
// sender's name so it can't be passed off as a system alert.
export default function SendTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState({ title: '', message: '', recipient_roles: [], email: false });
  const [error, setError] = useState(null);
  const [rolesError, setRolesError] = useState('');
  const [sending, setSending] = useState(false);

  const toggleRole = (role) => setForm((f) => ({
    ...f, recipient_roles: f.recipient_roles.includes(role) ? f.recipient_roles.filter((r) => r !== role) : [...f.recipient_roles, role],
  }));

  async function send(e) {
    e.preventDefault();
    if (!form.recipient_roles.length) {
      setRolesError(t('admin.send.chooseRole'));
      return;
    }
    setRolesError('');
    setSending(true);
    setError(null);
    try {
      const { data } = await client.post('/admin/notifications/manual', form);
      toast.success(t('admin.send.sent', { count: data.recipient_count }));
      setForm({ title: '', message: '', recipient_roles: [], email: false });
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <AdminSection title={t('admin.sections.send.title')} description={t('admin.send.intro')}>
      <Panel className="form-panel">
        <form onSubmit={send} noValidate={false}>
          {error && <ErrorState error={error} action={t('errors.actions.message')} />}
          <Field label={t('admin.send.title')} required hint={`${form.title.length} / 120`}>
            <Input required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label={t('admin.send.message')} required hint={`${form.message.length} / 1000`}>
            <Textarea required rows={4} maxLength={1000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </Field>
          <fieldset className="fieldset">
            <legend className="field-label">{t('admin.send.recipients')} <span className="field-required" aria-hidden="true">*</span></legend>
            {ROLES.map((role) => <Checkbox key={role} label={t(`roles.${role}`, { defaultValue: role })} checked={form.recipient_roles.includes(role)} onChange={() => toggleRole(role)} />)}
            {rolesError && <p className="field-error" role="alert">{rolesError}</p>}
          </fieldset>
          <Checkbox label={t('admin.send.alsoEmail')} description={t('admin.send.alsoEmailHint')} checked={form.email} onChange={(e) => setForm({ ...form, email: e.target.checked })} />
          <div className="panel-footer-actions">
            <Button type="submit" variant="primary" icon={Send} loading={sending} loadingText={t('common.sending')}>{t('admin.send.send')}</Button>
          </div>
        </form>
      </Panel>
    </AdminSection>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import client from '../../api/client';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import { Checkbox, Field, Input, Textarea } from '../../ui/Field';
import { Alert, ErrorState, StatusBadge } from '../../ui/display';
import DataTable from '../../ui/DataTable';
import { useToast } from '../../ui/Toast';
import { humanizeType } from '../../utils/notificationDisplay';
import AdminSection from './AdminSection';

const FIELDS = ['title', 'body', 'email_subject', 'email_body'];
const MULTILINE = new Set(['body', 'email_body']);

function TemplateEditor({ template, onClose, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(Object.fromEntries(FIELDS.map((f) => [f, template[f]])));
  const [isActive, setIsActive] = useState(template.is_active ?? true);
  const [preview, setPreview] = useState(null);
  const [validation, setValidation] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Live server-side validation + preview with sample values, so the admin
  // sees exactly the rules that saving will enforce.
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        setPreview((await client.post(`/admin/notification-templates/${template.type}/preview`, form)).data);
        setValidation(null);
      } catch (err) {
        setPreview(null);
        setValidation(err.message);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [form, template.type]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await client.put(`/admin/notification-templates/${template.type}`, { ...form, is_active: isActive });
      onSaved();
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <Dialog title={t(`notificationTypes.${template.type}`, { defaultValue: humanizeType(template.type) })} description={t('admin.templates.rulesHint')}
      size="lg" onClose={onClose} onSubmit={save}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={saving} loadingText={t('common.saving')} disabled={!!validation}>{t('common.save')}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      <div className="var-list">
        <span>{t('admin.templates.variables')}:</span>
        {template.vars.map((v) => <code key={v}>{`{{${v}}}`}</code>)}
      </div>
      {FIELDS.map((field) => {
        const Control = MULTILINE.has(field) ? Textarea : Input;
        return (
          <Field key={field} label={t(`admin.templates.fields.${field}`)} required hint={`${form[field].length} / ${template.limits[field]}`}>
            <Control value={form[field]} maxLength={template.limits[field]} rows={field === 'email_body' ? 5 : 3}
              onChange={(e) => setForm({ ...form, [field]: MULTILINE.has(field) ? e.target.value : e.target.value.replace(/[\r\n]/g, '') })} />
            <div className="var-insert" role="group" aria-label={t('admin.templates.insertVariable')}>
              {template.vars.map((v) => (
                <button type="button" key={v} className="chip" onClick={() => setForm((f) => ({ ...f, [field]: `${f[field]}{{${v}}}` }))}>+ {v}</button>
              ))}
            </div>
          </Field>
        );
      })}
      <Checkbox label={t('admin.templates.active')} description={t('admin.templates.activeHint')} checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
      {validation && <Alert tone="danger" title={t('admin.templates.invalid')}>{validation}</Alert>}
      {preview && (
        <div className="template-preview" aria-live="polite">
          <div className="form-section-title">{t('admin.templates.preview')}</div>
          <strong>{preview.title}</strong>
          <p>{preview.body}</p>
          <hr />
          <div><span className="text-secondary">{t('admin.templates.fields.email_subject')}:</span> {preview.emailSubject}</div>
          <p>{preview.emailBody}</p>
        </div>
      )}
    </Dialog>
  );
}

export default function TemplatesTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const [templates, setTemplates] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setTemplates((await client.get('/admin/notification-templates')).data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function reset(template) {
    try {
      await client.post(`/admin/notification-templates/${template.type}/reset`);
      toast.success(t('admin.templates.resetDone'));
      load();
    } catch (err) {
      setError(err);
    }
  }

  const name = (type) => t(`notificationTypes.${type}`, { defaultValue: humanizeType(type) });
  const columns = [
    { key: 'type', header: t('notifications.type'), sortable: true, mobile: 'title', sortValue: (x) => name(x.type), render: (x) => <span className="cell-strong">{name(x.type)}</span> },
    { key: 'title', header: t('admin.templates.fields.title'), mobile: 'subtitle', render: (x) => <span className="text-secondary">{x.title}</span> },
    {
      key: 'status', header: t('admin.templates.status'), mobile: 'meta',
      render: (x) => (!x.customized
        ? <StatusBadge tone="neutral" dot={false}>{t('admin.templates.default')}</StatusBadge>
        : <StatusBadge tone={x.is_active ? 'info' : 'warning'}>{x.is_active ? t('admin.templates.customV', { version: x.version }) : t('admin.templates.inactive')}</StatusBadge>),
    },
    {
      key: 'actions', header: <span className="sr-only">{t('common.actions')}</span>, mobile: 'meta',
      render: (x) => (
        <span className="row-actions">
          <Button size="sm" onClick={() => setEditing(x)} aria-label={t('admin.templates.editNamed', { name: name(x.type) })}>{t('common.edit')}</Button>
          {x.customized && <Button size="sm" variant="ghost" onClick={() => reset(x)}>{t('admin.reset')}</Button>}
        </span>
      ),
    },
  ];

  return (
    <AdminSection title={t('admin.sections.templates.title')} description={t('admin.templates.intro')}>
      <DataTable caption={t('admin.sections.templates.title')} columns={columns} rows={templates} rowKey="type" loading={!templates} error={error} onRetry={load}
        searchable pageSize={50} empty={{ icon: FileText, title: t('common.nothingHere') }} />
      {editing && <TemplateEditor template={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.success(t('admin.templates.saved')); load(); }} />}
    </AdminSection>
  );
}

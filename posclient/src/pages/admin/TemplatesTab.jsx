import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';
import { humanizeType } from '../../utils/notificationDisplay';

const FIELDS = ['title', 'body', 'email_subject', 'email_body'];
const MULTILINE = new Set(['body', 'email_body']);

function TemplateEditor({ template, onClose, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(Object.fromEntries(FIELDS.map((f) => [f, template[f]])));
  const [isActive, setIsActive] = useState(template.is_active ?? true);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Live server-side validation + preview (with placeholder sample values),
  // so the admin sees exactly the rules that saving will enforce.
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        setPreview((await client.post(`/admin/notification-templates/${template.type}/preview`, form)).data);
        setError('');
      } catch (err) {
        setPreview(null);
        setError(err.message);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [form, template.type]);

  function insertVar(field, v) {
    setForm((f) => ({ ...f, [field]: `${f[field]}{{${v}}}` }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await client.put(`/admin/notification-templates/${template.type}`, { ...form, is_active: isActive });
      onSaved(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal-card wide" onSubmit={save}>
        <h2>{t(`notificationTypes.${template.type}`, { defaultValue: humanizeType(template.type) })}</h2>
        <p className="hint">{t('admin.templates.rulesHint')}</p>
        <div className="var-list">
          <span>{t('admin.templates.variables')}:</span>
          {template.vars.map((v) => <code key={v}>{`{{${v}}}`}</code>)}
        </div>
        {error && <div className="error-banner">{error}</div>}

        {FIELDS.map((field) => (
          <div className="field" key={field}>
            <label htmlFor={field}>
              {t(`admin.templates.fields.${field}`)} <span className="hint">({form[field].length}/{template.limits[field]})</span>
            </label>
            {MULTILINE.has(field) ? (
              <textarea id={field} rows={field === 'email_body' ? 5 : 3} value={form[field]} maxLength={template.limits[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })} />
            ) : (
              <input id={field} value={form[field]} maxLength={template.limits[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value.replace(/[\r\n]/g, '') })} />
            )}
            <div className="var-insert">
              {template.vars.map((v) => (
                <button type="button" key={v} className="link-btn" onClick={() => insertVar(field, v)}>+{v}</button>
              ))}
            </div>
          </div>
        ))}

        <div className="field">
          <label className="check-label">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t('admin.templates.active')}
          </label>
          <p className="hint">{t('admin.templates.activeHint')}</p>
        </div>

        {preview && (
          <div className="template-preview">
            <div className="section-title" style={{ marginTop: 0 }}>{t('admin.templates.preview')}</div>
            <strong>{preview.title}</strong>
            <p>{preview.body}</p>
            <hr />
            <div><strong>{t('admin.templates.fields.email_subject')}:</strong> {preview.emailSubject}</div>
            <p>{preview.emailBody}</p>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary btn-block" disabled={saving || !!error}>{saving ? t('common.saving') : t('common.save')}</button>
        </div>
      </form>
    </div>
  );
}

export default function TemplatesTab() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setTemplates((await client.get('/admin/notification-templates')).data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function reset(template) {
    try {
      await client.post(`/admin/notification-templates/${template.type}/reset`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <p className="hint-text">{t('admin.templates.intro')}</p>
      {error && <div className="error-banner">{error}</div>}
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('notifications.type')}</th>
            <th>{t('admin.templates.fields.title')}</th>
            <th>{t('admin.templates.status')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {templates.map((tpl) => (
            <tr key={tpl.type}>
              <td>{t(`notificationTypes.${tpl.type}`, { defaultValue: humanizeType(tpl.type) })}</td>
              <td style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{tpl.title}</td>
              <td>
                {!tpl.customized && t('admin.templates.default')}
                {tpl.customized && (
                  <span className={`badge ${tpl.is_active ? 'paid' : 'partial'}`}>
                    {tpl.is_active ? t('admin.templates.customV', { version: tpl.version }) : t('admin.templates.inactive')}
                  </span>
                )}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn btn-sm" onClick={() => setEditing(tpl)}>{t('common.edit')}</button>
                {tpl.customized && <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => reset(tpl)}>{t('admin.reset')}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <TemplateEditor template={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

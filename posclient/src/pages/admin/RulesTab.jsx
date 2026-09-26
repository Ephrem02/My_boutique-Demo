import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing } from 'lucide-react';
import client from '../../api/client';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import { Checkbox, Field, Input, Select } from '../../ui/Field';
import { Alert, ErrorState, StatusBadge, SEVERITY_TONE } from '../../ui/display';
import DataTable from '../../ui/DataTable';
import { useToast } from '../../ui/Toast';
import { humanizeType } from '../../utils/notificationDisplay';
import { formatRwf, formatNumber } from '../../ui/format';
import AdminSection from './AdminSection';

const thresholdLabel = (key, t) => t(`admin.thresholds.${key}`, { defaultValue: humanizeType(key) });
const thresholdValue = (key, v) => (key.endsWith('_rwf') ? formatRwf(v) : formatNumber(v));

function RuleEditor({ rule, typeInfo, roles, onClose, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    enabled: rule.enabled, recipient_roles: rule.recipient_roles, in_app: rule.in_app, email: rule.email,
    severity: rule.severity, cooldown_minutes: rule.cooldown_minutes, thresholds: { ...rule.thresholds },
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // Roles the server accepts: those holding the type's permission, plus roles
  // that only receive it about their own records (targets).
  const allowedRoles = roles.filter((r) => typeInfo.eligible_roles.includes(r) || typeInfo.target_roles.includes(r));
  const toggleRole = (role) => setForm((f) => ({
    ...f, recipient_roles: f.recipient_roles.includes(role) ? f.recipient_roles.filter((r) => r !== role) : [...f.recipient_roles, role],
  }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { data } = await client.put(`/admin/notification-rules/${rule.type}`, {
        ...form,
        cooldown_minutes: Number(form.cooldown_minutes),
        thresholds: Object.fromEntries(Object.entries(form.thresholds).map(([k, v]) => [k, Number(v)])),
      });
      onSaved(data);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <Dialog title={t(`notificationTypes.${rule.type}`, { defaultValue: humanizeType(rule.type) })} onClose={onClose} onSubmit={save}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={saving} loadingText={t('common.saving')}>{t('common.save')}</Button>
        </>
      )}
    >
      {rule.mandatory && <Alert tone="warning" title={t('admin.rules.mandatoryHint')} />}
      {error && <ErrorState error={error} />}
      <Checkbox label={t('admin.rules.enabled')} checked={form.enabled} disabled={rule.mandatory} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />

      <fieldset className="fieldset">
        <legend className="field-label">{t('admin.rules.recipients')}</legend>
        {allowedRoles.map((role) => (
          <Checkbox key={role} label={t(`roles.${role}`, { defaultValue: role })} checked={form.recipient_roles.includes(role)} onChange={() => toggleRole(role)} />
        ))}
        {typeInfo.permission && <p className="field-hint">{t('admin.rules.permissionHint', { permission: typeInfo.permission })}</p>}
      </fieldset>

      <fieldset className="fieldset">
        <legend className="field-label">{t('admin.rules.channels')}</legend>
        <Checkbox label={t('notifications.inApp')} checked={form.in_app} onChange={(e) => setForm({ ...form, in_app: e.target.checked })} />
        <Checkbox label={t('notifications.email')} checked={form.email} disabled={!typeInfo.email_allowed} onChange={(e) => setForm({ ...form, email: e.target.checked })}
          description={!typeInfo.email_allowed ? t('admin.rules.emailNotAllowed') : undefined} />
      </fieldset>

      <div className="form-row">
        <Field label={t('notifications.severity')}>
          <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            {['info', 'warning', 'critical'].map((s) => <option key={s} value={s}>{t(`notifications.severities.${s}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('admin.rules.cooldown')} hint={t('admin.rules.cooldownHint')}>
          <Input type="number" inputMode="numeric" min="0" max="10080" step="1" value={form.cooldown_minutes} onChange={(e) => setForm({ ...form, cooldown_minutes: e.target.value })} />
        </Field>
      </div>
      {Object.keys(form.thresholds).length > 0 && (
        <div className="form-row">
          {Object.keys(form.thresholds).map((key) => (
            <Field key={key} label={`${thresholdLabel(key, t)}${key.endsWith('_rwf') ? ' (RWF)' : ''}`} required>
              <Input type="number" inputMode="numeric" min="0" step="1" required value={form.thresholds[key]}
                onChange={(e) => setForm({ ...form, thresholds: { ...form.thresholds, [key]: e.target.value } })} />
            </Field>
          ))}
        </div>
      )}
    </Dialog>
  );
}

export default function RulesTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const [rules, setRules] = useState(null);
  const [types, setTypes] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, ty] = await Promise.all([client.get('/admin/notification-rules'), client.get('/admin/notification-types')]);
      setRules(r.data);
      setTypes(ty.data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function reset(rule) {
    try {
      await client.post(`/admin/notification-rules/${rule.type}/reset`);
      toast.success(t('admin.rules.resetDone'));
      load();
    } catch (err) {
      setError(err);
    }
  }

  const name = (type) => t(`notificationTypes.${type}`, { defaultValue: humanizeType(type) });
  const columns = [
    {
      key: 'type', header: t('notifications.type'), sortable: true, mobile: 'title', sortValue: (r) => name(r.type),
      render: (r) => (
        <span className="cell-stack">
          <span className="cell-strong">{name(r.type)}</span>
          <span className="badge-group">
            {r.mandatory && <StatusBadge tone="warning">{t('notifications.required')}</StatusBadge>}
            {r.customized && <StatusBadge tone="info">{t('admin.customized')}</StatusBadge>}
          </span>
        </span>
      ),
    },
    { key: 'category', header: t('notifications.category'), sortable: true, mobile: 'subtitle', render: (r) => t(`notifications.categories.${r.category}`) },
    { key: 'enabled', header: t('admin.rules.status'), mobile: 'meta', render: (r) => <StatusBadge tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? t('admin.rules.on') : t('admin.rules.off')}</StatusBadge> },
    { key: 'recipient_roles', header: t('admin.rules.recipients'), render: (r) => r.recipient_roles.map((x) => t(`roles.${x}`, { defaultValue: x })).join(', ') || t('admin.rules.onlyPersonConcerned') },
    { key: 'channels', header: t('admin.rules.channels'), render: (r) => [r.in_app && t('notifications.inApp'), r.email && t('notifications.email')].filter(Boolean).join(' + ') || '—' },
    { key: 'severity', header: t('notifications.severity'), mobile: 'meta', render: (r) => <StatusBadge tone={SEVERITY_TONE[r.severity]}>{t(`notifications.severities.${r.severity}`)}</StatusBadge> },
    {
      key: 'thresholds', header: t('admin.rules.thresholds'),
      render: (r) => (
        <span className="cell-stack cell-small">
          {Object.entries(r.thresholds).map(([k, v]) => <span key={k}>{thresholdLabel(k, t)}: <span className="num">{thresholdValue(k, v)}</span></span>)}
          {r.cooldown_minutes > 0 && <span>{t('admin.rules.cooldownShort', { minutes: r.cooldown_minutes })}</span>}
          {!Object.keys(r.thresholds).length && !r.cooldown_minutes && '—'}
        </span>
      ),
    },
    {
      key: 'actions', header: <span className="sr-only">{t('common.actions')}</span>, mobile: 'meta',
      render: (r) => (
        <span className="row-actions">
          <Button size="sm" onClick={() => setEditing(r)} disabled={!types} aria-label={t('admin.rules.editNamed', { name: name(r.type) })}>{t('common.edit')}</Button>
          {r.customized && <Button size="sm" variant="ghost" onClick={() => reset(r)}>{t('admin.reset')}</Button>}
        </span>
      ),
    },
  ];

  return (
    <AdminSection title={t('admin.sections.rules.title')} description={t('admin.rules.intro')}>
      <DataTable caption={t('admin.sections.rules.title')} columns={columns} rows={rules} rowKey="type" loading={!rules} error={error} onRetry={load}
        searchable searchPlaceholder={t('admin.rules.search')} pageSize={50} empty={{ icon: BellRing, title: t('common.nothingHere') }} />
      {editing && types && (
        <RuleEditor rule={editing} typeInfo={types.types.find((x) => x.type === editing.type)} roles={types.roles}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.success(t('admin.rules.saved')); load(); }} />
      )}
    </AdminSection>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';
import { SEVERITY_BADGE, humanizeType } from '../../utils/notificationDisplay';

function thresholdLabel(key, t) {
  return t(`admin.thresholds.${key}`, { defaultValue: humanizeType(key) });
}

function RuleEditor({ rule, typeInfo, roles, onClose, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    enabled: rule.enabled,
    recipient_roles: rule.recipient_roles,
    in_app: rule.in_app,
    email: rule.email,
    severity: rule.severity,
    cooldown_minutes: rule.cooldown_minutes,
    thresholds: { ...rule.thresholds },
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Roles the server will accept: those holding the type's permission, plus
  // roles that only ever receive it about their own records (targets).
  const allowedRoles = roles.filter((r) => typeInfo.eligible_roles.includes(r) || typeInfo.target_roles.includes(r));

  function toggleRole(role) {
    setForm((f) => ({
      ...f,
      recipient_roles: f.recipient_roles.includes(role) ? f.recipient_roles.filter((r) => r !== role) : [...f.recipient_roles, role],
    }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        cooldown_minutes: Number(form.cooldown_minutes),
        thresholds: Object.fromEntries(Object.entries(form.thresholds).map(([k, v]) => [k, Number(v)])),
      };
      const { data } = await client.put(`/admin/notification-rules/${rule.type}`, payload);
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
        <h2>{t(`notificationTypes.${rule.type}`, { defaultValue: humanizeType(rule.type) })}</h2>
        {rule.mandatory && <p className="hint">{t('admin.rules.mandatoryHint')}</p>}
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label className="check-label">
            <input type="checkbox" checked={form.enabled} disabled={rule.mandatory} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            {t('admin.rules.enabled')}
          </label>
        </div>

        <div className="field">
          <label>{t('admin.rules.recipients')}</label>
          <div className="check-row">
            {allowedRoles.map((role) => (
              <label key={role} className="check-label">
                <input type="checkbox" checked={form.recipient_roles.includes(role)} onChange={() => toggleRole(role)} />
                {t(`roles.${role}`, { defaultValue: role.replace('_', ' ') })}
              </label>
            ))}
          </div>
          {typeInfo.permission && <p className="hint">{t('admin.rules.permissionHint', { permission: typeInfo.permission })}</p>}
        </div>

        <div className="field">
          <label>{t('admin.rules.channels')}</label>
          <div className="check-row">
            <label className="check-label">
              <input type="checkbox" checked={form.in_app} onChange={(e) => setForm({ ...form, in_app: e.target.checked })} />
              {t('notifications.inApp')}
            </label>
            <label className="check-label">
              <input type="checkbox" checked={form.email} disabled={!typeInfo.email_allowed} onChange={(e) => setForm({ ...form, email: e.target.checked })} />
              {t('notifications.email')}
            </label>
          </div>
        </div>

        <div className="field">
          <label htmlFor="severity">{t('notifications.severity')}</label>
          <select id="severity" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            {['info', 'warning', 'critical'].map((s) => <option key={s} value={s}>{t(`notifications.severities.${s}`)}</option>)}
          </select>
        </div>

        {Object.keys(form.thresholds).map((key) => (
          <div className="field" key={key}>
            <label htmlFor={key}>{thresholdLabel(key, t)}{key.endsWith('_rwf') ? ' (RWF)' : ''}</label>
            <input id={key} type="number" min="0" step="1" required value={form.thresholds[key]}
              onChange={(e) => setForm({ ...form, thresholds: { ...form.thresholds, [key]: e.target.value } })} />
          </div>
        ))}

        <div className="field">
          <label htmlFor="cooldown">{t('admin.rules.cooldown')}</label>
          <input id="cooldown" type="number" min="0" max="10080" step="1" value={form.cooldown_minutes}
            onChange={(e) => setForm({ ...form, cooldown_minutes: e.target.value })} />
          <p className="hint">{t('admin.rules.cooldownHint')}</p>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary btn-block" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
        </div>
      </form>
    </div>
  );
}

export default function RulesTab() {
  const { t } = useTranslation();
  const [rules, setRules] = useState([]);
  const [types, setTypes] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [r, ty] = await Promise.all([client.get('/admin/notification-rules'), client.get('/admin/notification-types')]);
      setRules(r.data);
      setTypes(ty.data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function reset(rule) {
    try {
      await client.post(`/admin/notification-rules/${rule.type}/reset`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const typeInfo = (type) => types?.types.find((x) => x.type === type);

  return (
    <>
      <p className="hint-text">{t('admin.rules.intro')}</p>
      {error && <div className="error-banner">{error}</div>}
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('notifications.type')}</th>
            <th>{t('admin.rules.status')}</th>
            <th>{t('admin.rules.recipients')}</th>
            <th>{t('admin.rules.channels')}</th>
            <th>{t('notifications.severity')}</th>
            <th>{t('admin.rules.thresholds')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.type}>
              <td>
                {t(`notificationTypes.${rule.type}`, { defaultValue: humanizeType(rule.type) })}
                {rule.mandatory && <span className="badge partial" style={{ marginLeft: 6 }}>{t('notifications.required')}</span>}
                {rule.customized && <span className="badge paid" style={{ marginLeft: 6 }}>{t('admin.customized')}</span>}
              </td>
              <td>{rule.enabled ? t('admin.rules.on') : t('admin.rules.off')}</td>
              <td>{rule.recipient_roles.map((r) => t(`roles.${r}`, { defaultValue: r })).join(', ') || '—'}</td>
              <td>{[rule.in_app && t('notifications.inApp'), rule.email && t('notifications.email')].filter(Boolean).join(' + ') || '—'}</td>
              <td><span className={`badge ${SEVERITY_BADGE[rule.severity]}`}>{t(`notifications.severities.${rule.severity}`)}</span></td>
              <td style={{ fontSize: 13 }}>
                {Object.entries(rule.thresholds).map(([k, v]) => (
                  <div key={k}>{thresholdLabel(k, t)}: <span className="num">{k.endsWith('_rwf') ? `${Number(v).toLocaleString()} RWF` : v}</span></div>
                ))}
                {rule.cooldown_minutes > 0 && <div>{t('admin.rules.cooldownShort', { minutes: rule.cooldown_minutes })}</div>}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn btn-sm" onClick={() => setEditing(rule)} disabled={!types}>{t('common.edit')}</button>
                {rule.customized && <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => reset(rule)}>{t('admin.reset')}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && types && (
        <RuleEditor
          rule={editing}
          typeInfo={typeInfo(editing.type)}
          roles={types.roles}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

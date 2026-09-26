import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, UserPlus, Users } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import Dialog from '../ui/Dialog';
import Button, { IconButton } from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { ErrorState, StatusBadge } from '../ui/display';
import DataTable from '../ui/DataTable';
import { useToast } from '../ui/Toast';
import { formatWhen } from '../ui/format';
import { initials } from '../components/UserMenu';
import AdminSection from './admin/AdminSection';

const ROLES = ['cashier', 'store_keeper', 'store_manager'];
const MIN_PASSWORD = 8; // matches the server rule

function PasswordInput({ value, onChange, required }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-with-button">
      <Input type={visible ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={onChange} required={required} minLength={MIN_PASSWORD} />
      <IconButton icon={visible ? EyeOff : Eye} label={visible ? t('employees.hidePassword') : t('employees.showPassword')} onClick={() => setVisible((v) => !v)} />
    </div>
  );
}

/** Create (no employee) or edit an employee. */
function EmployeeDialog({ employee, onClose, onSaved }) {
  const { t } = useTranslation();
  const isEdit = Boolean(employee);
  const [form, setForm] = useState({
    full_name: employee?.full_name || '', email: '', phone: '', password: '',
    role_name: employee?.role || 'cashier', status: employee?.status || 'active',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit() {
    const next = {};
    if (!isEdit && !form.email && !form.phone) next.email = t('employees.emailOrPhoneRequired');
    if ((!isEdit || form.password) && form.password.length < MIN_PASSWORD) next.password = t('employees.passwordTooShort', { count: MIN_PASSWORD });
    setErrors(next);
    if (Object.keys(next).length) return;
    setError(null);
    setLoading(true);
    try {
      let data;
      if (isEdit) {
        const payload = { full_name: form.full_name, role_name: form.role_name, status: form.status };
        if (form.password) payload.password = form.password;
        ({ data } = await client.patch(`/auth/employees/${employee.id}`, payload));
      } else {
        ({ data } = await client.post('/auth/employees', { full_name: form.full_name, email: form.email, phone: form.phone, password: form.password, role_name: form.role_name }));
      }
      onSaved(data);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Dialog title={isEdit ? t('employees.editEmployeeTitle') : t('employees.newEmployeeTitle')}
      description={isEdit ? undefined : t('employees.newEmployeeHint')} onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.saving')}>
            {isEdit ? t('products.saveChanges') : t('employees.createEmployee')}
          </Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      <Field label={t('employees.fullName')} required><Input value={form.full_name} onChange={set('full_name')} required autoFocus /></Field>
      {!isEdit && (
        <div className="form-row">
          <Field label={t('login.email')} error={errors.email}><Input type="email" autoComplete="off" value={form.email} onChange={set('email')} /></Field>
          <Field label={t('employees.phone')}><Input type="tel" value={form.phone} onChange={set('phone')} /></Field>
        </div>
      )}
      <div className="form-row">
        <Field label={t('employees.role')}>
          <Select value={form.role_name} onChange={set('role_name')}>
            {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
          </Select>
        </Field>
        {isEdit && (
          <Field label={t('common.status')}>
            <Select value={form.status} onChange={set('status')}>
              <option value="active">{t('badges.active')}</option>
              <option value="disabled">{t('badges.disabled')}</option>
            </Select>
          </Field>
        )}
      </div>
      <Field label={isEdit ? t('employees.resetPasswordOptional') : t('employees.temporaryPassword')} required={!isEdit}
        error={errors.password} hint={isEdit ? t('employees.resetPasswordHint') : t('employees.temporaryPasswordHint', { count: MIN_PASSWORD })}>
        <PasswordInput value={form.password} onChange={set('password')} required={!isEdit} />
      </Field>
    </Dialog>
  );
}

export default function Employees() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();
  const [employees, setEmployees] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // 'create' | employee

  const load = useCallback(async () => {
    try {
      setEmployees((await client.get('/auth/employees')).data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    {
      key: 'full_name', header: t('common.name'), sortable: true, mobile: 'title',
      render: (e) => (
        <span className="person-cell">
          <span className="avatar" aria-hidden="true">{initials(e.full_name)}</span>
          <span>{e.full_name}{e.id === user.id && <span className="text-muted"> ({t('employees.you')})</span>}</span>
        </span>
      ),
    },
    { key: 'contact', header: t('common.contact'), mobile: 'subtitle', render: (e) => e.email || e.phone || '—', searchValue: (e) => `${e.email || ''} ${e.phone || ''}` },
    { key: 'role', header: t('employees.role'), sortable: true, mobile: 'meta', render: (e) => <StatusBadge tone="primary" dot={false}>{t(`roles.${e.role}`, { defaultValue: e.role })}</StatusBadge> },
    { key: 'status', header: t('common.status'), sortable: true, mobile: 'meta', render: (e) => <StatusBadge tone={e.status === 'active' ? 'success' : 'neutral'}>{t(`badges.${e.status}`)}</StatusBadge> },
    { key: 'last_login_at', header: t('employees.lastLogin'), sortable: true, render: (e) => (e.last_login_at ? formatWhen(e.last_login_at, t) : <span className="text-muted">{t('employees.never')}</span>) },
    {
      key: 'actions', header: <span className="sr-only">{t('common.actions')}</span>, mobile: 'meta',
      render: (e) => (
        <Button size="sm" onClick={() => setDialog(e)} disabled={e.id === user.id} title={e.id === user.id ? t('employees.ownAccountHint') : undefined}
          aria-label={t('employees.editNamed', { name: e.full_name })}>
          {t('common.edit')}
        </Button>
      ),
    },
  ];

  return (
    <AdminSection title={t('admin.sections.users.title')} description={t('admin.sections.users.description')}
      actions={<Button variant="primary" icon={UserPlus} onClick={() => setDialog('create')}>{t('employees.newEmployee')}</Button>}>
      <DataTable caption={t('employees.title')} columns={columns} rows={employees} loading={!employees} error={error} onRetry={load}
        searchable searchPlaceholder={t('employees.search')} initialSort={{ key: 'full_name', dir: 'asc' }}
        empty={{ icon: Users, title: t('employees.noEmployees') }} />
      {dialog && (
        <EmployeeDialog employee={dialog === 'create' ? null : dialog} onClose={() => setDialog(null)}
          onSaved={(e) => { setDialog(null); toast.success(t(dialog === 'create' ? 'employees.created' : 'employees.saved', { name: e.full_name })); load(); }} />
      )}
    </AdminSection>
  );
}

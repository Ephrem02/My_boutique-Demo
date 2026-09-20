import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';

const ROLES = ['cashier', 'store_keeper', 'store_manager'];

export default function EditEmployeeModal({ employee, onClose, onSaved }) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState(employee.full_name);
  const [roleName, setRoleName] = useState(employee.role);
  const [status, setStatus] = useState(employee.status);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = { full_name: fullName, role_name: roleName, status };
      if (password) payload.password = password;
      const { data } = await client.patch(`/auth/employees/${employee.id}`, payload);
      onSaved(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal-card" onSubmit={handleSubmit}>
        <h2>{t('employees.editEmployeeTitle')}</h2>
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label htmlFor="full_name">{t('employees.fullName')}</label>
          <input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="role">{t('employees.role')}</label>
          <select id="role" value={roleName} onChange={(e) => setRoleName(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">{t('common.status')}</label>
          <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">{t('badges.active')}</option>
            <option value="disabled">{t('badges.disabled')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="password">{t('employees.resetPasswordOptional')}</label>
          <input
            id="password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('employees.resetPasswordPlaceholder')}
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? t('common.saving') : t('products.saveChanges')}
          </button>
        </div>
      </form>
    </div>
  );
}

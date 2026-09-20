import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';

const ROLES = ['cashier', 'store_keeper', 'store_manager'];

export default function CreateEmployeeModal({ onClose, onCreated }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', role_name: 'cashier' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.email && !form.phone) {
      setError(t('employees.emailOrPhoneRequired'));
      return;
    }
    setLoading(true);
    try {
      const { data } = await client.post('/auth/employees', form);
      onCreated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal-card" onSubmit={handleSubmit}>
        <h2>{t('employees.newEmployeeTitle')}</h2>
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label htmlFor="full_name">{t('employees.fullName')}</label>
          <input id="full_name" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="email">{t('login.email')}</label>
          <input id="email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="phone">{t('employees.phone')}</label>
          <input id="phone" value={form.phone} onChange={(e) => update('phone', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">{t('employees.temporaryPassword')}</label>
          <input
            id="password"
            type="text"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
            required
            minLength={6}
          />
        </div>
        <div className="field">
          <label htmlFor="role">{t('employees.role')}</label>
          <select id="role" value={form.role_name} onChange={(e) => update('role_name', e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? t('employees.creating') : t('employees.createEmployee')}
          </button>
        </div>
      </form>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import CreateEmployeeModal from '../components/CreateEmployeeModal';
import EditEmployeeModal from '../components/EditEmployeeModal';

export default function Employees() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.get('/auth/employees');
      setEmployees(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{t('employees.title')}</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          {t('employees.newEmployee')}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!loading && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('common.contact')}</th>
              <th>{t('employees.role')}</th>
              <th>{t('common.status')}</th>
              <th>{t('employees.lastLogin')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>{e.full_name}</td>
                <td>{e.email || e.phone || '—'}</td>
                <td>{t(`roles.${e.role}`, { defaultValue: e.role.replace('_', ' ') })}</td>
                <td>
                  <span className={`badge ${e.status === 'active' ? 'paid' : 'unpaid'}`}>{t(`badges.${e.status}`)}</span>
                </td>
                <td>{e.last_login_at ? new Date(e.last_login_at).toLocaleString() : t('employees.never')}</td>
                <td>
                  <button
                    className="btn"
                    style={{ padding: '5px 10px', fontSize: 13 }}
                    onClick={() => setEditingEmployee(e)}
                    disabled={e.id === user.id}
                    title={e.id === user.id ? t('employees.ownAccountHint') : undefined}
                  >
                    {t('common.edit')}
                  </button>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--ink-muted)' }}>
                  {t('employees.noEmployees')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {showCreate && (
        <CreateEmployeeModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}

      {editingEmployee && (
        <EditEmployeeModal
          employee={editingEmployee}
          onClose={() => setEditingEmployee(null)}
          onSaved={() => {
            setEditingEmployee(null);
            load();
          }}
        />
      )}
    </div>
  );
}

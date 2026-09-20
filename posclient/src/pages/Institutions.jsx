import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import CreateInstitutionModal from '../components/CreateInstitutionModal';
import InstitutionDetail from '../components/InstitutionDetail';

const CLIENT_TYPES = ['shop', 'school', 'individual', 'company', 'other'];

export default function Institutions() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [institutions, setInstitutions] = useState([]);
  const [unpaid, setUnpaid] = useState([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const requests = [client.get('/institutions', { params: typeFilter ? { type: typeFilter } : {} })];
      if (hasPermission('institution_payments.view')) {
        requests.push(client.get('/institution-orders/unpaid-summary'));
      }
      const [{ data: institutionData }, unpaidRes] = await Promise.all(requests);
      setInstitutions(institutionData);
      if (unpaidRes) setUnpaid(unpaidRes.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{t('institutions.title')}</h1>
        {hasPermission('institutions.manage') && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            {t('institutions.newInstitution')}
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div style={{ marginBottom: 16 }}>
        <select
          style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-strong)' }}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">{t('institutions.allTypes')}</option>
          {CLIENT_TYPES.map((ct) => (
            <option key={ct} value={ct}>
              {t(`institutions.types.${ct}`)}
            </option>
          ))}
        </select>
      </div>

      {unpaid.length > 0 && (
        <div className="unpaid-summary">
          {unpaid.map((u) => (
            <div className="unpaid-card" key={u.institution_id}>
              <div className="unpaid-card-name">{u.institution_name}</div>
              <div className="unpaid-card-amount num">
                {t('suppliers.owed', { amount: Number(u.balance_due).toLocaleString() })}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('institutions.type')}</th>
              <th>{t('common.contact')}</th>
              <th>{t('common.paymentTerms')}</th>
            </tr>
          </thead>
          <tbody>
            {institutions.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => setSelectedId(i.id)}>
                <td>{i.name}</td>
                <td>{t(`institutions.types.${i.type}`, { defaultValue: i.type })}</td>
                <td>{i.contact_person || i.contact_phone || '—'}</td>
                <td>{i.payment_terms || '—'}</td>
              </tr>
            ))}
            {institutions.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--ink-muted)' }}>
                  {t('institutions.noInstitutions')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {showCreate && (
        <CreateInstitutionModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}

      {selectedId && (
        <InstitutionDetail institutionId={selectedId} onClose={() => { setSelectedId(null); load(); }} />
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import CreateSupplierModal from '../components/CreateSupplierModal';
import SupplierDetail from '../components/SupplierDetail';

export default function Suppliers() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [unpaid, setUnpaid] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const requests = [client.get('/suppliers')];
      if (hasPermission('supplier_payments.view')) {
        requests.push(client.get('/supplier-deliveries/unpaid-summary'));
      }
      const [{ data: supplierData }, unpaidRes] = await Promise.all(requests);
      setSuppliers(supplierData);
      if (unpaidRes) setUnpaid(unpaidRes.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{t('suppliers.title')}</h1>
        {hasPermission('suppliers.manage') && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            {t('suppliers.newSupplier')}
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {unpaid.length > 0 && (
        <div className="unpaid-summary">
          {unpaid.map((u) => (
            <div className="unpaid-card" key={u.supplier_id}>
              <div className="unpaid-card-name">{u.supplier_name}</div>
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
              <th>{t('common.contact')}</th>
              <th>{t('common.paymentTerms')}</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => setSelectedId(s.id)}>
                <td>{s.name}</td>
                <td>{s.contact_phone || s.contact_email || '—'}</td>
                <td>{s.payment_terms || '—'}</td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: 'var(--ink-muted)' }}>
                  {t('suppliers.noSuppliers')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {showCreate && (
        <CreateSupplierModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}

      {selectedId && <SupplierDetail supplierId={selectedId} onClose={() => { setSelectedId(null); load(); }} />}
    </div>
  );
}

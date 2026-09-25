import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import StockIntakeModal from '../components/StockIntakeModal';
import StockTransferModal from '../components/StockTransferModal';
import ReportDamageModal from '../components/ReportDamageModal';

export default function Stock() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canSeeMovements = hasPermission('stock.movements.view');
  const [levels, setLevels] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showIntake, setShowIntake] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showDamage, setShowDamage] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Movement history names who did what - hidden from cashiers (least privilege)
      const [{ data: levelData }, movementRes] = await Promise.all([
        client.get('/stock/levels'),
        canSeeMovements ? client.get('/stock/movements') : Promise.resolve(null),
      ]);
      setLevels(levelData);
      setMovements(movementRes ? movementRes.data.slice(0, 50) : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [canSeeMovements]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{t('stock.title')}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {hasPermission('stock.adjust') && (
            <button className="btn btn-danger" onClick={() => setShowDamage(true)}>
              {t('stock.reportDamage')}
            </button>
          )}
          {hasPermission('stock.transfer') && (
            <button className="btn" onClick={() => setShowTransfer(true)}>
              {t('stock.transferStock')}
            </button>
          )}
          {hasPermission('stock.intake') && (
            <button className="btn btn-primary" onClick={() => setShowIntake(true)}>
              {t('stock.stockIntake')}
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="section-title" style={{ marginTop: 0 }}>{t('stock.currentLevels')}</div>
      {!loading && (
        <table className="data-table" style={{ marginBottom: 28 }}>
          <thead>
            <tr>
              <th>{t('products.sku')}</th>
              <th>{t('common.product')}</th>
              <th>{t('common.location')}</th>
              <th>{t('common.quantity')}</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((l, i) => (
              <tr key={i}>
                <td>{l.sku}</td>
                <td>{l.name}</td>
                <td>{t(`locations.${l.location}`, { defaultValue: l.location.replace('_', ' ') })}</td>
                <td className="num">{l.quantity}</td>
              </tr>
            ))}
            {levels.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--ink-muted)' }}>
                  {t('stock.noStockRecorded')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {canSeeMovements && <div className="section-title">{t('stock.recentMovements')}</div>}
      {!loading && canSeeMovements && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('common.date')}</th>
              <th>{t('common.product')}</th>
              <th>{t('common.type')}</th>
              <th>{t('common.location')}</th>
              <th>{t('common.quantity')}</th>
              <th>{t('stock.by')}</th>
              <th>{t('common.notes')}</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <td>{new Date(m.created_at).toLocaleString()}</td>
                <td>{m.product_name}</td>
                <td>{t(`movementTypes.${m.type}`, { defaultValue: m.type })}</td>
                <td>{t(`locations.${m.location}`, { defaultValue: m.location.replace('_', ' ') })}</td>
                <td className="num">{m.quantity}</td>
                <td>{m.performed_by_name}</td>
                <td style={{ color: 'var(--ink-muted)' }}>{m.notes || '—'}</td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--ink-muted)' }}>
                  {t('stock.noMovements')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {showIntake && <StockIntakeModal onClose={() => setShowIntake(false)} onRecorded={() => { setShowIntake(false); load(); }} />}
      {showTransfer && (
        <StockTransferModal onClose={() => setShowTransfer(false)} onRecorded={() => { setShowTransfer(false); load(); }} />
      )}
      {showDamage && (
        <ReportDamageModal onClose={() => setShowDamage(false)} onRecorded={() => { setShowDamage(false); load(); }} />
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Undo2 } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import Dialog from '../ui/Dialog';
import Button from '../ui/Button';
import { ErrorState, SkeletonPanel, StatusBadge } from '../ui/display';
import { useToast } from '../ui/Toast';
import { formatRwf, formatDateTime, formatNumber } from '../ui/format';
import ReturnModal from './ReturnModal';
import ConfirmDialog from '../ui/ConfirmDialog';

export default function SaleDetail({ saleId, onClose, onChanged }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [sale, setSale] = useState(null);
  const [error, setError] = useState(null);
  const [returningItem, setReturningItem] = useState(null);
  const [confirmVoid, setConfirmVoid] = useState(false);

  const load = useCallback(async () => {
    try {
      setSale((await client.get(`/sales/${saleId}`)).data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [saleId]);

  useEffect(() => {
    load();
  }, [load]);

  const completed = sale?.status === 'completed';
  return (
    <Dialog
      title={t('saleDetail.title', { id: saleId })}
      description={sale ? formatDateTime(sale.created_at) : undefined}
      onClose={onClose}
      footer={completed && hasPermission('sales.void') ? (
        <Button variant="danger" icon={Ban} onClick={() => setConfirmVoid(true)}>{t('saleDetail.voidSale')}</Button>
      ) : null}
    >
      {error && <ErrorState error={error} onRetry={load} />}
      {!sale && !error && <SkeletonPanel lines={5} />}
      {sale && (
        <>
          <div className="sale-meta">
            <StatusBadge tone={sale.status === 'voided' ? 'danger' : 'success'}>{t(`badges.${sale.status}`)}</StatusBadge>
            <span className="text-secondary">{sale.cashier_name} · {t(`paymentMethods.${sale.payment_method}`, { defaultValue: sale.payment_method.replace('_', ' ') })}</span>
          </div>

          <ul className="line-items-list" aria-label={t('saleDetail.items')}>
            {sale.items.map((item) => {
              const returned = item.returned_quantity || 0;
              const canReturn = completed && hasPermission('returns.process') && returned < item.quantity;
              return (
                <li key={item.id} className="line-item">
                  <div className="line-item-main">
                    <span className="line-item-name">{item.product_name}</span>
                    <span className="line-item-sub text-muted">
                      {item.sku} · <span className="num">{formatNumber(item.quantity)} × {formatRwf(item.unit_price)}</span>
                      {returned > 0 && <> · <StatusBadge tone="info">{t('saleDetail.returnedCount', { count: returned })}</StatusBadge></>}
                    </span>
                  </div>
                  <span className="line-item-total num">{formatRwf(item.quantity * Number(item.unit_price))}</span>
                  {canReturn && (
                    <Button size="sm" icon={Undo2} onClick={() => setReturningItem(item)} aria-label={t('saleDetail.returnNamed', { name: item.product_name })}>
                      {t('saleDetail.processReturn')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="total-row">
            <span>{t('common.total')}</span>
            <span className="num">{formatRwf(sale.total_amount)}</span>
          </div>
        </>
      )}

      {returningItem && (
        <ReturnModal saleItem={returningItem} onClose={() => setReturningItem(null)}
          onRecorded={(amount) => {
            setReturningItem(null);
            toast.success(t('saleDetail.refunded', { amount: formatRwf(amount) }));
            load();
            onChanged();
          }} />
      )}
      {confirmVoid && (
        <ConfirmDialog title={t('saleDetail.voidTitle', { id: saleId })} description={t('saleDetail.voidHint')}
          danger confirmLabel={t('saleDetail.voidSale')} onClose={() => setConfirmVoid(false)}
          onConfirm={async () => {
            await client.post(`/sales/${saleId}/void`);
            setConfirmVoid(false);
            toast.success(t('saleDetail.voided', { id: saleId }));
            load();
            onChanged();
          }} />
      )}
    </Dialog>
  );
}

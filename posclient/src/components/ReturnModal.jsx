import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import Dialog from '../ui/Dialog';
import Button from '../ui/Button';
import { Checkbox, Field, Input, Select } from '../ui/Field';
import { CUSTOMER_RETURN_REASONS } from './finance/constants';
import { useAuth } from '../context/AuthContext';

// Till refunds go back through a till method - not necessarily the sale's own
const REFUND_METHODS = ['cash', 'mtn_mobile_money', 'airtel_money', 'card'];
import { ErrorState } from '../ui/display';
import { formatRwf } from '../ui/format';

export default function ReturnModal({ saleItem, saleMethod, onClose, onRecorded }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [refundMethod, setRefundMethod] = useState(REFUND_METHODS.includes(saleMethod) ? saleMethod : 'cash');
  const remaining = saleItem.quantity - (saleItem.returned_quantity || 0);
  const [quantity, setQuantity] = useState(remaining);
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState('changed_mind');
  const [restocked, setRestocked] = useState(true);
  const [error, setError] = useState(null);
  const [fieldError, setFieldError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > remaining) {
      setFieldError(t('returnModal.quantityRange', { max: remaining }));
      return;
    }
    setFieldError('');
    setError(null);
    setLoading(true);
    try {
      await client.post('/returns', { sale_item_id: saleItem.id, quantity: qty, reason: reason || undefined, reason_code: reasonCode, refund_method: refundMethod, restocked });
      onRecorded(qty * Number(saleItem.unit_price));
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Dialog
      title={t('returnModal.title')}
      description={t('returnModal.summary', { product: saleItem.product_name, quantity: saleItem.quantity, price: formatRwf(saleItem.unit_price) })}
      size="sm"
      onClose={onClose}
      onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.processing')}>
            {t('returnModal.confirm', { amount: formatRwf((Number(quantity) || 0) * Number(saleItem.unit_price)) })}
          </Button>
        </>
      )}
    >
      {error && <ErrorState error={error} action={t('errors.actions.refund')} />}
      <Field label={t('returnModal.quantityReturned')} required error={fieldError || undefined} hint={t('returnModal.remaining', { count: remaining })}>
        <Input type="number" inputMode="numeric" min="1" max={remaining} value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
      </Field>
      <Field label={t('finance.returnReason')} required>
        <Select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
          {CUSTOMER_RETURN_REASONS.map((code) => <option key={code} value={code}>{t(`finance.reasons.${code}`)}</option>)}
        </Select>
      </Field>
      <Field label={t('returnModal.refundMethod')} hint={hasPermission('customer_returns.approve') ? undefined : t('returnModal.largeRefundHint')}>
        <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
          {REFUND_METHODS.map((m) => <option key={m} value={m}>{t(`paymentMethods.${m}`)}</option>)}
        </Select>
      </Field>
      <Field label={t('salesHistory.reason')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('returnModal.reasonPlaceholder')} maxLength={500} />
      </Field>
      <Checkbox label={t('returnModal.restockLabel')} description={t('returnModal.restockHint')} checked={restocked} onChange={(e) => setRestocked(e.target.checked)} />
    </Dialog>
  );
}

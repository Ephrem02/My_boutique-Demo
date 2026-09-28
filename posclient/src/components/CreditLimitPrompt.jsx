import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Send, RefreshCw } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import Button from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Alert, DescriptionList, ErrorState } from '../ui/display';
import { useToast } from '../ui/Toast';
import { formatRwf } from '../ui/format';

export const isCreditError = (err) => ['CREDIT_LIMIT_EXCEEDED', 'CREDIT_NOT_ALLOWED'].includes(err?.details?.code);

/**
 * Shown when a sale on account would go over the client's credit limit.
 * A manager (credit.manage) approves it on the spot with a reason; anyone
 * else asks a manager, then uses the approval once it comes back (valid
 * today only). onRetry(extra) resubmits the sale with the approval attached.
 */
export default function CreditLimitPrompt({ error, institutionId, onRetry, busy }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const d = error.details;
  const canApprove = hasPermission('credit.manage');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState(null);

  const load = useCallback(async () => {
    if (canApprove || !institutionId) return;
    try {
      const { data } = await client.get(`/finance/customer/parties/${institutionId}/credit`);
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, [canApprove, institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  const approval = status?.approved_today.find((e) => e.amount >= d.excess);
  const pending = status?.pending_requests.find((e) => e.amount >= d.excess);

  async function ask() {
    setAsking(true);
    setAskError(null);
    try {
      await client.post('/credit-exceptions', { institution_id: Number(institutionId), amount: d.excess, reason });
      toast.success(t('credit.requestSent'));
      setReason('');
      load();
    } catch (err) {
      setAskError(err);
    } finally {
      setAsking(false);
    }
  }

  return (
    <Alert tone="warning" title={d.code === 'CREDIT_NOT_ALLOWED' ? t('credit.notAllowedTitle') : t('credit.overLimitTitle')}>
      <DescriptionList items={[
        d.code !== 'CREDIT_NOT_ALLOWED' && { label: t('credit.limit'), value: formatRwf(d.limit) },
        { label: t('credit.owesNow'), value: formatRwf(d.exposure) },
        { label: t('credit.thisSaleOnCredit'), value: formatRwf(d.requested) },
        { label: t('credit.overBy'), value: formatRwf(d.excess), strong: true, tone: 'danger' },
      ]} />
      {canApprove ? (
        <div className="credit-prompt-actions">
          <Field label={t('credit.overrideReason')} hint={t('credit.overrideHint')} required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </Field>
          <Button variant="primary" icon={ShieldCheck} loading={busy} disabled={reason.trim().length < 5}
            onClick={() => onRetry({ credit_override: { reason: reason.trim() } })}>{t('credit.approveAndSell')}</Button>
        </div>
      ) : approval ? (
        <div className="credit-prompt-actions">
          <p className="field-hint">{t('credit.approvalReady', { name: approval.decided_by_name, amount: formatRwf(approval.amount) })}</p>
          <Button variant="primary" icon={ShieldCheck} loading={busy} onClick={() => onRetry({ credit_exception_id: approval.id })}>{t('credit.useApproval')}</Button>
        </div>
      ) : pending ? (
        <div className="credit-prompt-actions">
          <p className="field-hint">{t('credit.waiting')}</p>
          <Button icon={RefreshCw} onClick={load}>{t('credit.checkAgain')}</Button>
        </div>
      ) : (
        <div className="credit-prompt-actions">
          {askError && <ErrorState error={askError} />}
          <Field label={t('credit.requestReason')} hint={t('credit.requestHint')} required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </Field>
          <Button icon={Send} loading={asking} disabled={reason.trim().length < 5} onClick={ask}>{t('credit.askManager')}</Button>
        </div>
      )}
    </Alert>
  );
}

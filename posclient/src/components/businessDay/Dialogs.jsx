import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import client from '../../api/client';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import { Field, Input, Select, Textarea } from '../../ui/Field';
import { Alert, DescriptionList, ErrorState, SkeletonPanel } from '../../ui/display';
import { formatRwf } from '../../ui/format';

export const METHODS = ['cash', 'mtn_mobile_money', 'airtel_money', 'card'];

/** Client-side mirror of the server's variance bands (display only - the server decides). */
export function bandFor(variance, thresholds) {
  const abs = Math.abs(Number(variance) || 0);
  if (abs > thresholds.critical_variance_rwf) return 'critical';
  if (abs > thresholds.attention_variance_rwf) return 'attention';
  return 'normal';
}
const BAND_TONE = { normal: 'success', attention: 'warning', critical: 'danger' };

export function OpenDayDialog({ previousCounted, onClose, onDone }) {
  const { t } = useTranslation();
  const [float, setFloat] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await client.post('/business-days/open', { opening_float: Number(float) });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('businessDay.open.title')}
      description={t('businessDay.open.hint')}
      size="sm"
      onClose={onClose}
      onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={busy} loadingText={t('common.saving')}>{t('businessDay.open.confirm')}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} action={t('errors.actions.openDay')} />}
      <Field label={t('businessDay.open.float')} required
        hint={previousCounted !== null && previousCounted !== undefined ? t('businessDay.open.previousCounted', { amount: formatRwf(previousCounted) }) : undefined}>
        <Input type="number" inputMode="numeric" min="0" step="1" required autoFocus value={float} onChange={(e) => setFloat(e.target.value)} />
      </Field>
    </Dialog>
  );
}

/**
 * Closing wizard: review system figures -> count cash -> explain & confirm.
 * The server recalculates everything on submit; this is a preview.
 */
export function ClosingWizard({ onClose, onDone }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState(null);
  const [step, setStep] = useState(1);
  const [counted, setCounted] = useState('');
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    client.get('/business-days/current/closing/preview').then(({ data }) => setPreview(data)).catch(setError);
  }, []);

  const expected = preview?.figures.cash.expected_cash ?? 0;
  const variance = counted === '' ? null : Math.round((Number(counted) - expected) * 100) / 100;
  const band = variance === null || !preview ? null : bandFor(variance, preview.thresholds);
  const needsExplanation = band && band !== 'normal';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await client.post('/business-days/current/closing/submit', { counted_cash: Number(counted), explanation });
      setResult(data);
      setStep(4);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function cancelClosing() {
    setBusy(true);
    try {
      await client.post('/business-days/current/closing/cancel');
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const title = preview?.recount ? t('businessDay.close.recountTitle') : t('businessDay.close.title');
  if (!preview) {
    return (
      <Dialog title={title} onClose={onClose} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
        {error ? <ErrorState error={error} /> : <SkeletonPanel lines={5} />}
      </Dialog>
    );
  }

  const f = preview.figures;
  const steps = [t('businessDay.close.step1'), t('businessDay.close.step2'), t('businessDay.close.step3')];
  let body;
  let footer;
  if (step === 1) {
    body = (
      <>
        <p className="dialog-lead">{t('businessDay.close.reviewHint')}</p>
        <DescriptionList items={[
          { label: t('businessDay.fig.totalSales'), value: formatRwf(f.sales.gross), strong: true },
          { label: t('businessDay.fig.transactions'), value: f.sales.transactions },
          ...METHODS.map((m) => ({ label: t(`paymentMethods.${m}`), value: formatRwf(f.payment_methods[m]) })),
          { label: t('businessDay.fig.refunds'), value: formatRwf(-f.sales.refunds) },
          { label: t('businessDay.fig.voids'), value: f.sales.void_count },
        ]} />
      </>
    );
    footer = (
      <>
        {!preview.recount && <Button variant="ghost" onClick={cancelClosing} disabled={busy}>{t('businessDay.close.cancelClosing')}</Button>}
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button variant="primary" onClick={() => setStep(2)}>{t('common.next')}</Button>
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <DescriptionList items={[
          { label: t('businessDay.fig.openingFloat'), value: formatRwf(f.cash.opening_float) },
          { label: `+ ${t('businessDay.fig.cashSales')}`, value: formatRwf(f.cash.cash_sales) },
          { label: `− ${t('businessDay.fig.cashRefunds')}`, value: formatRwf(f.cash.cash_refunds) },
          { label: `= ${t('businessDay.fig.expectedCash')}`, value: formatRwf(expected), strong: true },
        ]} />
        <Field label={t('businessDay.close.counted')} required className="wizard-count">
          <Input type="number" inputMode="numeric" min="0" step="1" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} />
        </Field>
        {variance !== null && (
          <Alert tone={BAND_TONE[band]} title={`${t('businessDay.fig.variance')}: ${formatRwf(variance, { signed: true })}`}>
            {t(`businessDay.bands.${band}`)}
          </Alert>
        )}
      </>
    );
    footer = (
      <>
        <Button onClick={() => setStep(1)}>{t('common.previous')}</Button>
        <Button variant="primary" disabled={counted === '' || Number(counted) < 0} onClick={() => setStep(3)}>{t('common.next')}</Button>
      </>
    );
  } else if (step === 3) {
    body = (
      <>
        <Field label={t('businessDay.close.explanation')} required={!!needsExplanation}
          hint={needsExplanation ? t('businessDay.close.required') : t('businessDay.close.optional')}>
          <Textarea maxLength={1000} value={explanation} onChange={(e) => setExplanation(e.target.value)} autoFocus />
        </Field>
        <Alert tone="info" title={t('businessDay.close.confirmTitle')}>
          {t('businessDay.close.confirmHint', { counted: formatRwf(counted), variance: formatRwf(variance, { signed: true }) })}
        </Alert>
      </>
    );
    footer = (
      <>
        <Button onClick={() => setStep(2)}>{t('common.previous')}</Button>
        <Button variant="primary" loading={busy} loadingText={t('common.submitting')} disabled={needsExplanation && !explanation.trim()} onClick={submit}>
          {t('businessDay.close.submit')}
        </Button>
      </>
    );
  } else {
    body = (
      <div className="wizard-done">
        <CheckCircle2 className="wizard-done-icon" aria-hidden="true" />
        <p className="wizard-done-title">{result.day.status === 'closed' ? t('businessDay.close.doneClosed') : t('businessDay.close.doneReview')}</p>
        <p className="text-secondary">{t('businessDay.fig.variance')}: <strong className="num">{formatRwf(result.closing.variance, { signed: true })}</strong></p>
      </div>
    );
    footer = <Button variant="primary" onClick={onDone}>{t('common.done')}</Button>;
  }

  return (
    <Dialog title={title} onClose={step === 4 ? onDone : onClose} footer={footer} dismissible={!busy}>
      {step < 4 && (
        <ol className="wizard-steps" aria-label={t('businessDay.close.progress')}>
          {steps.map((label, i) => (
            <li key={label} className={`wizard-step${step > i ? ' done' : ''}`} aria-current={step === i + 1 ? 'step' : undefined}>
              <span className="wizard-step-number num">{i + 1}</span>
              <span className="wizard-step-label">{label}</span>
            </li>
          ))}
        </ol>
      )}
      {preview.recount && step < 4 && <Alert tone="warning" title={t('businessDay.recountPending', { reason: preview.recount_reason || '' })} />}
      {error && <ErrorState error={error} action={t('errors.actions.closing')} />}
      {body}
    </Dialog>
  );
}

/** Generic "reason / note" dialog for accept, recount, reopen and rejections. */
export function ReasonDialog({ title, description, label, minLength = 0, required = true, confirmLabel, danger, onSubmit, onClose }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim());
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const tooShort = required && text.trim().length < minLength;
  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={busy} disabled={tooShort}>{confirmLabel}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      <Field label={label} required={required} hint={minLength ? t('common.minChars', { count: minLength }) : undefined}>
        <Textarea maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}

const CORRECTION_FIELDS = ['counted_cash', 'opening_float', 'cash_sales', 'cash_refunds', 'mtn_mobile_money', 'airtel_money', 'card'];

export function CorrectionDialog({ board, onClose, onDone }) {
  const { t } = useTranslation();
  const [field, setField] = useState('counted_cash');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const current = board.corrected?.values?.[field]?.corrected;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await client.post('/corrections', {
        business_day_id: board.day.id, field, requested_value: Number(value), reason, explanation: explanation || undefined,
      });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('businessDay.correction.title')}
      description={t('businessDay.correction.hint')}
      onClose={onClose}
      onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={busy} loadingText={t('common.sending')}>{t('businessDay.correction.submit')}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} action={t('errors.actions.correction')} />}
      <Field label={t('businessDay.correction.field')} required hint={current !== undefined ? t('businessDay.correction.current', { value: formatRwf(current) }) : undefined}>
        <Select value={field} onChange={(e) => setField(e.target.value)}>
          {CORRECTION_FIELDS.map((f) => <option key={f} value={f}>{t(`businessDay.fields.${f}`)}</option>)}
        </Select>
      </Field>
      <Field label={t('businessDay.correction.value')} required>
        <Input type="number" inputMode="numeric" min="0" step="1" required value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Field label={t('businessDay.correction.reason')} required hint={t('common.minChars', { count: 5 })}>
        <Input required minLength={5} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={t('businessDay.correction.explanation')}>
        <Textarea maxLength={2000} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </Field>
    </Dialog>
  );
}

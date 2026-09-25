import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';
import { METHODS, rwf, signedRwf, bandFor } from './format';

export function OpenDayDialog({ previousCounted, onClose, onDone }) {
  const { t } = useTranslation();
  const [float, setFloat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await client.post('/business-days/open', { opening_float: Number(float) });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal-card" onSubmit={submit}>
        <h2>{t('businessDay.open.title')}</h2>
        <p className="hint">{t('businessDay.open.hint')}</p>
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label htmlFor="float">{t('businessDay.open.float')}</label>
          <input id="float" type="number" min="0" step="1" required autoFocus value={float} onChange={(e) => setFloat(e.target.value)} />
          {previousCounted !== null && previousCounted !== undefined && (
            <p className="hint">{t('businessDay.open.previousCounted', { amount: rwf(previousCounted) })}</p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? t('common.saving') : t('businessDay.open.confirm')}</button>
        </div>
      </form>
    </div>
  );
}

/**
 * Closing wizard: review system figures -> count cash -> explain any
 * variance -> confirm. The server recalculates everything on submit; the
 * numbers shown here are a preview.
 */
export function ClosingWizard({ onClose, onDone }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState(null);
  const [step, setStep] = useState(1);
  const [counted, setCounted] = useState('');
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    client.get('/business-days/current/closing/preview').then(({ data }) => setPreview(data)).catch((err) => setError(err.message));
  }, []);

  const expected = preview?.figures.cash.expected_cash ?? 0;
  const variance = counted === '' ? null : Math.round((Number(counted) - expected) * 100) / 100;
  const band = variance === null || !preview ? null : bandFor(variance, preview.thresholds);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const { data } = await client.post('/business-days/current/closing/submit', { counted_cash: Number(counted), explanation });
      setResult(data);
      setStep(4);
    } catch (err) {
      setError(err.message);
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
      setError(err.message);
      setBusy(false);
    }
  }

  if (!preview) {
    return (
      <div className="modal-overlay">
        <div className="modal-card wide">
          {error ? <div className="error-banner">{error}</div> : <p>{t('common.loading')}</p>}
          <div className="modal-actions"><button className="btn" onClick={onClose}>{t('common.close')}</button></div>
        </div>
      </div>
    );
  }

  const f = preview.figures;
  return (
    <div className="modal-overlay">
      <div className="modal-card wide">
        <h2>{preview.recount ? t('businessDay.close.recountTitle') : t('businessDay.close.title')}</h2>
        <div className="wizard-steps">
          {[1, 2, 3].map((s) => <span key={s} className={`wizard-step${step >= s ? ' done' : ''}`}>{t(`businessDay.close.step${s}`)}</span>)}
        </div>
        {preview.recount && <div className="warn-banner">{t('businessDay.recountPending', { reason: preview.recount_reason || '' })}</div>}
        {error && <div className="error-banner">{error}</div>}

        {step === 1 && (
          <>
            <p className="hint">{t('businessDay.close.reviewHint')}</p>
            <table className="data-table compact">
              <tbody>
                <tr><td>{t('businessDay.fig.totalSales')}</td><td className="num">{rwf(f.sales.gross)}</td></tr>
                <tr><td>{t('businessDay.fig.transactions')}</td><td className="num">{f.sales.transactions}</td></tr>
                {METHODS.map((m) => <tr key={m}><td>{t(`paymentMethods.${m}`)}</td><td className="num">{rwf(f.payment_methods[m])}</td></tr>)}
                <tr><td>{t('businessDay.fig.refunds')}</td><td className="num">−{rwf(f.sales.refunds)}</td></tr>
                <tr><td>{t('businessDay.fig.voids')}</td><td className="num">{f.sales.void_count}</td></tr>
              </tbody>
            </table>
            <div className="modal-actions">
              {!preview.recount && <button type="button" className="btn" onClick={cancelClosing} disabled={busy}>{t('businessDay.close.cancelClosing')}</button>}
              <button type="button" className="btn" onClick={onClose}>{t('common.close')}</button>
              <button type="button" className="btn btn-primary btn-block" onClick={() => setStep(2)}>{t('common.next')}</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <table className="data-table compact">
              <tbody>
                <tr><td>{t('businessDay.fig.openingFloat')}</td><td className="num">{rwf(f.cash.opening_float)}</td></tr>
                <tr><td>+ {t('businessDay.fig.cashSales')}</td><td className="num">{rwf(f.cash.cash_sales)}</td></tr>
                <tr><td>− {t('businessDay.fig.cashRefunds')}</td><td className="num">{rwf(f.cash.cash_refunds)}</td></tr>
                <tr className="strong"><td>= {t('businessDay.fig.expectedCash')}</td><td className="num">{rwf(expected)}</td></tr>
              </tbody>
            </table>
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="counted">{t('businessDay.close.counted')}</label>
              <input id="counted" type="number" min="0" step="1" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} />
            </div>
            {variance !== null && (
              <div className={band === 'normal' ? 'success-banner' : band === 'attention' ? 'warn-banner' : 'error-banner'}>
                {t('businessDay.fig.variance')}: <strong>{signedRwf(variance)}</strong> — {t(`businessDay.bands.${band}`)}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setStep(1)}>{t('common.previous')}</button>
              <button type="button" className="btn btn-primary btn-block" disabled={counted === '' || Number(counted) < 0} onClick={() => setStep(3)}>{t('common.next')}</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="field">
              <label htmlFor="explanation">
                {t('businessDay.close.explanation')} {band !== 'normal' && <span className="hint">({t('businessDay.close.required')})</span>}
              </label>
              <textarea id="explanation" rows={3} maxLength={1000} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
            </div>
            <p className="hint">{t('businessDay.close.confirmHint', { counted: rwf(counted), variance: signedRwf(variance) })}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setStep(2)}>{t('common.previous')}</button>
              <button type="button" className="btn btn-primary btn-block" disabled={busy || (band !== 'normal' && !explanation.trim())} onClick={submit}>
                {busy ? t('common.saving') : t('businessDay.close.submit')}
              </button>
            </div>
          </>
        )}

        {step === 4 && result && (
          <>
            <div className={result.day.status === 'closed' ? 'success-banner' : 'warn-banner'}>
              {result.day.status === 'closed' ? t('businessDay.close.doneClosed') : t('businessDay.close.doneReview')}
            </div>
            <p>{t('businessDay.fig.variance')}: <strong>{signedRwf(result.closing.variance)}</strong></p>
            <div className="modal-actions"><button className="btn btn-primary btn-block" onClick={onDone}>{t('common.done')}</button></div>
          </>
        )}
      </div>
    </div>
  );
}

/** Generic "reason / note" dialog for accept, recount, reopen and rejections. */
export function ReasonDialog({ title, hint, label, minLength = 0, required = true, confirmLabel, danger, onSubmit, onClose }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(text.trim());
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal-card wide" onSubmit={submit}>
        <h2>{title}</h2>
        {hint && <p className="hint">{hint}</p>}
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label htmlFor="reason">{label}</label>
          <textarea id="reason" rows={3} maxLength={1000} required={required} minLength={minLength || undefined} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block`} disabled={busy || (required && text.trim().length < minLength)}>
            {busy ? t('common.saving') : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

const CORRECTION_FIELDS = ['counted_cash', 'opening_float', 'cash_sales', 'cash_refunds', 'mtn_mobile_money', 'airtel_money', 'card'];

export function CorrectionDialog({ board, onClose, onDone }) {
  const { t } = useTranslation();
  const [field, setField] = useState('counted_cash');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = board.corrected?.values?.[field]?.corrected;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await client.post('/corrections', {
        business_day_id: board.day.id, field, requested_value: Number(value), reason, explanation: explanation || undefined,
      });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal-card wide" onSubmit={submit}>
        <h2>{t('businessDay.correction.title')}</h2>
        <p className="hint">{t('businessDay.correction.hint')}</p>
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label htmlFor="field">{t('businessDay.correction.field')}</label>
          <select id="field" value={field} onChange={(e) => setField(e.target.value)}>
            {CORRECTION_FIELDS.map((f) => <option key={f} value={f}>{t(`businessDay.fields.${f}`)}</option>)}
          </select>
          {current !== undefined && <p className="hint">{t('businessDay.correction.current', { value: rwf(current) })}</p>}
        </div>
        <div className="field">
          <label htmlFor="value">{t('businessDay.correction.value')}</label>
          <input id="value" type="number" min="0" step="1" required value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="reason">{t('businessDay.correction.reason')}</label>
          <input id="reason" required minLength={5} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="explanation">{t('businessDay.correction.explanation')}</label>
          <textarea id="explanation" rows={3} maxLength={2000} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? t('common.saving') : t('businessDay.correction.submit')}</button>
        </div>
      </form>
    </div>
  );
}

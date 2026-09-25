import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import DayBoard from '../components/businessDay/DayBoard';
import { OpenDayDialog, ClosingWizard, ReasonDialog, CorrectionDialog } from '../components/businessDay/Dialogs';
import { rwf, formatDate } from '../components/businessDay/format';

const REFRESH_MS = 60 * 1000;

function Comparison({ comparison, t }) {
  if (!comparison) return null;
  const { same_time: same, last_full_day: full } = comparison;
  const pct = (a, b) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '—');
  return (
    <section className="comparison-card">
      <div className="board-section-title">{t('businessDay.compare.title')}</div>
      <table className="data-table compact">
        <thead>
          <tr>
            <th></th>
            <th>{t('businessDay.compare.today', { time: same.slot })}</th>
            <th>{t('businessDay.compare.lastSameTime', { time: same.slot })}</th>
            <th>{t('businessDay.compare.change')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('businessDay.fig.totalSales')}</td>
            <td className="num">{rwf(same.today.sales)}</td>
            <td className="num">{rwf(same.last.sales)}</td>
            <td className="num">{pct(same.today.sales, same.last.sales)}</td>
          </tr>
          <tr>
            <td>{t('businessDay.fig.transactions')}</td>
            <td className="num">{same.today.transactions}</td>
            <td className="num">{same.last.transactions}</td>
            <td className="num">{pct(same.today.transactions, same.last.transactions)}</td>
          </tr>
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 8 }}>
        {t('businessDay.compare.fullDay', { sales: rwf(full.sales), transactions: full.transactions })}
      </p>
    </section>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { hasPermission, user } = useAuth();
  const { version } = useNotifications();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    try {
      setData((await client.get('/business-days/dashboard')).data);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, version]);

  const done = () => {
    setDialog(null);
    load();
  };

  async function startClosing() {
    try {
      await client.post('/business-days/current/closing/start');
      await load();
      setDialog('close');
    } catch (err) {
      setError(err.message);
    }
  }

  if (!data) {
    return <div className="page-body">{error ? <div className="error-banner">{error}</div> : <p style={{ color: 'var(--ink-muted)' }}>{t('common.loading')}</p>}</div>;
  }

  const { today, last } = data;
  const canOpen = hasPermission('day.open');
  const canClose = hasPermission('day.close');
  const canReview = hasPermission('day.review');
  const canReopen = hasPermission('day.reopen');
  const canCorrect = hasPermission('day.corrections.request');
  const lastSubmitter = last?.people.submitted_by?.id;
  const schedule = today?.closing_schedule;

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{t('businessDay.dashboard')}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {(canCorrect || canReview) && <Link className="btn" to="/closing/corrections">{t('businessDay.corrections')}</Link>}
          {hasPermission('day.history.view') && <Link className="btn" to="/business-days">{t('businessDay.history')}</Link>}
          {hasPermission('sales.create') && <Link className="btn btn-primary" to="/pos">{t('businessDay.goToTill')}</Link>}
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {canReview && data.awaiting_review.length > 0 && (
        <div className="warn-banner">
          {t('businessDay.awaitingReview', { dates: data.awaiting_review.map((d) => formatDate(d.business_date)).join(', ') })}
        </div>
      )}
      {schedule && schedule.state !== 'not_due' && today.day.status === 'open' && (
        <div className={schedule.state === 'overdue_critical' ? 'error-banner' : 'warn-banner'}>
          {t(`businessDay.schedule.${schedule.state}`, { time: schedule.expected_closing_time })}
        </div>
      )}

      <div className="boards">
        {last ? (
          <DayBoard board={last} title={t('businessDay.lastDay')}>
            {canReview && last.day.status === 'closing_submitted' && !last.day.recount_requested_at && lastSubmitter !== user.id && (
              <>
                <button className="btn btn-primary" onClick={() => setDialog('accept')}>{t('businessDay.review.accept')}</button>
                <button className="btn" onClick={() => setDialog('recount')}>{t('businessDay.review.recount')}</button>
              </>
            )}
            {canReview && last.day.status === 'closing_submitted' && lastSubmitter === user.id && (
              <p className="hint">{t('businessDay.review.ownClosing')}</p>
            )}
            {canClose && last.day.recount_requested_at && <button className="btn btn-primary" onClick={() => setDialog('close')}>{t('businessDay.close.recountTitle')}</button>}
            {canCorrect && ['closing_submitted', 'closed', 'closed_with_adjustment'].includes(last.day.status) && (
              <button className="btn" onClick={() => setDialog('correction')}>{t('businessDay.correction.request')}</button>
            )}
            {canReopen && !today && ['closed', 'closed_with_adjustment'].includes(last.day.status) && (
              <button className="btn btn-danger" onClick={() => setDialog('reopen')}>{t('businessDay.reopen.button')}</button>
            )}
            {last.pending_corrections > 0 && <span className="hint">{t('businessDay.pendingCorrections', { count: last.pending_corrections })}</span>}
          </DayBoard>
        ) : (
          <section className="day-board empty"><div className="day-board-title">{t('businessDay.lastDay')}</div><p className="hint">{t('businessDay.noClosingYet')}</p></section>
        )}

        {today ? (
          <DayBoard board={today} title={t('businessDay.today')}>
            {canClose && today.day.status === 'open' && (
              <button className="btn btn-primary" onClick={startClosing}>{t('businessDay.close.start')}</button>
            )}
            {canClose && today.day.status === 'closing_in_progress' && (
              <button className="btn btn-primary" onClick={() => setDialog('close')}>{t('businessDay.close.continue')}</button>
            )}
          </DayBoard>
        ) : (
          <section className="day-board empty">
            <div className="day-board-title">{t('businessDay.today')}</div>
            <p><strong>{t('businessDay.noOpenDay')}</strong></p>
            <p className="hint">{canOpen ? t('businessDay.noOpenDayHintCan') : t('businessDay.noOpenDayHint')}</p>
            {canOpen && <button className="btn btn-primary" onClick={() => setDialog('open')}>{t('businessDay.open.button')}</button>}
          </section>
        )}
      </div>

      <Comparison comparison={data.comparison} t={t} />

      {dialog === 'open' && (
        <OpenDayDialog previousCounted={last ? (last.corrected ? last.corrected.values.counted_cash.corrected : last.closing.counted_cash) : null}
          onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === 'close' && <ClosingWizard onClose={() => { setDialog(null); load(); }} onDone={done} />}
      {dialog === 'accept' && (
        <ReasonDialog title={t('businessDay.review.acceptTitle')} hint={t('businessDay.review.acceptHint')} label={t('businessDay.review.note')}
          required={false} confirmLabel={t('businessDay.review.accept')} onClose={() => setDialog(null)}
          onSubmit={async (note) => { await client.post(`/business-days/${last.day.id}/accept`, { note }); done(); }} />
      )}
      {dialog === 'recount' && (
        <ReasonDialog title={t('businessDay.review.recountTitle')} label={t('businessDay.review.reason')} minLength={3}
          confirmLabel={t('businessDay.review.recount')} onClose={() => setDialog(null)}
          onSubmit={async (reason) => { await client.post(`/business-days/${last.day.id}/recount`, { reason }); done(); }} />
      )}
      {dialog === 'reopen' && (
        <ReasonDialog title={t('businessDay.reopen.title')} hint={t('businessDay.reopen.hint')} label={t('businessDay.review.reason')} minLength={10}
          danger confirmLabel={t('businessDay.reopen.button')} onClose={() => setDialog(null)}
          onSubmit={async (reason) => { await client.post(`/business-days/${last.day.id}/reopen`, { reason }); done(); }} />
      )}
      {dialog === 'correction' && <CorrectionDialog board={last} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

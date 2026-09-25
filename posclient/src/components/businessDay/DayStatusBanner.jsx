import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { OpenDayDialog } from './Dialogs';

/**
 * Till banner: explains why selling is blocked (no open day / closing in
 * progress) and lets authorized users open the day. The API refuses the sale
 * either way - this only saves the cashier a failed checkout.
 */
export default function DayStatusBanner({ onStatus }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { version } = useNotifications();
  const [state, setState] = useState(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get('/business-days/dashboard');
      const status = data.today ? data.today.day.status : 'none';
      setState({ status, schedule: data.today?.closing_schedule, last: data.last });
      onStatus?.(status);
    } catch {
      setState(null);
    }
  }, [onStatus]);

  useEffect(() => {
    load();
  }, [load, version]);

  if (!state) return null;
  if (state.status === 'open' && (!state.schedule || state.schedule.state === 'not_due')) return null;

  return (
    <div className="till-banner-wrap">
      {state.status === 'none' && (
        <div className="error-banner till-banner">
          <span>{t('businessDay.till.noDay')}</span>
          {hasPermission('day.open')
            ? <button className="btn btn-primary btn-sm" onClick={() => setOpening(true)}>{t('businessDay.open.button')}</button>
            : <span>{t('businessDay.till.askOpen')}</span>}
        </div>
      )}
      {state.status === 'closing_in_progress' && (
        <div className="warn-banner till-banner">
          <span>{t('businessDay.till.closing')}</span>
          <Link className="btn btn-sm" to="/">{t('businessDay.backToDashboard')}</Link>
        </div>
      )}
      {state.status === 'open' && state.schedule && state.schedule.state !== 'not_due' && (
        <div className={`${state.schedule.state === 'overdue_critical' ? 'error-banner' : 'warn-banner'} till-banner`}>
          <span>{t(`businessDay.schedule.${state.schedule.state}`, { time: state.schedule.expected_closing_time })}</span>
          <Link className="btn btn-sm" to="/">{t('businessDay.backToDashboard')}</Link>
        </div>
      )}
      {opening && (
        <OpenDayDialog
          previousCounted={state.last ? (state.last.corrected ? state.last.corrected.values.counted_cash.corrected : state.last.closing.counted_cash) : null}
          onClose={() => setOpening(false)}
          onDone={() => { setOpening(false); load(); }}
        />
      )}
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useBusinessDay } from '../../context/BusinessDayContext';
import { Alert } from '../../ui/display';
import Button from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { OpenDayDialog } from './Dialogs';

/**
 * Till banner: explains why selling is blocked (no open day / closing in
 * progress) or that closing is due, and lets authorized users open the day.
 * The API refuses the sale either way - this saves a failed checkout.
 */
export default function DayStatusBanner() {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const { data, status, refresh } = useBusinessDay();
  const [opening, setOpening] = useState(false);
  if (!data) return null;
  const schedule = data.today?.closing_schedule;
  const last = data.last;

  let banner = null;
  if (status === 'none') {
    banner = (
      <Alert tone="danger" title={t('businessDay.till.noDay')}
        action={hasPermission('day.open') ? <Button size="sm" variant="primary" onClick={() => setOpening(true)}>{t('businessDay.open.button')}</Button> : null}>
        {!hasPermission('day.open') && t('businessDay.till.askOpen')}
      </Alert>
    );
  } else if (status === 'closing_in_progress') {
    banner = <Alert tone="warning" title={t('businessDay.till.closing')} action={<Button size="sm" to="/">{t('nav.items.dashboard')}</Button>} />;
  } else if (status === 'open' && schedule && schedule.state !== 'not_due') {
    banner = (
      <Alert tone={schedule.state === 'overdue_critical' ? 'danger' : 'warning'} title={t(`businessDay.schedule.${schedule.state}`, { time: schedule.expected_closing_time })}
        action={<Button size="sm" to="/">{t('nav.items.dashboard')}</Button>} />
    );
  }
  if (!banner && !opening) return null;

  return (
    <div className="till-banner">
      {banner}
      {opening && (
        <OpenDayDialog
          previousCounted={last ? (last.corrected ? last.corrected.values.counted_cash.corrected : last.closing.counted_cash) : null}
          onClose={() => setOpening(false)}
          onDone={() => { setOpening(false); refresh(); toast.success(t('dashboard.toast.opened')); }}
        />
      )}
    </div>
  );
}

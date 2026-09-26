import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useBusinessDay } from '../../context/BusinessDayContext';
import { Alert } from '../../ui/display';
import Button from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { OpenDayDialog } from './Dialogs';
import { RequestOpeningDialog } from './OpeningRequests';
import { formatTime } from '../../ui/format';

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
  const [opening, setOpening] = useState(null); // 'open' | 'request'
  if (!data) return null;
  const schedule = data.today?.closing_schedule;
  const last = data.last;
  // Only store managers open the day; cashiers and store keepers request it.
  const canOpen = hasPermission('day.open');
  const canRequest = !canOpen && hasPermission('day.open.request');
  const myRequest = data.opening_requests?.mine;
  const pending = myRequest?.status === 'pending';

  let banner = null;
  if (status === 'none') {
    banner = (
      <Alert tone="danger" title={t('businessDay.till.noDay')}
        action={canOpen ? <Button size="sm" variant="primary" onClick={() => setOpening('open')}>{t('businessDay.open.button')}</Button>
          : canRequest && !pending ? <Button size="sm" variant="primary" onClick={() => setOpening('request')}>{t('businessDay.request.button')}</Button> : null}>
        {!canOpen && (pending ? t('businessDay.request.pendingText', { time: formatTime(myRequest.requested_at) })
          : canRequest ? t('businessDay.request.notOpen') : t('businessDay.till.askOpen'))}
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
      {opening === 'open' && (
        <OpenDayDialog
          previousCounted={last ? (last.corrected ? last.corrected.values.counted_cash.corrected : last.closing.counted_cash) : null}
          onClose={() => setOpening(null)}
          onDone={() => { setOpening(null); refresh(); toast.success(t('dashboard.toast.opened')); }}
        />
      )}
      {opening === 'request' && (
        <RequestOpeningDialog
          businessDate={data.shop_date}
          onClose={() => setOpening(null)}
          onDone={() => { setOpening(null); refresh(); toast.success(t('businessDay.request.sent')); }}
        />
      )}
    </div>
  );
}

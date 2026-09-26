import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CalendarCheck2, History } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useBusinessDay } from '../context/BusinessDayContext';
import { ReasonDialog } from '../components/businessDay/Dialogs';
import { useToast } from '../ui/Toast';
import ClosingReport, { DAY_STATUS_TONE, HealthBadge, PeopleList, dayTitle } from '../components/businessDay/ClosingReport';
import { PageHeader, Panel, StatusBadge, ErrorState, SkeletonPanel, EmptyState, Metric } from '../ui/display';
import DataTable from '../ui/DataTable';
import Button from '../ui/Button';
import { humanizeType } from '../utils/notificationDisplay';
import { formatRwf, formatDate, formatTime, formatNumber } from '../ui/format';

const BAND_TONE = { normal: 'success', attention: 'warning', critical: 'danger' };

/** /business-days - every business day (managers only; enforced by the API). */
export function BusinessDayHistory() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData((await client.get('/business-days', { params: { limit: 100 } })).data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    { key: 'business_date', header: t('businessDay.businessDate'), sortable: true, mobile: 'title', render: (d) => dayTitle(t, d, { weekday: true }) },
    {
      key: 'status', header: t('common.status'), sortable: true, mobile: 'meta',
      render: (d) => (
        <span className="badge-group">
          <StatusBadge tone={DAY_STATUS_TONE[d.status]}>{t(`businessDay.status.${d.status}`)}</StatusBadge>
          {d.reopened_count > 0 && <StatusBadge tone="danger">{t('businessDay.reopenedTimes', { count: d.reopened_count })}</StatusBadge>}
        </span>
      ),
    },
    { key: 'opened_by_name', header: t('businessDay.people.openedBy'), sortable: true, render: (d) => d.opened_by_name || '—' },
    { key: 'submitted_by_name', header: t('businessDay.people.submittedBy'), sortable: true, mobile: 'subtitle', render: (d) => d.submitted_by_name || '—' },
    { key: 'net_sales', header: t('businessDay.fig.netSales'), align: 'right', sortable: true, mobile: 'value', sortValue: (d) => d.net_sales ?? -1, render: (d) => (d.net_sales === null ? '—' : formatRwf(d.net_sales)) },
    {
      key: 'variance', header: t('businessDay.fig.variance'), align: 'right', sortable: true, mobile: 'meta', sortValue: (d) => Math.abs(d.variance ?? 0),
      render: (d) => (d.variance === null ? '—' : <StatusBadge tone={BAND_TONE[d.variance_band]}>{formatRwf(d.variance, { signed: true })}</StatusBadge>),
    },
    {
      key: 'issues', header: t('businessDay.corrections'), mobile: 'meta',
      render: (d) => (
        <span className="badge-group">
          {d.pending_corrections > 0 && <StatusBadge tone="warning">{t('businessDay.pendingCorrections', { count: d.pending_corrections })}</StatusBadge>}
          {d.adjustments > 0 && <StatusBadge tone="info">{t('businessDay.adjustmentsCount', { count: d.adjustments })}</StatusBadge>}
          {!d.pending_corrections && !d.adjustments && <span className="text-muted">—</span>}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader title={t('businessDay.history')} subtitle={t('businessDay.historySubtitle')} />
      <DataTable caption={t('businessDay.history')} columns={columns} rows={data?.items} loading={!data} error={error} onRetry={load}
        initialSort={{ key: 'business_date', dir: 'desc' }} onRowClick={(d) => navigate(`/business-days/${d.id}`)}
        rowLabel={(d) => t('businessDay.openDay', { date: dayTitle(t, d) })}
        empty={{ icon: CalendarCheck2, title: t('businessDay.noClosingYet'), description: t('dashboard.noClosingHint') }} />
    </div>
  );
}

function timelineLabel(item, t) {
  if (item.kind === 'event') return t(`notificationTypes.${item.code}`, { defaultValue: humanizeType(item.code) });
  return t(`businessDay.timeline.${item.code.replace(/\./g, '_')}`, { defaultValue: item.code });
}
const TIMELINE_TONE = { critical: 'danger', warning: 'warning', info: 'info', denied: 'warning', failure: 'danger' };

/** /business-days/:id - one day's report, closing versions and accountability timeline. */
export function BusinessDayDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [board, setBoard] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const { hasPermission } = useAuth();
  const { refresh: refreshDay } = useBusinessDay();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [b, tl] = await Promise.all([client.get(`/business-days/${id}`), client.get(`/business-days/${id}/timeline`)]);
      setBoard(b.data);
      setTimeline(tl.data.items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Any closing still awaiting review can be decided here, not just the newest one on the dashboard.
  const reviewable = board && hasPermission('day.review') && board.day.status === 'closing_submitted' && !board.day.recount_requested_at;
  const reviewActions = reviewable && (
    <>
      <Button variant="primary" onClick={() => setDialog('accept')}>{t('businessDay.review.accept')}</Button>
      <Button onClick={() => setDialog('recount')}>{t('businessDay.review.recount')}</Button>
    </>
  );
  const decided = (message) => {
    setDialog(null);
    load();
    refreshDay();
    toast.success(message);
  };

  return (
    <div className="page">
      <PageHeader
        title={board ? dayTitle(t, board.day, { weekday: true }) : t('businessDay.history')}
        subtitle={board ? t(`businessDay.status.${board.day.status}`) : undefined}
        actions={<Button icon={ArrowLeft} to="/business-days">{t('businessDay.history')}</Button>}
      />
      {error && <ErrorState error={error} onRetry={load} />}
      {!board && !error && <div className="dashboard-grid"><SkeletonPanel lines={8} /><SkeletonPanel lines={8} /></div>}
      {board && (
        <div className="dashboard-grid">
          <div className="dashboard-main">
            {board.kind === 'live' ? (
              <Panel title={t('businessDay.today')} actions={<HealthBadge health={board.health} />}>
                <div className="metric-row">
                  <Metric size="lg" label={t('businessDay.fig.salesSoFar')} value={formatRwf(board.figures.sales.gross)}
                    hint={t('businessDay.transactionsCount', { count: board.figures.sales.transactions })} />
                  <Metric size="lg" label={t('businessDay.fig.expectedCash')} value={formatRwf(board.figures.cash.expected_cash)} />
                </div>
                <PeopleList people={board.people} closed={false} />
              </Panel>
            ) : (
              <ClosingReport board={board} title={t('businessDay.closingReport')} headingLevel={2} actions={reviewActions} />
            )}
            {board.versions?.length > 1 && (
              <Panel title={t('businessDay.versions')} subtitle={t('businessDay.versionsHint')}>
                <DataTable caption={t('businessDay.versions')} rows={board.versions}
                  columns={[
                    { key: 'version', header: t('businessDay.version'), mobile: 'title', render: (v) => `v${v.version}` },
                    { key: 'submitted_by_name', header: t('businessDay.people.submittedBy'), mobile: 'subtitle' },
                    { key: 'submitted_at', header: t('common.date'), render: (v) => `${formatDate(v.submitted_at)} ${formatTime(v.submitted_at)}` },
                    { key: 'counted_cash', header: t('businessDay.fig.countedCash'), align: 'right', render: (v) => formatRwf(v.counted_cash) },
                    { key: 'variance', header: t('businessDay.fig.variance'), align: 'right', mobile: 'value', render: (v) => formatRwf(v.variance, { signed: true }) },
                  ]} />
              </Panel>
            )}
          </div>
          <aside className="dashboard-side">
            <Panel title={t('businessDay.timeline.title')} icon={History} subtitle={timeline ? t('businessDay.timeline.count', { count: formatNumber(timeline.length) }) : undefined}>
              {timeline && timeline.length === 0 && <EmptyState compact title={t('businessDay.timeline.empty')} />}
              <ol className="timeline">
                {(timeline || []).map((item) => (
                  <li key={item.id} className={`timeline-item tone-${TIMELINE_TONE[item.severity || item.result] || 'neutral'}`}>
                    <span className="timeline-time num">{formatTime(item.at)}</span>
                    <span className="timeline-text">
                      <strong>{timelineLabel(item, t)}</strong>
                      <span className="text-secondary">
                        {item.actor_name && ` · ${item.actor_name}`}
                        {item.entity_type && item.entity_type !== 'business_day' && ` · ${item.entity_type} #${item.entity_id}`}
                        {item.occurrences > 1 && ` · ×${item.occurrences}`}
                      </span>
                      {(item.severity || (item.result && item.result !== 'success')) && (
                        <span className="sr-only">({item.severity || item.result})</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          </aside>
        </div>
      )}
      {dialog === 'accept' && (
        <ReasonDialog title={t('businessDay.review.acceptTitle')} description={t('businessDay.review.acceptHint')} label={t('businessDay.review.note')}
          required={false} confirmLabel={t('businessDay.review.accept')} onClose={() => setDialog(null)}
          onSubmit={async (note) => { await client.post(`/business-days/${board.day.id}/accept`, { note }); decided(t('dashboard.toast.accepted')); }} />
      )}
      {dialog === 'recount' && (
        <ReasonDialog title={t('businessDay.review.recountTitle')} label={t('businessDay.review.reason')} minLength={3}
          confirmLabel={t('businessDay.review.recount')} onClose={() => setDialog(null)}
          onSubmit={async (reason) => { await client.post(`/business-days/${board.day.id}/recount`, { reason }); decided(t('dashboard.toast.recount')); }} />
      )}
    </div>
  );
}

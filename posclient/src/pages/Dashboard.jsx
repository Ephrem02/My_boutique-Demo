import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, CalendarPlus, CheckCircle2, ClipboardCheck, Clock, FileWarning,
  PackageX, Play, ShoppingCart, TrendingUp, Boxes,
} from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useBusinessDay } from '../context/BusinessDayContext';
import { useNotifications } from '../context/NotificationContext';
import { OpenDayDialog, ClosingWizard, ReasonDialog, CorrectionDialog, METHODS } from '../components/businessDay/Dialogs';
import ClosingReport, { PeopleList, HealthBadge, DAY_STATUS_TONE, dayTitle } from '../components/businessDay/ClosingReport';
import { RequestOpeningDialog, MyOpeningRequest, OpeningRequestCards } from '../components/businessDay/OpeningRequests';
import { PageHeader, Panel, Metric, StatusBadge, EmptyState, SkeletonPanel, ErrorState, DescriptionList } from '../ui/display';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { formatRwf, formatDate, formatTime, formatPercentChange, formatNumber } from '../ui/format';

/** "Needs attention" - only things that exist, most severe first. */
function attentionItems({ data, t, hasPermission, unread }) {
  const items = [];
  const { today, last } = data;
  const schedule = today?.closing_schedule;
  const openingRequests = data.opening_requests?.pending || [];
  if (openingRequests.length) items.push({ tone: 'warning', icon: CalendarPlus, text: t('dashboard.attention.openingRequests', { count: openingRequests.length }), to: '/' });
  if (schedule?.state === 'overdue_critical') items.push({ tone: 'danger', icon: Clock, text: t('dashboard.attention.overdue', { time: schedule.expected_closing_time }), to: '/' });
  if (last?.closing?.variance_band === 'critical') {
    items.push({ tone: 'danger', icon: AlertTriangle, text: t('dashboard.attention.variance', { amount: formatRwf(last.corrected?.variance ?? last.closing.variance, { signed: true }), date: dayTitle(t, last.day) }), to: hasPermission('day.history.view') ? `/business-days/${last.day.id}` : undefined });
  }
  for (const d of data.awaiting_review || []) {
    items.push({ tone: 'warning', icon: ClipboardCheck, text: t('dashboard.attention.awaitingReview', { date: dayTitle(t, d) }), to: `/business-days/${d.id}` });
  }
  if (last?.day.recount_requested_at && hasPermission('day.close')) items.push({ tone: 'warning', icon: ClipboardCheck, text: t('dashboard.attention.recount', { date: dayTitle(t, last.day) }) });
  if (last?.closing?.variance_band === 'attention') {
    items.push({ tone: 'warning', icon: AlertTriangle, text: t('dashboard.attention.variance', { amount: formatRwf(last.corrected?.variance ?? last.closing.variance, { signed: true }), date: dayTitle(t, last.day) }), to: hasPermission('day.history.view') ? `/business-days/${last.day.id}` : undefined });
  }
  if (schedule?.state === 'due') items.push({ tone: 'warning', icon: Clock, text: t('dashboard.attention.due', { time: schedule.expected_closing_time }) });
  const inventory = (today || last)?.figures.inventory;
  if (inventory?.out_of_stock_count) items.push({ tone: 'danger', icon: PackageX, text: t('dashboard.attention.outOfStock', { count: inventory.out_of_stock_count }), to: hasPermission('stock.view') ? '/stock' : undefined });
  if (inventory?.low_stock_count) items.push({ tone: 'warning', icon: Boxes, text: t('dashboard.attention.lowStock', { count: inventory.low_stock_count }), to: hasPermission('products.view') ? '/products?filter=low' : undefined });
  if (today?.alerts?.pending_corrections) items.push({ tone: 'warning', icon: FileWarning, text: t('dashboard.attention.corrections', { count: today.alerts.pending_corrections }), to: '/closing/corrections' });
  if (unread) items.push({ tone: 'info', icon: Bell, text: t('dashboard.attention.unread', { count: unread }), to: '/notifications' });
  return items;
}

function AttentionPanel({ items }) {
  const { t } = useTranslation();
  return (
    <Panel title={t('dashboard.attentionTitle')} icon={AlertTriangle} className="attention-panel">
      {items.length === 0 ? (
        <div className="all-clear"><CheckCircle2 aria-hidden="true" />{t('dashboard.allClear')}</div>
      ) : (
        <ul className="attention-list">
          {items.map((item) => {
            const Icon = item.icon;
            const content = (
              <>
                <span className={`attention-icon tone-${item.tone}`}><Icon aria-hidden="true" /></span>
                <span className="attention-text">{item.text}</span>
                <span className="sr-only">({t(`dashboard.tone.${item.tone}`)})</span>
              </>
            );
            return <li key={item.text}>{item.to ? <Link to={item.to} className="attention-item">{content}</Link> : <div className="attention-item">{content}</div>}</li>;
          })}
        </ul>
      )}
    </Panel>
  );
}

function StockAlerts({ figures }) {
  const { t } = useTranslation();
  const list = [...figures.inventory.out_of_stock, ...figures.inventory.low_stock].slice(0, 6);
  return (
    <Panel className="stock-panel" title={t('dashboard.stockAlerts')} icon={Boxes} actions={<Button size="sm" variant="ghost" to="/stock">{t('dashboard.viewStock')}</Button>}>
      {list.length === 0 ? (
        <div className="all-clear"><CheckCircle2 aria-hidden="true" />{t('dashboard.stockOk')}</div>
      ) : (
        <ul className="stock-alert-list">
          {list.map((p) => (
            <li key={p.id}>
              <span className="stock-alert-name">{p.name}<span className="text-muted"> · {p.sku}</span></span>
              <StatusBadge tone={p.total === 0 ? 'danger' : 'warning'}>
                {p.total === 0 ? t('dashboard.out') : t('dashboard.left', { count: p.total })}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Today's live sales: one headline, supporting payment detail. */
function TodaySales({ today, comparison }) {
  const { t } = useTranslation();
  const f = today.figures;
  const same = comparison?.same_time;
  const change = same ? formatPercentChange(same.today.sales, same.last.sales) : null;
  const up = same && same.today.sales >= same.last.sales;
  return (
    <Panel className="today-sales" title={t('dashboard.todaySales')} icon={TrendingUp}
      actions={<StatusBadge tone="success">{t('dashboard.live')}</StatusBadge>}>
      <Metric size="xl" label={<span className="sr-only">{t('dashboard.todaySales')}</span>} value={formatRwf(f.sales.gross)}
        hint={t('businessDay.transactionsCount', { count: f.sales.transactions })} />
      {change && (
        <p className={`trend ${up ? 'trend-up' : 'trend-down'}`}>
          {up ? <ArrowUpRight aria-hidden="true" /> : <ArrowDownRight aria-hidden="true" />}
          <span className="num">{change}</span>
          <span className="text-secondary">{t('dashboard.vsSameTime', { time: same.slot })}</span>
        </p>
      )}
      <div className="method-strip">
        {METHODS.map((m) => (
          <Metric key={m} size="sm" label={t(`paymentMethods.${m}`)} value={formatRwf(f.payment_methods[m])} />
        ))}
      </div>
      <DescriptionList className="today-extra" items={[
        { label: t('businessDay.fig.refunds'), value: formatRwf(-f.sales.refunds) },
        { label: t('businessDay.fig.voids'), value: formatNumber(f.sales.void_count) },
        { label: t('businessDay.fig.netSales'), value: formatRwf(f.sales.net), strong: true },
        { label: t('businessDay.fig.expectedCash'), value: formatRwf(f.cash.expected_cash) },
      ]} />
      {comparison && (
        <p className="field-hint comparison-note">
          {t('dashboard.fullDayNote', { sales: formatRwf(comparison.last_full_day.sales), count: comparison.last_full_day.transactions })}
        </p>
      )}
    </Panel>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { hasPermission, user } = useAuth();
  const { unread } = useNotifications();
  const { data, error, refresh } = useBusinessDay();
  const toast = useToast();
  const [dialog, setDialog] = useState(null);

  const done = (message) => {
    setDialog(null);
    refresh();
    if (message) toast.success(message);
  };

  if (error && !data) return <div className="page"><ErrorState error={error} onRetry={refresh} /></div>;
  if (!data) {
    return (
      <div className="page" aria-busy="true">
        <PageHeader title={t('dashboard.title')} />
        <div className="dashboard-grid"><SkeletonPanel lines={6} /><SkeletonPanel lines={4} /></div>
      </div>
    );
  }

  const { today, last } = data;
  // Only store managers open the day; cashiers and store keepers request it.
  const canOpen = hasPermission('day.open');
  const canRequest = !canOpen && hasPermission('day.open.request');
  const myRequest = data.opening_requests?.mine;
  const requestPending = myRequest?.status === 'pending';
  const pendingRequests = data.opening_requests?.pending || [];
  const noDayHint = canOpen ? t('businessDay.noOpenDayHintCan')
    : requestPending ? t('businessDay.request.pendingText', { time: formatTime(myRequest.requested_at) })
      : canRequest ? t('businessDay.request.notOpen') : t('businessDay.noOpenDayHint');
  const requestButton = canRequest && !requestPending && (
    <Button variant="primary" icon={CalendarPlus} onClick={() => setDialog('request')}>{t('businessDay.request.button')}</Button>
  );
  const canClose = hasPermission('day.close');
  const canReview = hasPermission('day.review');
  const canCorrect = hasPermission('day.corrections.request');
  const isKeeper = user?.role === 'store_keeper';
  const status = today ? today.day.status : 'none';
  const schedule = today?.closing_schedule;
  const items = attentionItems({ data, t, hasPermission, unread });

  async function startClosing() {
    await client.post('/business-days/current/closing/start');
    await refresh();
    setDialog('close');
  }

  const lastActions = last && (
    <>
      {canReview && last.day.status === 'closing_submitted' && !last.day.recount_requested_at && (
        <>
          <Button variant="primary" onClick={() => setDialog('accept')}>{t('businessDay.review.accept')}</Button>
          <Button onClick={() => setDialog('recount')}>{t('businessDay.review.recount')}</Button>
        </>
      )}
      {canClose && last.day.recount_requested_at && <Button variant="primary" onClick={() => setDialog('close')}>{t('businessDay.close.recountTitle')}</Button>}
      {canCorrect && ['closing_submitted', 'closed', 'closed_with_adjustment'].includes(last.day.status) && (
        <Button onClick={() => setDialog('correction')}>{t('businessDay.correction.request')}</Button>
      )}
      {hasPermission('day.reopen') && !today && ['closed', 'closed_with_adjustment'].includes(last.day.status) && (
        <Button variant="danger" onClick={() => setDialog('reopen')}>{t('businessDay.reopen.button')}</Button>
      )}
      {hasPermission('day.history.view') && <Button variant="ghost" to={`/business-days/${last.day.id}`}>{t('dashboard.fullHistory')}</Button>}
    </>
  );

  return (
    <div className="page dashboard">
      <PageHeader
        title={t('dashboard.greeting', { name: user?.full_name?.split(' ')[0] })}
        subtitle={formatDate(data.shop_date, { weekday: true })}
        actions={(
          <>
            {hasPermission('sales.create') && <Button variant="primary" icon={ShoppingCart} to="/pos">{t('dashboard.goToTill')}</Button>}
            {hasPermission('day.history.view') && <Button to="/business-days">{t('businessDay.history')}</Button>}
          </>
        )}
      />

      {/* 1. Business day status */}
      <section className={`day-strip day-strip-${status}`} aria-label={t('dashboard.dayStatus')}>
        <div className="day-strip-main">
          <StatusBadge tone={DAY_STATUS_TONE[status] || 'neutral'}>{t(`shell.day.${status}`)}</StatusBadge>
          <div className="day-strip-text">
            {today ? (
              <>
                <strong>{t('dashboard.todayOpened', { date: dayTitle(t, today.day, { weekday: true }) })}</strong>
                <span className="text-secondary">
                  {t('dashboard.openedBy', { name: today.people.opened_by?.name || '—', time: formatTime(today.day.opened_at) })}
                  {today.people.closing_requested_by && ` · ${t('dashboard.closingRequestedBy', { name: today.people.closing_requested_by.name, time: formatTime(today.people.closing_requested_by.at) })}`}
                </span>
                {schedule && <span className="text-secondary">{t(`dashboard.schedule.${schedule.state}`, { time: schedule.expected_closing_time })}</span>}
              </>
            ) : (
              <>
                <strong>{t('businessDay.noOpenDay')}</strong>
                <span className="text-secondary">{noDayHint}</span>
              </>
            )}
          </div>
        </div>
        <div className="day-strip-actions">
          {!today && canOpen && <Button variant="primary" icon={CalendarPlus} onClick={() => setDialog('open')}>{t('businessDay.open.button')}</Button>}
          {!today && requestButton}
          {today?.day.status === 'open' && canClose && <Button variant={schedule?.state === 'not_due' ? 'secondary' : 'primary'} icon={Play} onClick={startClosing}>{t('businessDay.close.start')}</Button>}
          {today?.day.status === 'closing_in_progress' && canClose && <Button variant="primary" onClick={() => setDialog('close')}>{t('businessDay.close.continue')}</Button>}
          {today && <HealthBadge health={today.health} />}
        </div>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-main">
          {!today && pendingRequests.length > 0 && (
            <OpeningRequestCards requests={pendingRequests} onDecided={(message) => done(message)} />
          )}
          {!today && <MyOpeningRequest request={myRequest} onRequestAgain={canRequest ? () => setDialog('request') : null} />}
          {isKeeper && today && <StockAlerts figures={today.figures} />}
          {today ? (
            <TodaySales today={today} comparison={data.comparison} />
          ) : (
            <Panel>
              <EmptyState icon={CalendarPlus} title={t('dashboard.noSalesYet')} description={noDayHint}
                action={canOpen ? <Button variant="primary" onClick={() => setDialog('open')}>{t('businessDay.open.button')}</Button> : requestButton || null} />
            </Panel>
          )}
          {last ? (
            <ClosingReport board={last} title={t('businessDay.lastDay')} actions={lastActions} />
          ) : (
            <Panel><EmptyState compact icon={ClipboardCheck} title={t('businessDay.noClosingYet')} description={t('dashboard.noClosingHint')} /></Panel>
          )}
        </div>

        <aside className="dashboard-side" aria-label={t('dashboard.sideSummary')}>
          <AttentionPanel items={items} />
          {today && (
            <Panel title={t('dashboard.onDuty')} icon={Clock}>
              <PeopleList people={today.people} closed={false} />
            </Panel>
          )}
          {!isKeeper && today && <StockAlerts figures={today.figures} />}
          {today?.figures.per_cashier?.length > 0 && (
            <Panel title={t('businessDay.perCashier')}>
              <DescriptionList items={today.figures.per_cashier.map((c) => ({
                label: `${c.name} · ${t('businessDay.transactionsCount', { count: c.transactions })}`, value: formatRwf(c.sales),
              }))} />
            </Panel>
          )}
        </aside>
      </div>

      {dialog === 'open' && (
        <OpenDayDialog previousCounted={last ? (last.corrected ? last.corrected.values.counted_cash.corrected : last.closing.counted_cash) : null}
          onClose={() => setDialog(null)} onDone={() => done(t('dashboard.toast.opened'))} />
      )}
      {dialog === 'request' && (
        <RequestOpeningDialog businessDate={data.shop_date} onClose={() => setDialog(null)} onDone={() => done(t('businessDay.request.sent'))} />
      )}
      {dialog === 'close' && <ClosingWizard onClose={() => { setDialog(null); refresh(); }} onDone={() => done()} />}
      {dialog === 'accept' && (
        <ReasonDialog title={t('businessDay.review.acceptTitle')} description={t('businessDay.review.acceptHint')} label={t('businessDay.review.note')}
          required={false} confirmLabel={t('businessDay.review.accept')} onClose={() => setDialog(null)}
          onSubmit={async (note) => { await client.post(`/business-days/${last.day.id}/accept`, { note }); done(t('dashboard.toast.accepted')); }} />
      )}
      {dialog === 'recount' && (
        <ReasonDialog title={t('businessDay.review.recountTitle')} label={t('businessDay.review.reason')} minLength={3}
          confirmLabel={t('businessDay.review.recount')} onClose={() => setDialog(null)}
          onSubmit={async (reason) => { await client.post(`/business-days/${last.day.id}/recount`, { reason }); done(t('dashboard.toast.recount')); }} />
      )}
      {dialog === 'reopen' && (
        <ReasonDialog title={t('businessDay.reopen.title')} description={t('businessDay.reopen.hint')} label={t('businessDay.review.reason')} minLength={10}
          danger confirmLabel={t('businessDay.reopen.button')} onClose={() => setDialog(null)}
          onSubmit={async (reason) => { await client.post(`/business-days/${last.day.id}/reopen`, { reason }); done(t('dashboard.toast.reopened')); }} />
      )}
      {dialog === 'correction' && <CorrectionDialog board={last} onClose={() => setDialog(null)} onDone={() => done(t('dashboard.toast.correction'))} />}
    </div>
  );
}

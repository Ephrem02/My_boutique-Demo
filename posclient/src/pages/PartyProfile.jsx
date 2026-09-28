import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pencil, Plus, Wallet } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { KIND, STATUS_TONE, AccountPaymentDialog, InvoiceDetail, LineItemsDialog, PartyFormDialog, financeUrl } from '../components/parties';
import ProfileOverview from '../components/profile/ProfileOverview';
import { InvoicesTab, PaymentsTab, ReturnsTab } from '../components/profile/ProfileLedger';
import { CustomerInsights, PeriodPicker, SupplierPerformance, SupplierProducts, periodRange } from '../components/profile/ProfileInsights';
import { ActivityTab, NotesTab } from '../components/profile/ProfileActivity';
import Button from '../ui/Button';
import { Alert, ErrorState, Metric, PageHeader, SkeletonPanel, StatusBadge, Tabs } from '../ui/display';
import { useToast } from '../ui/Toast';
import { formatRwf, formatDate } from '../ui/format';

/**
 * Customer / supplier 360°: one page with identity, balances, every invoice,
 * payment, return and note, insights, and the audit trail. All money comes
 * from the ledger; nothing on this page stores a balance.
 */
export default function PartyProfile({ kind }) {
  const { id } = useParams();
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const cfg = KIND[kind];
  const isSupplier = kind === 'supplier';
  const [params, setParams] = useSearchParams();
  const [party, setParty] = useState(null);
  const [statement, setStatement] = useState(null);
  const [insights, setInsights] = useState(null);
  const [period, setPeriod] = useState('all');
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const canSeeMoney = hasPermission(cfg.moneyView);

  const load = useCallback(async () => {
    try {
      const [{ data: p }, st] = await Promise.all([
        client.get(`${cfg.endpoint}/${id}`),
        canSeeMoney ? client.get(financeUrl(kind, `/parties/${id}/statement`)) : Promise.resolve(null),
      ]);
      setParty(p);
      setStatement(st?.data || null);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [cfg.endpoint, id, kind, canSeeMoney]);

  const loadInsights = useCallback(async () => {
    if (!canSeeMoney) return;
    try {
      const { data } = await client.get(financeUrl(kind, `/parties/${id}/insights`), { params: periodRange(period) });
      setInsights(data);
    } catch (err) {
      setError(err);
    }
  }, [kind, id, period, canSeeMoney]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const reload = () => {
    load();
    loadInsights();
  };

  const tabs = [
    { id: 'overview', label: t('profile.tabs.overview') },
    { id: 'invoices', label: isSupplier ? t('profile.tabs.purchases') : t('profile.tabs.sales'), count: (party?.deliveries || party?.orders)?.length },
    canSeeMoney && { id: 'payments', label: isSupplier ? t('profile.tabs.payables') : t('profile.tabs.payments') },
    canSeeMoney && { id: 'returns', label: isSupplier ? t('profile.tabs.returnsCredits') : t('profile.tabs.returnsRefunds'), count: statement?.returns.length || undefined },
    canSeeMoney && !isSupplier && { id: 'insights', label: t('profile.tabs.insights') },
    canSeeMoney && isSupplier && { id: 'products', label: t('profile.tabs.products') },
    canSeeMoney && isSupplier && { id: 'performance', label: t('profile.tabs.performance') },
    { id: 'notes', label: t('profile.tabs.notes') },
    hasPermission('audit.view') && { id: 'activity', label: t('profile.tabs.activity') },
  ].filter(Boolean);
  const tab = tabs.some((x) => x.id === params.get('tab')) ? params.get('tab') : 'overview';
  const setTab = (next) => setParams(next === 'overview' ? {} : { tab: next }, { replace: true });
  const openInvoice = (invoiceId) => setDialog({ type: 'invoice', id: invoiceId });

  const summary = statement?.summary;
  const f = insights?.financial;
  const canPayAccount = summary?.owed > 0 && hasPermission(cfg.payManage);
  const canRecord = hasPermission(cfg.recordManage) && !(party?.status === 'blocked');
  const noteWriters = isSupplier ? ['suppliers.manage', cfg.payManage] : ['institutions.manage', cfg.payManage];

  if (error && !party) {
    return <div className="page"><ErrorState error={error} onRetry={load} /></div>;
  }
  if (!party) {
    return <div className="page"><SkeletonPanel lines={10} /></div>;
  }

  return (
    <div className="page">
      <PageHeader
        title={party.name}
        subtitle={[
          isSupplier ? t('profile.supplierSince', { date: formatDate(party.created_at) }) : t('profile.clientSince', { date: formatDate(party.created_at) }),
          isSupplier ? party.category : t(`institutions.types.${party.type}`, { defaultValue: party.type }),
        ].filter(Boolean).join(' · ')}
        actions={(
          <>
            <Button icon={ArrowLeft} to={isSupplier ? '/suppliers' : '/institutions'}>{t(`${cfg.ns}.title`)}</Button>
            {hasPermission(cfg.manage) && <Button icon={Pencil} onClick={() => setDialog({ type: 'edit' })}>{t('profile.edit')}</Button>}
            {canPayAccount && <Button icon={Wallet} onClick={() => setDialog({ type: 'payAccount' })}>{t('finance.payAccount')}</Button>}
            {canRecord && <Button variant="primary" icon={Plus} onClick={() => setDialog({ type: 'record' })}>{t(`${cfg.ns}.recordNew`)}</Button>}
          </>
        )}
      >
        <div className="record-card-badges profile-badges">
          <StatusBadge tone={STATUS_TONE[party.status]}>{t(`profile.statuses.${party.status}`)}</StatusBadge>
          {insights?.purchasing?.inactive && <StatusBadge tone="warning">{t('profile.inactiveBadge', { days: insights.purchasing.inactive_after_days })}</StatusBadge>}
          {summary?.overdue > 0 && <StatusBadge tone="danger">{t('finance.overdue')}</StatusBadge>}
        </div>
      </PageHeader>

      {party.status === 'blocked' && <Alert tone="danger" title={t('profile.blockedTitle')} className="profile-section">{t('profile.blockedBody')}</Alert>}
      {summary?.pending_returns > 0 && <Alert tone="warning" title={t('finance.pendingReturns', { count: summary.pending_returns })} className="profile-section" />}

      {summary && (
        <div className="ledger-summary profile-headline">
          {isSupplier ? (
            <>
              <Metric size="lg" label={t('profile.totalPurchases')} value={formatRwf(summary.invoiced)} hint={t('finance.invoicesCount', { count: statement.invoices.length })} />
              <Metric size="lg" label={t('finance.totalPaid')} value={formatRwf(summary.paid)} />
              <Metric size="lg" label={t('profile.outstandingPayables')} value={formatRwf(summary.owed)} tone={summary.owed > 0 ? 'danger' : undefined}
                hint={summary.overdue > 0 ? t('profile.ofWhichOverdue', { amount: formatRwf(summary.overdue) }) : undefined} />
              <Metric size="lg" label={t('profile.returnsCredits')} value={formatRwf(summary.returns + summary.credit)} hint={summary.credit > 0 ? t('profile.creditAvailable', { amount: formatRwf(summary.credit) }) : undefined} />
            </>
          ) : (
            <>
              <Metric size="lg" label={t('profile.lifetimePurchases')} value={f ? formatRwf(f.lifetime_purchases) : '…'} hint={f ? t('profile.inclTill', { amount: formatRwf(f.till_purchases) }) : undefined} />
              <Metric size="lg" label={t('finance.totalPaid')} value={formatRwf(summary.paid)} hint={t('finance.ofInvoiced', { amount: formatRwf(summary.invoiced) })} />
              <Metric size="lg" label={t('profile.outstanding')} value={formatRwf(summary.owed)} tone={summary.owed > 0 ? 'danger' : undefined}
                hint={summary.credit > 0 ? t('profile.creditAvailable', { amount: formatRwf(summary.credit) }) : undefined} />
              <Metric size="lg" label={t('finance.overdue')} value={formatRwf(summary.overdue)} tone={summary.overdue > 0 ? 'danger' : undefined}
                hint={summary.overdue_count ? t('finance.invoicesCount', { count: summary.overdue_count }) : undefined} />
            </>
          )}
        </div>
      )}

      <Tabs label={t('profile.tabsLabel')} value={tab} onChange={setTab} items={tabs} className="page-tabs" />

      {['insights', 'products', 'performance'].includes(tab) && insights && (
        <PeriodPicker value={period} onChange={setPeriod} firstActivity={insights.period.first_activity} />
      )}

      {tab === 'overview' && <ProfileOverview kind={kind} party={party} statement={statement} insights={insights} onOpen={openInvoice} onChanged={reload} />}
      {tab === 'invoices' && <InvoicesTab kind={kind} invoices={party.deliveries || party.orders} tillSales={party.till_sales} onOpen={openInvoice} />}
      {tab === 'payments' && statement && <PaymentsTab kind={kind} party={party} statement={statement} behaviour={insights?.behaviour} onOpen={openInvoice} />}
      {tab === 'returns' && statement && <ReturnsTab kind={kind} statement={statement} onOpen={openInvoice} />}
      {tab === 'insights' && (insights ? <CustomerInsights insights={insights} /> : <SkeletonPanel lines={8} />)}
      {tab === 'products' && (insights ? <SupplierProducts insights={insights} /> : <SkeletonPanel lines={8} />)}
      {tab === 'performance' && (insights ? <SupplierPerformance insights={insights} /> : <SkeletonPanel lines={8} />)}
      {tab === 'notes' && <NotesTab kind={kind} party={party} canWrite={noteWriters.some((p) => hasPermission(p))} />}
      {tab === 'activity' && <ActivityTab kind={kind} party={party} onOpen={openInvoice} />}

      {dialog?.type === 'edit' && (
        <PartyFormDialog kind={kind} party={party} onClose={() => setDialog(null)}
          onSaved={(p) => { setDialog(null); toast.success(t('profile.saved', { name: p.name })); reload(); }} />
      )}
      {dialog?.type === 'record' && (
        <LineItemsDialog kind={kind} partyId={party.id} onClose={() => setDialog(null)}
          onRecorded={() => { setDialog(null); toast.success(t(`${cfg.ns}.recorded`)); reload(); }} />
      )}
      {dialog?.type === 'payAccount' && (
        <AccountPaymentDialog kind={kind} partyId={party.id} invoices={statement.invoices} owed={summary.owed} onClose={() => setDialog(null)}
          onDone={(data) => { setDialog(null); toast.success(t('finance.payAccountRecorded', { amount: formatRwf(data.amount), count: data.allocations.length })); reload(); }} />
      )}
      {dialog?.type === 'invoice' && <InvoiceDetail kind={kind} invoiceId={dialog.id} onClose={() => setDialog(null)} onChanged={reload} />}
    </div>
  );
}

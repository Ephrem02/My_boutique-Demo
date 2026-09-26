import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, Truck, Building2, Wallet, PackageMinus, RotateCcw, AlertTriangle, SlidersHorizontal } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Panel, Metric, DescriptionList, ErrorState, SkeletonPanel, StatusBadge, EmptyState, Tabs } from '../ui/display';
import DataTable from '../ui/DataTable';
import Button from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { useToast } from '../ui/Toast';
import { formatRwf, formatDate, formatWhen } from '../ui/format';
import { InvoiceDetail } from '../components/parties';
import { PaymentsReport, ReturnsReport } from '../components/finance/Reports';

const iso = (d) => d.toISOString().slice(0, 10);
function rangeFor(period) {
  const now = new Date();
  if (period === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  if (period === '30d') return { from: iso(new Date(now.getTime() - 29 * 86400000)), to: iso(now) };
  if (period === 'year') return { from: `${now.getFullYear()}-01-01`, to: iso(now) };
  return {};
}

function ApprovalLimit() {
  const { t } = useTranslation();
  const toast = useToast();
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    client.get('/finance/settings').then(({ data }) => setValue(String(data.customer_return_approval_rwf))).catch(setError);
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { data } = await client.put('/finance/settings', { customer_return_approval_rwf: Number(value) });
      setValue(String(data.customer_return_approval_rwf));
      toast.success(t('finance.settingsSaved'));
    } catch (err) {
      setError(err);
    }
    setSaving(false);
  }

  return (
    <Panel title={t('finance.settingsTitle')} icon={SlidersHorizontal}>
      {error && <ErrorState error={error} />}
      <form onSubmit={save} className="stack">
        <Field label={t('finance.approvalLimit')} hint={t('finance.approvalLimitHint')}>
          <Input type="number" inputMode="numeric" min="0" step="1" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div><Button type="submit" variant="primary" loading={saving} loadingText={t('common.saving')}>{t('common.save')}</Button></div>
      </form>
    </Panel>
  );
}

/** /finance - payables, receivables, returns and money by method (store managers). */
export default function Finance() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [period, setPeriod] = useState('month');
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [pendingReturns, setPendingReturns] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null); // { kind, id }
  const canApprove = hasPermission('customer_returns.approve');

  const load = useCallback(async () => {
    try {
      const [overview, returnsRes] = await Promise.all([
        client.get('/finance/overview', { params: rangeFor(period) }),
        canApprove ? client.get('/finance/customer/returns', { params: { status: 'pending' } }) : Promise.resolve(null),
      ]);
      setData(overview.data);
      setPendingReturns(returnsRes?.data || []);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [period, canApprove]);

  useEffect(() => {
    load();
  }, [load]);

  const methodLabel = (m) => t(`paymentMethods.${m}`, { defaultValue: m });
  const methodRows = data ? data.by_method.methods.map((m) => ({
    id: m,
    method: methodLabel(m),
    pos_sales: data.by_method.pos_sales[m] || 0,
    customer_payments: data.by_method.customer_payments[m] || 0,
    customer_refunds: data.by_method.customer_refunds[m] || 0,
    supplier_payments: data.by_method.supplier_payments[m] || 0,
    supplier_refunds: data.by_method.supplier_refunds[m] || 0,
  })) : null;
  const money = (key) => ({ key, align: 'right', sortable: true, render: (r) => formatRwf(r[key]) });
  const overdueColumns = [
    { key: 'party_name', header: t('common.name'), sortable: true, mobile: 'title' },
    { key: 'invoice_id', header: t('finance.invoice'), mobile: 'subtitle', render: (r) => `#${r.invoice_id}` },
    { key: 'due_date', header: t('finance.dueDate'), sortable: true, mobile: 'meta', render: (r) => formatDate(r.due_date) },
    { key: 'days_overdue', header: t('finance.daysOverdue'), align: 'right', sortable: true, mobile: 'meta', render: (r) => <StatusBadge tone="danger">{t('finance.days', { count: r.days_overdue })}</StatusBadge> },
    { key: 'balance', header: t('finance.balance'), align: 'right', sortable: true, mobile: 'value', render: (r) => formatRwf(r.balance) },
  ];
  const topList = (rows, emptyText) => (rows.length ? (
    <DescriptionList items={rows.map((r) => ({ label: r.invoices ? `${r.party_name} · ${t('finance.invoicesCount', { count: r.invoices })}` : r.party_name, value: formatRwf(r.amount) }))} />
  ) : <p className="text-secondary">{emptyText}</p>);
  const reasonList = (rows) => (rows.length ? (
    <DescriptionList items={rows.map((r) => ({ label: `${t(`finance.reasons.${r.reason}`)} · ${t('finance.returnsCount', { count: r.count })}`, value: formatRwf(r.value) }))} />
  ) : <p className="text-secondary">{t('finance.noReturns')}</p>);

  return (
    <div className="page">
      <PageHeader title={t('finance.title')} subtitle={t('finance.subtitle')}
        actions={(
          <Select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={t('finance.period')} className="filter-select">
            {['month', '30d', 'year', 'all'].map((p) => <option key={p} value={p}>{t(`finance.periods.${p}`)}</option>)}
          </Select>
        )} />

      <Tabs label={t('finance.sections')} value={tab} onChange={setTab} items={[
        { id: 'overview', label: t('finance.tabs.overview') },
        { id: 'payments', label: t('finance.tabs.payments') },
        { id: 'returns', label: t('finance.tabs.returns') },
      ]} />
      {tab === 'payments' && <PaymentsReport range={rangeFor(period)} onOpenInvoice={(kind, id) => setOpen({ kind, id })} />}
      {tab === 'returns' && <ReturnsReport range={rangeFor(period)} onOpenInvoice={(kind, id) => setOpen({ kind, id })} />}

      {tab === 'overview' && error && <ErrorState error={error} onRetry={load} />}
      {tab === 'overview' && !data && !error && <div className="dashboard-grid"><SkeletonPanel lines={6} /><SkeletonPanel lines={6} /></div>}
      {tab === 'overview' && data && (
        <div className="stack">
          <div className="finance-grid">
            <Panel title={t('finance.payablesTitle')} subtitle={t('finance.payablesSubtitle')} icon={Truck}>
              <Metric size="lg" label={t('finance.outstanding')} value={formatRwf(data.payables.outstanding)}
                hint={t('finance.openInvoices', { count: data.payables.open_invoices })} tone={data.payables.outstanding > 0 ? 'danger' : undefined} />
              <DescriptionList items={[
                { label: t('finance.totalPurchases'), value: formatRwf(data.payables.purchases) },
                { label: t('finance.paid'), value: formatRwf(data.payables.paid) },
                { label: t('finance.supplierReturns'), value: formatRwf(data.payables.returns) },
                { label: t('finance.refundsReceived'), value: formatRwf(data.payables.refunds_received) },
                { label: t('finance.overdue'), value: formatRwf(data.payables.overdue), tone: data.payables.overdue > 0 ? 'danger' : undefined },
                { label: t('finance.supplier.credit'), value: formatRwf(data.payables.credit) },
                data.payables.disputed_returns > 0 && { label: t('finance.disputedReturns'), value: String(data.payables.disputed_returns), tone: 'warning' },
              ]} />
            </Panel>
            <Panel title={t('finance.receivablesTitle')} subtitle={t('finance.receivablesSubtitle')} icon={Building2}>
              <Metric size="lg" label={t('finance.outstanding')} value={formatRwf(data.receivables.outstanding)}
                hint={t('finance.openInvoices', { count: data.receivables.open_invoices })} tone={data.receivables.outstanding > 0 ? 'warning' : undefined} />
              <DescriptionList items={[
                { label: t('finance.totalCreditSales'), value: formatRwf(data.receivables.credit_sales) },
                data.receivables.discounts > 0 && { label: t('finance.discountsGiven'), value: formatRwf(data.receivables.discounts) },
                { label: t('finance.customerPayments'), value: formatRwf(data.receivables.payments) },
                { label: t('finance.customerReturns'), value: formatRwf(data.receivables.returns) },
                { label: t('finance.refundsPaid'), value: formatRwf(data.receivables.refunds_paid) },
                { label: t('finance.overdue'), value: formatRwf(data.receivables.overdue), tone: data.receivables.overdue > 0 ? 'danger' : undefined },
                { label: t('finance.customer.credit'), value: formatRwf(data.receivables.credit) },
              ]} />
            </Panel>
          </div>

          {canApprove && pendingReturns?.length > 0 && (
            <Panel title={t('finance.pendingReturnsTitle')} icon={PackageMinus} className="opening-request">
              <DataTable caption={t('finance.pendingReturnsTitle')} rows={pendingReturns}
                onRowClick={(r) => setOpen({ kind: 'institution', id: r.order_id })}
                rowLabel={(r) => t('finance.openInvoiceNamed', { id: r.order_id })}
                columns={[
                  { key: 'customer_name', header: t('common.name'), mobile: 'title' },
                  { key: 'order_id', header: t('finance.invoice'), mobile: 'subtitle', render: (r) => `#${r.order_id}` },
                  { key: 'reason', header: t('finance.returnReason'), mobile: 'meta', render: (r) => t(`finance.reasons.${r.reason}`) },
                  { key: 'requested_by_name', header: t('finance.recordedBy') },
                  { key: 'total_value', header: t('finance.returnValue'), align: 'right', mobile: 'value', render: (r) => formatRwf(r.total_value) },
                ]} />
            </Panel>
          )}

          <Panel title={t('finance.byMethodTitle')} subtitle={t('finance.byMethodSubtitle')} icon={Wallet}>
            <DataTable caption={t('finance.byMethodTitle')} rows={methodRows} columns={[
              { key: 'method', header: t('payment.method'), mobile: 'title' },
              { ...money('pos_sales'), header: t('finance.tillSales') },
              { ...money('customer_payments'), header: t('finance.customerPayments'), mobile: 'value' },
              { ...money('customer_refunds'), header: t('finance.refundsPaid') },
              { ...money('supplier_payments'), header: t('finance.supplierPayments') },
              { ...money('supplier_refunds'), header: t('finance.refundsReceived') },
            ]} />
          </Panel>

          <div className="finance-grid">
            <Panel title={t('finance.overdueSuppliers')} icon={AlertTriangle}>
              {data.overdue.supplier.length === 0 ? <EmptyState compact icon={Landmark} title={t('finance.nothingOverdue')} /> : (
                <DataTable caption={t('finance.overdueSuppliers')} rows={data.overdue.supplier} columns={overdueColumns}
                  onRowClick={(r) => setOpen({ kind: 'supplier', id: r.invoice_id })} rowLabel={(r) => t('finance.openInvoiceNamed', { id: r.invoice_id })} />
              )}
            </Panel>
            <Panel title={t('finance.overdueCustomers')} icon={AlertTriangle}>
              {data.overdue.customer.length === 0 ? <EmptyState compact icon={Landmark} title={t('finance.nothingOverdue')} /> : (
                <DataTable caption={t('finance.overdueCustomers')} rows={data.overdue.customer} columns={overdueColumns}
                  onRowClick={(r) => setOpen({ kind: 'institution', id: r.invoice_id })} rowLabel={(r) => t('finance.openInvoiceNamed', { id: r.invoice_id })} />
              )}
            </Panel>
          </div>

          <div className="finance-grid">
            <Panel title={t('finance.whoOwesUs')}>{topList(data.top.customers_owing, t('finance.nobodyOwes'))}</Panel>
            <Panel title={t('finance.whoWeOwe')}>{topList(data.top.suppliers_owed, t('finance.weOweNobody'))}</Panel>
            <Panel title={t('finance.topCreditCustomers')}>{topList(data.top.credit_customers, t('finance.noCreditSales'))}</Panel>
            <Panel title={t('finance.customersWithCredit')}>{topList(data.top.customers_with_credit, t('finance.noCustomerCredit'))}</Panel>
          </div>

          <div className="finance-grid">
            <Panel title={t('finance.supplierReturnsByReason')} icon={PackageMinus}>{reasonList(data.returns_by_reason.supplier)}</Panel>
            <Panel title={t('finance.customerReturnsByReason')} icon={PackageMinus}>{reasonList(data.returns_by_reason.customer)}</Panel>
            <Panel title={t('finance.returnsCostTitle')} subtitle={t('finance.returnsCostHint')} icon={PackageMinus}>
              <Metric size="lg" label={t('finance.returnsCostTotal')} value={formatRwf(data.returns_cost.total)} tone={data.returns_cost.total > 0 ? 'danger' : undefined} />
              <DescriptionList items={[
                { label: t('finance.refundsPaid'), value: formatRwf(data.returns_cost.account_refunds) },
                { label: t('finance.tillRefunds'), value: formatRwf(data.returns_cost.till_refunds) },
                { label: t('finance.writtenOffCost'), value: formatRwf(data.returns_cost.written_off_cost) },
              ]} />
            </Panel>
          </div>

          <Panel title={t('finance.recentReversals')} subtitle={t('finance.recentReversalsHint')} icon={RotateCcw}>
            {data.recent_reversals.length === 0 ? <p className="text-secondary">{t('finance.noReversals')}</p> : (
              <DescriptionList items={data.recent_reversals.map((r) => ({
                label: `${formatWhen(r.created_at, t)} · ${r.by} · ${t(r.side === 'supplier' ? 'finance.purchaseInvoiceTitle' : 'finance.salesInvoiceTitle', { id: r.invoice_id })} · ${r.note}`,
                value: formatRwf(r.amount),
              }))} />
            )}
          </Panel>

          {hasPermission('settings.manage') && <ApprovalLimit />}
        </div>
      )}

      {open && <InvoiceDetail kind={open.kind} invoiceId={open.id} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

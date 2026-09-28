import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Printer, FileText, PackageMinus } from 'lucide-react';
import DataTable from '../../ui/DataTable';
import Button from '../../ui/Button';
import { Field, Input, Select } from '../../ui/Field';
import { DescriptionList, EmptyState, Metric, Panel, StatusBadge } from '../../ui/display';
import { formatRwf, formatDate } from '../../ui/format';
import { useToast } from '../../ui/Toast';
import { downloadCsv } from '../finance/Reports';
import { ACCOUNT_METHODS, INVOICE_TONE, RETURN_STATUS_TONE, SUPPLIER_RESPONSE_TONE } from '../finance/constants';
import { KIND, financeUrl } from '../parties';
import StatementPrint from './StatementPrint';

const dateOnly = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const entryLabel = (t, kind, e) => (e.kind === 'refund'
  ? t(kind === 'supplier' ? 'finance.entry.supplierRefund' : 'finance.entry.customerRefund')
  : t(`finance.entry.${e.kind}`));

/* ---------------- Sales invoices / purchase invoices ---------------- */

export function InvoicesTab({ kind, invoices, tillSales, onOpen }) {
  const { t } = useTranslation();
  const isSupplier = kind === 'supplier';
  const [status, setStatus] = useState('');
  const rows = useMemo(() => (invoices || []).filter((i) => !status || (status === 'overdue' ? i.overdue : i.status === status)), [invoices, status]);

  const columns = [
    { key: 'id', header: isSupplier ? t('profile.deliveryNo') : t('profile.invoiceNo'), sortable: true, mobile: 'title', render: (i) => `#${i.id}`, searchValue: (i) => `#${i.id} ${i.reference_no || ''}` },
    { key: 'invoice_date', header: isSupplier ? t('delivery.deliveryDate') : t('order.orderDate'), sortable: true, mobile: 'subtitle', render: (i) => formatDate(i.invoice_date), sortValue: (i) => dateOnly(i.invoice_date) },
    isSupplier && { key: 'reference_no', header: t('finance.supplierReference'), render: (i) => i.reference_no || '—' },
    { key: 'due_date', header: t('finance.dueDate'), sortable: true, render: (i) => (i.due_date ? formatDate(i.due_date) : '—'), sortValue: (i) => dateOnly(i.due_date) },
    { key: 'total_amount', header: t('common.total'), align: 'right', sortable: true, render: (i) => formatRwf(i.total_amount) },
    { key: 'amount_paid', header: t('finance.paid'), align: 'right', render: (i) => formatRwf(i.amount_paid) },
    {
      key: 'balance', header: t('finance.balance'), align: 'right', sortable: true, mobile: 'value',
      render: (i) => <span className={i.balance > 0 ? 'text-danger' : i.balance < 0 ? 'text-info' : undefined}>{formatRwf(i.balance)}</span>,
    },
    {
      key: 'status', header: t('common.status'), mobile: 'meta',
      render: (i) => (
        <span className="record-card-badges">
          <StatusBadge tone={INVOICE_TONE[i.status]}>{t(`badges.${i.status}`)}</StatusBadge>
          {i.overdue && <StatusBadge tone="danger">{t('finance.overdue')}</StatusBadge>}
          {!isSupplier && i.delivery_status === 'pending' && <StatusBadge tone="neutral">{t('badges.pendingDelivery')}</StatusBadge>}
        </span>
      ),
    },
  ].filter(Boolean);

  return (
    <>
      <DataTable
        caption={isSupplier ? t('profile.tabs.purchases') : t('profile.tabs.sales')}
        columns={columns}
        rows={rows}
        searchable
        searchPlaceholder={t('profile.searchInvoices')}
        initialSort={{ key: 'invoice_date', dir: 'desc' }}
        onRowClick={(i) => onOpen(i.id)}
        rowLabel={(i) => t('finance.openInvoiceNamed', { id: i.id })}
        toolbar={(
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')} className="filter-select">
            <option value="">{t('profile.allStatuses')}</option>
            {['unpaid', 'partial', 'paid', 'credit'].map((st) => <option key={st} value={st}>{t(`badges.${st}`)}</option>)}
            <option value="overdue">{t('finance.overdue')}</option>
          </Select>
        )}
        empty={{ icon: FileText, title: t(`${KIND[kind].ns}.noRecords`), description: t(`${KIND[kind].ns}.noRecordsHint`) }}
      />
      {!isSupplier && tillSales && tillSales.length > 0 && (
        <Panel title={t('finance.tillPurchases')} subtitle={t('profile.tillPurchasesHint')} className="profile-section">
          <DataTable
            caption={t('finance.tillPurchases')}
            columns={[
              { key: 'id', header: t('salesHistory.saleNo'), mobile: 'title', render: (x) => <>#{x.id}{x.status === 'voided' && <> <StatusBadge tone="neutral">{t('badges.voided')}</StatusBadge></>}</> },
              { key: 'created_at', header: t('common.date'), sortable: true, mobile: 'subtitle', render: (x) => formatDate(x.created_at) },
              { key: 'payment_method', header: t('payment.method'), render: (x) => t(`paymentMethods.${x.payment_method}`, { defaultValue: x.payment_method }) },
              { key: 'cashier_name', header: t('finance.soldBy') },
              { key: 'total_amount', header: t('common.total'), align: 'right', mobile: 'value', sortable: true, render: (x) => formatRwf(x.total_amount) },
            ]}
            rows={tillSales}
            initialSort={{ key: 'created_at', dir: 'desc' }}
            pageSize={10}
          />
        </Panel>
      )}
    </>
  );
}

/* ---------------- Payments, instalments and the statement ---------------- */

export function PaymentsTab({ kind, party, statement, behaviour, onOpen }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [type, setType] = useState('');
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const entries = statement.entries;

  const rows = useMemo(() => entries.filter((e) => (!type || e.kind === type)
    && (!method || e.method === method)
    && (!from || dateOnly(e.date) >= from)
    && (!to || dateOnly(e.date) <= to)), [entries, type, method, from, to]);
  const kinds = [...new Set(entries.map((e) => e.kind))];
  const open = (statement.invoices || []).filter((i) => i.balance > 0);

  async function csv() {
    setDownloading(true);
    try {
      await downloadCsv(financeUrl(kind, `/parties/${party.id}/statement`), {}, `statement-${party.name.replace(/[^\w-]+/g, '-').toLowerCase()}`);
    } catch (err) {
      toast.error(t('profile.exportFailed'));
    } finally {
      setDownloading(false);
    }
  }

  const columns = [
    { key: 'date', header: t('common.date'), mobile: 'subtitle', render: (e) => formatDate(e.date) },
    {
      key: 'kind', header: t('finance.entryType'), mobile: 'title',
      render: (e) => (
        <>
          {entryLabel(t, kind, e)} · #{e.invoice_id}
          {e.reason && <span className="text-muted"> · {t(`finance.reasons.${e.reason}`)}</span>}
          {e.reversed && <> <StatusBadge tone="neutral">{t('finance.reversed')}</StatusBadge></>}
        </>
      ),
      searchValue: (e) => `${entryLabel(t, kind, e)} #${e.invoice_id} ${e.reference_no || ''} ${e.note || ''}`,
    },
    { key: 'method', header: t('payment.method'), render: (e) => (e.method ? t(`paymentMethods.${e.method}`, { defaultValue: e.method }) : '—') },
    { key: 'reference_no', header: t('finance.referenceNo'), render: (e) => e.reference_no || '—' },
    { key: 'recorded_by_name', header: t('finance.recordedBy'), render: (e) => e.recorded_by_name || '—' },
    { key: 'effect', header: t('finance.change'), align: 'right', mobile: 'value', render: (e) => (e.effect ? formatRwf(e.effect, { signed: true }) : '—') },
    { key: 'balance', header: t('finance.runningBalance'), align: 'right', render: (e) => formatRwf(e.balance) },
  ];

  return (
    <>
      {behaviour && (
        <div className="ledger-summary">
          <Metric label={t('profile.instalments')} value={behaviour.instalments} hint={t('profile.paidInInstalments', { count: behaviour.paid_in_instalments })} />
          <Metric label={t('profile.openInvoices')} value={behaviour.open_invoices} hint={behaviour.largest_outstanding ? t('profile.largestOutstanding', { id: behaviour.largest_outstanding.id, amount: formatRwf(behaviour.largest_outstanding.balance) }) : undefined} />
          <Metric label={t('profile.nextDue')} value={behaviour.next_due ? formatDate(behaviour.next_due.due_date) : '—'}
            hint={behaviour.next_due ? t('profile.nextDueHint', { id: behaviour.next_due.id, amount: formatRwf(behaviour.next_due.balance) }) : undefined} />
          <Metric label={t('finance.overdue')} value={behaviour.overdue_invoices.length} tone={behaviour.overdue_invoices.length ? 'danger' : undefined}
            hint={behaviour.overdue_invoices[0] ? t('profile.oldestOverdue', { days: behaviour.overdue_invoices[0].days_overdue }) : undefined} />
        </div>
      )}

      {open.length > 0 && (
        <Panel title={t('profile.outstandingTitle')} subtitle={t('profile.outstandingHint')} className="profile-section">
          <DataTable
            caption={t('profile.outstandingTitle')}
            columns={[
              { key: 'id', header: t('profile.invoiceNo'), mobile: 'title', render: (i) => `#${i.id}` },
              { key: 'invoice_date', header: t('common.date'), mobile: 'subtitle', render: (i) => formatDate(i.invoice_date) },
              { key: 'due_date', header: t('finance.dueDate'), render: (i) => (i.due_date ? formatDate(i.due_date) : '—') },
              { key: 'overdue', header: t('common.status'), mobile: 'meta', render: (i) => (i.overdue ? <StatusBadge tone="danger">{t('finance.overdue')}</StatusBadge> : <StatusBadge tone={INVOICE_TONE[i.status]}>{t(`badges.${i.status}`)}</StatusBadge>) },
              { key: 'balance', header: t('receipts.balanceDue'), align: 'right', mobile: 'value', render: (i) => <span className="text-danger">{formatRwf(i.balance)}</span> },
            ]}
            rows={[...open].sort((a, b) => dateOnly(a.invoice_date).localeCompare(dateOnly(b.invoice_date)))}
            onRowClick={(i) => onOpen(i.id)}
            rowLabel={(i) => t('finance.openInvoiceNamed', { id: i.id })}
            pageSize={10}
          />
        </Panel>
      )}

      <Panel
        title={t('finance.statement')}
        subtitle={t('profile.statementHint')}
        className="profile-section"
        padded={false}
        actions={(
          <>
            <Button icon={Printer} onClick={() => setPrinting(true)} disabled={!entries.length}>{t('profile.printStatement')}</Button>
            <Button icon={Download} onClick={csv} loading={downloading} disabled={!entries.length}>{t('finance.exportCsv')}</Button>
          </>
        )}
      >
        <DataTable
          caption={t('finance.statement')}
          columns={columns}
          rows={rows}
          rowKey="id"
          searchable
          searchPlaceholder={t('profile.searchStatement')}
          toolbar={(
            <div className="filters">
              <Select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('finance.entryType')} className="filter-select">
                <option value="">{t('profile.allEntries')}</option>
                {kinds.map((k) => <option key={k} value={k}>{entryLabel(t, kind, { kind: k })}</option>)}
              </Select>
              <Select value={method} onChange={(e) => setMethod(e.target.value)} aria-label={t('payment.method')} className="filter-select">
                <option value="">{t('profile.allMethods')}</option>
                {ACCOUNT_METHODS.map((m) => <option key={m} value={m}>{t(`paymentMethods.${m}`)}</option>)}
              </Select>
              <Field label={t('profile.from')} inline><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label={t('profile.to')} inline><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
          )}
          empty={{ icon: FileText, title: t('finance.noTransactions') }}
          rowClassName={(e) => (e.reversed ? 'txn-reversed' : undefined)}
          onRowClick={(e) => onOpen(e.invoice_id)}
          rowLabel={(e) => t('finance.openInvoiceNamed', { id: e.invoice_id })}
        />
      </Panel>

      {printing && <StatementPrint kind={kind} party={party} statement={statement} from={from} to={to} onClose={() => setPrinting(false)} />}
    </>
  );
}

/* ---------------- Returns, refunds and credits ---------------- */

export function ReturnsTab({ kind, statement, onOpen }) {
  const { t } = useTranslation();
  const isSupplier = kind === 'supplier';
  const returns = statement.returns || [];
  const refunds = statement.entries.filter((e) => e.kind === 'refund' && !e.reversed);
  const credits = statement.entries.filter((e) => e.kind === 'credit_applied' && !e.reversed);
  const approved = returns.filter((r) => isSupplier || r.status === 'approved');

  if (!returns.length && !refunds.length && !credits.length) {
    return <EmptyState icon={PackageMinus} title={t('finance.noReturns')} description={t('profile.noReturnsHint')} />;
  }
  return (
    <>
      <div className="ledger-summary">
        <Metric label={t('finance.returns')} value={formatRwf(approved.reduce((s, r) => s + r.total_value, 0))} hint={t('profile.returnsCount', { count: approved.length })} />
        <Metric label={isSupplier ? t('finance.refundsReceived') : t('finance.refundsPaid')} value={formatRwf(refunds.reduce((s, e) => s + e.amount, 0))} hint={t('profile.entriesCount', { count: refunds.length })} />
        <Metric label={t('finance.creditApplied')} value={formatRwf(credits.reduce((s, e) => s + e.amount, 0))} hint={t('profile.entriesCount', { count: credits.length })} />
        {!isSupplier && <Metric label={t('profile.pendingApproval')} value={returns.filter((r) => r.status === 'pending').length} tone={returns.some((r) => r.status === 'pending') ? 'warning' : undefined} />}
      </div>
      <DataTable
        caption={t('finance.returns')}
        columns={[
          { key: 'id', header: t('profile.returnNo'), mobile: 'title', render: (r) => `#${r.id} · ${t('profile.onInvoice', { id: r.invoice_id })}`, searchValue: (r) => `#${r.id} #${r.invoice_id}` },
          { key: 'return_date', header: t('common.date'), sortable: true, mobile: 'subtitle', render: (r) => formatDate(r.return_date), sortValue: (r) => dateOnly(r.return_date) },
          {
            key: 'items', header: t('delivery.items'),
            render: (r) => r.items.map((i) => `${i.quantity} × ${i.product_name}${i.restock === false ? ` (${t('finance.writtenOff')})` : ''}`).join(', '),
            searchValue: (r) => r.items.map((i) => i.product_name).join(' '),
          },
          { key: 'reason', header: t('finance.returnReason'), render: (r) => t(`finance.reasons.${r.reason}`), searchValue: (r) => t(`finance.reasons.${r.reason}`) },
          {
            key: 'status', header: t('common.status'), mobile: 'meta',
            render: (r) => (isSupplier
              ? <StatusBadge tone={SUPPLIER_RESPONSE_TONE[r.supplier_response]}>{t(`finance.supplierResponse.${r.supplier_response}`)}</StatusBadge>
              : <StatusBadge tone={RETURN_STATUS_TONE[r.status]}>{t(`finance.returnStatus.${r.status}`)}</StatusBadge>),
          },
          { key: 'recorded_by_name', header: t('finance.recordedBy') },
          { key: 'total_value', header: t('finance.returnValue'), align: 'right', mobile: 'value', sortable: true, render: (r) => formatRwf(r.total_value) },
        ]}
        rows={returns}
        searchable
        searchPlaceholder={t('profile.searchReturns')}
        initialSort={{ key: 'return_date', dir: 'desc' }}
        onRowClick={(r) => onOpen(r.invoice_id)}
        rowLabel={(r) => t('finance.openInvoiceNamed', { id: r.invoice_id })}
      />
      {(refunds.length > 0 || credits.length > 0) && (
        <Panel title={t('profile.refundsAndCredits')} className="profile-section">
          <DescriptionList items={[...refunds, ...credits].map((e) => ({
            label: `${formatDate(e.date)} · ${entryLabel(t, kind, e)} · #${e.invoice_id}${e.method ? ` · ${t(`paymentMethods.${e.method}`, { defaultValue: e.method })}` : ''}`,
            value: formatRwf(e.amount),
          }))} />
        </Panel>
      )}
    </>
  );
}

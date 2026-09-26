import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import client from '../../api/client';
import DataTable from '../../ui/DataTable';
import Button from '../../ui/Button';
import { Select } from '../../ui/Field';
import { Metric, StatusBadge } from '../../ui/display';
import { formatRwf, formatDate } from '../../ui/format';
import { ACCOUNT_METHODS, SUPPLIER_RETURN_REASONS, CUSTOMER_RETURN_REASONS } from './constants';

const REASONS = [...new Set([...SUPPLIER_RETURN_REASONS, ...CUSTOMER_RETURN_REASONS])];

/** Downloads a report as CSV (same filters as on screen). */
async function downloadCsv(path, params, name) {
  const { data } = await client.get(path, { params: { ...params, format: 'csv' }, responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function useParties(side) {
  const [parties, setParties] = useState([]);
  useEffect(() => {
    setParties([]);
    if (side !== 'supplier' && side !== 'customer') return;
    client.get(side === 'supplier' ? '/suppliers' : '/institutions').then(({ data }) => setParties(data)).catch(() => setParties([]));
  }, [side]);
  return parties;
}

function useReport(path, params) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const key = JSON.stringify(params);
  const load = useCallback(async () => {
    setData(null);
    try {
      setData((await client.get(path, { params })).data);
      setError(null);
    } catch (err) {
      setError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, load };
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null));

/**
 * Every payment, refund, credit move and reversal in the period, filterable:
 * "how much did we pay supplier X this month", "what came in through MTN".
 */
export function PaymentsReport({ range, onOpenInvoice }) {
  const { t } = useTranslation();
  const [side, setSide] = useState('all');
  const [partyId, setPartyId] = useState('');
  const [method, setMethod] = useState('');
  const [type, setType] = useState('');
  const [downloading, setDownloading] = useState(false);
  const parties = useParties(side);
  const params = clean({ ...range, side, party_id: side === 'all' ? '' : partyId, method, type });
  const { data, error, load } = useReport('/finance/reports/payments', params);

  const columns = [
    { key: 'txn_date', header: t('common.date'), sortable: true, mobile: 'meta', render: (r) => formatDate(r.txn_date) },
    { key: 'party_name', header: t('finance.party'), sortable: true, mobile: 'title' },
    {
      key: 'type', header: t('finance.entryType'), mobile: 'subtitle',
      render: (r) => (
        <>
          {r.type === 'refund' ? t(r.side === 'supplier' ? 'finance.entry.supplierRefund' : 'finance.entry.customerRefund') : t(`finance.entry.${r.type}`)}
          {' · '}{t(`finance.ledger.${r.side}`)} #{r.invoice_id}
          {r.reversed && <> <StatusBadge tone="neutral">{t('finance.reversed')}</StatusBadge></>}
        </>
      ),
    },
    { key: 'method', header: t('payment.method'), sortable: true, render: (r) => (r.method ? t(`paymentMethods.${r.method}`, { defaultValue: r.method }) : '—') },
    { key: 'reference_no', header: t('finance.referenceNo'), render: (r) => r.reference_no || '—' },
    { key: 'recorded_by', header: t('finance.recordedBy'), sortable: true },
    { key: 'amount', header: t('payment.amount'), align: 'right', sortable: true, mobile: 'value', render: (r) => <span className={r.reversed ? 'text-muted' : undefined}>{formatRwf(r.amount)}</span> },
  ];

  async function csv() {
    setDownloading(true);
    try {
      await downloadCsv('/finance/reports/payments', params, 'payments');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="stack">
      <div className="report-filters">
        <Select value={side} onChange={(e) => { setSide(e.target.value); setPartyId(''); }} aria-label={t('finance.ledgerFilter')} className="filter-select">
          <option value="all">{t('finance.ledger.all')}</option>
          <option value="supplier">{t('finance.ledger.supplier')}</option>
          <option value="customer">{t('finance.ledger.customer')}</option>
        </Select>
        {side !== 'all' && (
          <Select value={partyId} onChange={(e) => setPartyId(e.target.value)} aria-label={t('finance.party')} className="filter-select">
            <option value="">{side === 'supplier' ? t('finance.allSuppliers') : t('finance.allCustomers')}</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
        <Select value={method} onChange={(e) => setMethod(e.target.value)} aria-label={t('payment.method')} className="filter-select">
          <option value="">{t('finance.allMethods')}</option>
          {ACCOUNT_METHODS.map((m) => <option key={m} value={m}>{t(`paymentMethods.${m}`)}</option>)}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('finance.entryType')} className="filter-select">
          <option value="">{t('finance.allEntries')}</option>
          {['payment', 'refund', 'credit_applied', 'reversal'].map((x) => <option key={x} value={x}>{t(`finance.entry.${x}`)}</option>)}
        </Select>
        <Button icon={Download} onClick={csv} loading={downloading} disabled={!data?.rows.length}>{t('finance.exportCsv')}</Button>
      </div>
      {data && (
        <div className="ledger-summary">
          {side !== 'customer' && <Metric label={t('finance.supplierPayments')} value={formatRwf(data.totals.supplier_payments)} />}
          {side !== 'customer' && <Metric label={t('finance.refundsReceived')} value={formatRwf(data.totals.supplier_refunds)} />}
          {side !== 'supplier' && <Metric label={t('finance.customerPayments')} value={formatRwf(data.totals.customer_payments)} />}
          {side !== 'supplier' && <Metric label={t('finance.refundsPaid')} value={formatRwf(data.totals.customer_refunds)} />}
        </div>
      )}
      <DataTable caption={t('finance.paymentsReport')} columns={columns} rows={data?.rows} loading={!data && !error} error={error} onRetry={load}
        searchable searchPlaceholder={t('finance.searchPayments')} initialSort={{ key: 'txn_date', dir: 'desc' }}
        onRowClick={(r) => onOpenInvoice(r.side === 'supplier' ? 'supplier' : 'institution', r.invoice_id)}
        rowLabel={(r) => t('finance.openInvoiceNamed', { id: r.invoice_id })}
        empty={{ title: t('finance.noPaymentsFound'), description: t('finance.noPaymentsFoundHint') }} />
    </div>
  );
}

/** Every returned product line: to suppliers, from customers and at the till - with reasons and cost. */
export function ReturnsReport({ range, onOpenInvoice }) {
  const { t } = useTranslation();
  const [side, setSide] = useState('all');
  const [reason, setReason] = useState('');
  const [downloading, setDownloading] = useState(false);
  const params = clean({ ...range, side, reason });
  const { data, error, load } = useReport('/finance/reports/returns', params);

  const columns = [
    { key: 'date', header: t('common.date'), sortable: true, mobile: 'meta', render: (r) => formatDate(r.date) },
    { key: 'product_name', header: t('common.product'), sortable: true, mobile: 'title', render: (r) => <>{r.product_name}<div className="text-muted">{r.sku}</div></> },
    {
      key: 'side', header: t('finance.returnSource'), sortable: true, mobile: 'subtitle',
      render: (r) => `${t(`finance.returnSide.${r.side}`)}${r.party_name ? ` · ${r.party_name}` : ''}`,
    },
    { key: 'quantity', header: t('delivery.qty'), align: 'right', sortable: true },
    { key: 'reason', header: t('finance.returnReason'), sortable: true, mobile: 'meta', render: (r) => (r.reason ? t(`finance.reasons.${r.reason}`) : '—') },
    {
      key: 'status', header: t('common.status'), mobile: 'meta',
      render: (r) => (
        <span className="badge-group">
          {r.side === 'supplier' && <StatusBadge tone="neutral">{t(`finance.supplierResponse.${r.status}`)}</StatusBadge>}
          {r.side === 'customer' && <StatusBadge tone="neutral">{t(`finance.returnStatus.${r.status}`)}</StatusBadge>}
          {r.written_off && <StatusBadge tone="danger">{t('finance.writtenOff')}</StatusBadge>}
        </span>
      ),
    },
    { key: 'value', header: t('finance.returnValue'), align: 'right', sortable: true, mobile: 'value', render: (r) => formatRwf(r.value) },
  ];

  async function csv() {
    setDownloading(true);
    try {
      await downloadCsv('/finance/reports/returns', params, 'returns');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="stack">
      <div className="report-filters">
        <Select value={side} onChange={(e) => setSide(e.target.value)} aria-label={t('finance.returnSource')} className="filter-select">
          {['all', 'supplier', 'customer', 'till'].map((x) => <option key={x} value={x}>{t(`finance.returnSide.${x}`)}</option>)}
        </Select>
        <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('finance.returnReason')} className="filter-select">
          <option value="">{t('finance.allReasons')}</option>
          {REASONS.map((r) => <option key={r} value={r}>{t(`finance.reasons.${r}`)}</option>)}
        </Select>
        <Button icon={Download} onClick={csv} loading={downloading} disabled={!data?.rows.length}>{t('finance.exportCsv')}</Button>
      </div>
      {data && (
        <div className="ledger-summary">
          <Metric label={t('finance.supplierReturns')} value={formatRwf(data.totals.supplier_value)} />
          <Metric label={t('finance.customerReturns')} value={formatRwf(data.totals.customer_value)} />
          <Metric label={t('finance.tillReturns')} value={formatRwf(data.totals.till_value)} />
          <Metric label={t('finance.writtenOffCost')} value={formatRwf(data.totals.written_off_cost)} tone={data.totals.written_off_cost > 0 ? 'danger' : undefined} />
        </div>
      )}
      <DataTable caption={t('finance.returnsReport')} columns={columns} rows={data?.rows} loading={!data && !error} error={error} onRetry={load}
        searchable searchPlaceholder={t('finance.searchReturns')} initialSort={{ key: 'date', dir: 'desc' }}
        onRowClick={(r) => (r.side === 'till' ? null : onOpenInvoice(r.side === 'supplier' ? 'supplier' : 'institution', r.invoice_id))}
        rowLabel={(r) => t('finance.openInvoiceNamed', { id: r.invoice_id })}
        empty={{ title: t('finance.noReturns'), description: t('finance.noReturnsFoundHint') }} />
    </div>
  );
}

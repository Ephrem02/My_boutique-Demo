import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText, Plus, Trash2, Truck, ClipboardList, Phone, Mail, UserRound, CheckCheck, Wallet, Undo2, ArrowLeftRight, RotateCcw, PackageMinus, BookOpen,
} from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import Dialog from '../ui/Dialog';
import Button, { IconButton } from '../ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '../ui/Field';
import { Alert, DescriptionList, EmptyState, ErrorState, Metric, SkeletonPanel, StatusBadge, Tabs } from '../ui/display';
import { useToast } from '../ui/Toast';
import { formatRwf, formatDate } from '../ui/format';
import ReceiptModal from './ReceiptModal';
import { ReasonDialog } from './businessDay/Dialogs';
import {
  ACCOUNT_METHODS, SUPPLIER_RETURN_REASONS, CUSTOMER_RETURN_REASONS, INVOICE_TONE, RETURN_STATUS_TONE, SUPPLIER_RESPONSE_TONE, todayIso,
} from './finance/constants';

// Suppliers and customers (institutions) share one set of components; KIND
// holds everything that differs. Both are ledgers: invoices, then payments,
// returns, refunds, credits and reversals - never an edited "paid" field.
export const CLIENT_TYPES = ['shop', 'school', 'individual', 'company', 'other'];
export const PAYMENT_TONE = INVOICE_TONE;

export const KIND = {
  supplier: {
    side: 'supplier',
    ns: 'suppliers',
    endpoint: '/suppliers',
    recordsEndpoint: '/supplier-deliveries',
    receiptType: 'supplier-delivery',
    manage: 'suppliers.manage',
    recordManage: 'supplier_deliveries.manage',
    payManage: 'supplier_payments.manage',
    moneyView: 'supplier_payments.view',
    returnsManage: 'supplier_returns.manage',
    unpaidView: 'supplier_payments.view',
    unpaidEndpoint: '/supplier-deliveries/unpaid-summary',
    unpaidKey: 'supplier_id',
    unpaidName: 'supplier_name',
    reasons: SUPPLIER_RETURN_REASONS,
    recordIcon: Truck,
  },
  institution: {
    side: 'customer',
    ns: 'institutions',
    endpoint: '/institutions',
    recordsEndpoint: '/institution-orders',
    receiptType: 'institution-order',
    manage: 'institutions.manage',
    recordManage: 'institution_orders.manage',
    payManage: 'institution_payments.manage',
    moneyView: 'institution_payments.view',
    returnsManage: 'customer_returns.manage',
    unpaidView: 'institution_payments.view',
    unpaidEndpoint: '/institution-orders/unpaid-summary',
    unpaidKey: 'institution_id',
    unpaidName: 'institution_name',
    reasons: CUSTOMER_RETURN_REASONS,
    recordIcon: ClipboardList,
  },
};

const financeUrl = (kind, path) => `/finance/${KIND[kind].side}${path}`;
const signed = (v) => formatRwf(v, { signed: true });

/* ---------------- Create supplier / customer ---------------- */

export function PartyFormDialog({ kind, onClose, onCreated }) {
  const { t } = useTranslation();
  const cfg = KIND[kind];
  const [form, setForm] = useState(kind === 'supplier'
    ? { name: '', contact_phone: '', contact_email: '', address: '', payment_terms: '' }
    : { name: '', type: 'shop', contact_person: '', contact_phone: '', address: '', payment_terms: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const { data } = await client.post(cfg.endpoint, form);
      onCreated(data);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Dialog title={t(`${cfg.ns}.newTitle`)} onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.saving')}>{t(`${cfg.ns}.add`)}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      <Field label={t('common.name')} required><Input value={form.name} onChange={set('name')} required autoFocus /></Field>
      {kind === 'institution' && (
        <div className="form-row">
          <Field label={t('institutions.type')}>
            <Select value={form.type} onChange={set('type')}>
              {CLIENT_TYPES.map((ct) => <option key={ct} value={ct}>{t(`institutions.types.${ct}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('institutions.contactPerson')}><Input value={form.contact_person} onChange={set('contact_person')} /></Field>
        </div>
      )}
      <div className="form-row">
        <Field label={t('suppliers.contactPhone')}><Input type="tel" value={form.contact_phone} onChange={set('contact_phone')} /></Field>
        {kind === 'supplier' && <Field label={t('suppliers.contactEmail')}><Input type="email" value={form.contact_email} onChange={set('contact_email')} /></Field>}
      </div>
      <Field label={t('suppliers.address')}><Input value={form.address} onChange={set('address')} /></Field>
      <Field label={t('common.paymentTerms')} hint={t('suppliers.paymentTermsPlaceholder')}><Input value={form.payment_terms} onChange={set('payment_terms')} /></Field>
    </Dialog>
  );
}

/* ---------------- Money fields (method + reference) ---------------- */

function MoneyFields({ amount, setAmount, method, setMethod, reference, setReference, amountLabel, hint, autoFocus = false }) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={amountLabel || t('payment.amountRwf')} required hint={hint}>
        <Input type="number" inputMode="numeric" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus={autoFocus} />
      </Field>
      <div className="form-row">
        <Field label={t('payment.method')} required hint={method === 'cash' ? t('finance.cashTillHint') : undefined}>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {ACCOUNT_METHODS.map((m) => <option key={m} value={m}>{t(`paymentMethods.${m}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('finance.referenceNo')} hint={t('finance.referenceHint')}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
        </Field>
      </div>
    </>
  );
}

/* ---------------- New purchase invoice (goods received) / sales invoice ---------------- */

export function LineItemsDialog({ kind, partyId, onClose, onRecorded }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const cfg = KIND[kind];
  const isDelivery = kind === 'supplier';
  const priceKey = isDelivery ? 'unit_cost' : 'unit_price';
  const emptyLine = () => ({ product_id: '', quantity: '', [priceKey]: '', batch_no: '', expiry_date: '' });
  const [products, setProducts] = useState([]);
  const [mainDate, setMainDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [reference, setReference] = useState('');
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [payNow, setPayNow] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payRef, setPayRef] = useState('');
  const [error, setError] = useState(null);
  const [linesError, setLinesError] = useState('');
  const [loading, setLoading] = useState(false);
  const canPay = hasPermission(cfg.payManage);

  useEffect(() => {
    client.get('/products').then(({ data }) => setProducts(data)).catch(setError);
  }, []);

  const updateLine = (index, field, value) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  const subtotal = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l[priceKey]) || 0), 0);
  const total = Math.max(0, subtotal - (Number(discount) || 0));

  async function submit() {
    const items = lines
      .filter((l) => l.product_id && l.quantity && l[priceKey] !== '')
      .map((l) => ({
        product_id: Number(l.product_id), quantity: Number(l.quantity), [priceKey]: Number(l[priceKey]),
        ...(isDelivery && { batch_no: l.batch_no || undefined, expiry_date: l.expiry_date || undefined }),
      }));
    if (!items.length) {
      setLinesError(t('common.atLeastOneLineItem'));
      return;
    }
    setLinesError('');
    setError(null);
    setLoading(true);
    const payment = payNow ? { amount: Number(payAmount || total), method: payMethod, reference_no: payRef || undefined } : undefined;
    try {
      const body = isDelivery
        ? { supplier_id: partyId, delivery_date: mainDate, payment_due_date: dueDate || null, reference_no: reference || undefined, notes: notes || undefined, items, payment }
        : {
          institution_id: partyId, order_date: mainDate, delivery_date: deliveryDate || null, due_date: dueDate || null,
          discount_amount: Number(discount) || 0, notes: notes || undefined, items, payment,
        };
      const { data } = await client.post(cfg.recordsEndpoint, body);
      onRecorded(data);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Dialog title={isDelivery ? t('delivery.title') : t('finance.newSale')} description={isDelivery ? t('delivery.hint') : t('finance.newSaleHint')}
      size="lg" onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <div className="dialog-footer-total"><span>{t('common.total')}</span><strong className="num">{formatRwf(total)}</strong></div>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.recording')}>
            {isDelivery ? t('delivery.recordDelivery') : t('finance.recordSale')}
          </Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      <div className="form-row">
        <Field label={isDelivery ? t('delivery.deliveryDate') : t('order.orderDate')} required>
          <Input type="date" value={mainDate} onChange={(e) => setMainDate(e.target.value)} required />
        </Field>
        <Field label={isDelivery ? t('delivery.paymentDueOptional') : t('finance.dueDateOptional')}>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        {isDelivery ? (
          <Field label={t('finance.supplierReference')} hint={t('finance.supplierReferenceHint')}>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
          </Field>
        ) : (
          <Field label={t('order.deliveryDateOptional')}>
            <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </Field>
        )}
      </div>

      <div className="form-section-title">{t('delivery.items')}</div>
      {linesError && <p className="field-error" role="alert">{linesError}</p>}
      <ol className="line-editor">
        {lines.map((line, i) => (
          <li key={i} className="line-editor-row">
            <Field label={t('common.product')} className="line-editor-product">
              <Select value={line.product_id} onChange={(e) => updateLine(i, 'product_id', e.target.value)}>
                <option value="">{t('common.selectProduct')}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label={t('delivery.qty')}>
              <Input type="number" inputMode="numeric" min="1" value={line.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)} />
            </Field>
            <Field label={isDelivery ? t('delivery.unitCostRwf') : t('order.unitPriceRwf')}>
              <Input type="number" inputMode="numeric" min="0" value={line[priceKey]} onChange={(e) => updateLine(i, priceKey, e.target.value)} />
            </Field>
            <IconButton icon={Trash2} label={t('delivery.removeLine', { n: i + 1 })} disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="line-editor-remove" />
            {isDelivery && (
              <div className="form-row line-editor-meta">
                <Field label={t('finance.batchNo')}><Input value={line.batch_no} onChange={(e) => updateLine(i, 'batch_no', e.target.value)} maxLength={100} /></Field>
                <Field label={t('finance.expiryDate')}><Input type="date" value={line.expiry_date} onChange={(e) => updateLine(i, 'expiry_date', e.target.value)} /></Field>
              </div>
            )}
          </li>
        ))}
      </ol>
      <Button variant="ghost" icon={Plus} onClick={() => setLines((ls) => [...ls, emptyLine()])}>{t('delivery.addAnotherItem')}</Button>

      {!isDelivery && (
        <Field label={t('finance.discountRwf')} hint={t('finance.discountHint')}>
          <Input type="number" inputMode="numeric" min="0" step="1" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </Field>
      )}
      <Field label={t('finance.notes')}><Textarea maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>

      {canPay ? (
        <>
          <Checkbox label={isDelivery ? t('finance.paidOnReceipt') : t('finance.paidAtSale')} description={t('finance.paidNowHint')}
            checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />
          {payNow && (
            <MoneyFields amount={payAmount === '' ? String(total || '') : payAmount} setAmount={setPayAmount} method={payMethod} setMethod={setPayMethod}
              reference={payRef} setReference={setPayRef} amountLabel={t('finance.amountPaidNow')} />
          )}
        </>
      ) : (
        isDelivery && <p className="field-hint">{t('finance.onCreditHint')}</p>
      )}
    </Dialog>
  );
}

/* ---------------- Payment / refund ---------------- */

function MoneyDialog({ kind, invoice, mode, onClose, onDone }) {
  const { t } = useTranslation();
  const isRefund = mode === 'refund';
  const limit = isRefund ? -invoice.balance : invoice.balance;
  const [amount, setAmount] = useState(limit > 0 ? String(limit) : '');
  const [method, setMethod] = useState(kind === 'supplier' && !isRefund ? 'bank_transfer' : 'cash');
  const [reference, setReference] = useState('');
  const [txnDate, setTxnDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      await client.post(financeUrl(kind, `/invoices/${invoice.id}/${isRefund ? 'refunds' : 'payments'}`), {
        amount: Number(amount), method, reference_no: reference || undefined, txn_date: txnDate, note: note || undefined,
      });
      onDone(Number(amount));
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  const refundTitle = kind === 'supplier' ? t('finance.supplierRefundTitle') : t('finance.customerRefundTitle');
  return (
    <Dialog title={isRefund ? refundTitle : t('payment.title')}
      description={isRefund ? t('finance.creditAvailable', { amount: formatRwf(limit) }) : t('payment.balanceOwed', { amount: formatRwf(Math.max(0, limit)) })}
      size="sm" onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.recording')}>
            {isRefund ? t('finance.recordRefund') : t('payment.recordPayment')}
          </Button>
        </>
      )}
    >
      {error && <ErrorState error={error} action={t('errors.actions.payment')} />}
      <MoneyFields amount={amount} setAmount={setAmount} method={method} setMethod={setMethod} reference={reference} setReference={setReference} autoFocus
        hint={!isRefund && Number(amount) > limit ? t('payment.overpaymentWarning') : undefined} />
      <div className="form-row">
        <Field label={isRefund ? t('finance.dateOfRefund') : t('payment.datePaid')} required>
          <Input type="date" value={txnDate} max={todayIso()} onChange={(e) => setTxnDate(e.target.value)} required />
        </Field>
        <Field label={t('finance.notes')}><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
      </div>
    </Dialog>
  );
}

/* ---------------- Apply credit from another invoice ---------------- */

function CreditDialog({ kind, invoice, sources, onClose, onDone }) {
  const { t } = useTranslation();
  const [sourceId, setSourceId] = useState(String(sources[0]?.id || ''));
  const source = sources.find((s) => String(s.id) === sourceId);
  const max = source ? Math.min(-source.balance, invoice.balance) : 0;
  const [amount, setAmount] = useState(String(max || ''));
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      await client.post(financeUrl(kind, `/invoices/${invoice.id}/credits`), { source_invoice_id: Number(sourceId), amount: Number(amount) });
      onDone(Number(amount));
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Dialog title={t('finance.applyCreditTitle')} description={t('finance.applyCreditHint', { amount: formatRwf(invoice.balance) })} size="sm" onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.saving')}>{t('finance.applyCredit')}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      <Field label={t('finance.creditFrom')} required>
        <Select value={sourceId} onChange={(e) => { setSourceId(e.target.value); const s = sources.find((x) => String(x.id) === e.target.value); setAmount(String(s ? Math.min(-s.balance, invoice.balance) : '')); }}>
          {sources.map((s) => <option key={s.id} value={s.id}>{t('finance.invoiceCredit', { id: s.id, amount: formatRwf(-s.balance) })}</option>)}
        </Select>
      </Field>
      <Field label={t('payment.amountRwf')} required hint={t('finance.atMost', { amount: formatRwf(max) })}>
        <Input type="number" inputMode="numeric" min="1" step="1" max={max} value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </Field>
    </Dialog>
  );
}

/* ---------------- Return goods ---------------- */

function ReturnDialog({ kind, invoice, onClose, onDone }) {
  const { t } = useTranslation();
  const cfg = KIND[kind];
  const isSupplier = kind === 'supplier';
  const lines = invoice.items.filter((i) => i.returnable_quantity > 0);
  const [qty, setQty] = useState({});
  const [restock, setRestock] = useState({});
  const [reason, setReason] = useState(cfg.reasons[0]);
  const [notes, setNotes] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [refundRef, setRefundRef] = useState('');
  const [error, setError] = useState(null);
  const [linesError, setLinesError] = useState('');
  const [loading, setLoading] = useState(false);

  const price = (line) => Number(isSupplier ? line.unit_cost : line.unit_price);
  const factor = !isSupplier && invoice.subtotal > 0 ? invoice.total_amount / invoice.subtotal : 1; // spreads the invoice discount
  const value = lines.reduce((sum, l) => sum + (Number(qty[l.id]) || 0) * price(l) * factor, 0);

  async function submit() {
    const items = lines
      .filter((l) => Number(qty[l.id]) > 0)
      .map((l) => ({ item_id: l.id, quantity: Number(qty[l.id]), ...(!isSupplier && { restock: restock[l.id] !== false }) }));
    if (!items.length) {
      setLinesError(t('finance.chooseReturnItems'));
      return;
    }
    setLinesError('');
    setError(null);
    setLoading(true);
    try {
      const { data } = await client.post(financeUrl(kind, `/invoices/${invoice.id}/returns`), {
        items, reason, notes: notes || undefined,
        ...(!isSupplier && Number(refundAmount) > 0 && { refund: { amount: Number(refundAmount), method: refundMethod, reference_no: refundRef || undefined } }),
      });
      onDone(data);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Dialog title={isSupplier ? t('finance.returnToSupplier') : t('finance.customerReturn')}
      description={isSupplier ? t('finance.returnToSupplierHint') : t('finance.customerReturnHint')} size="lg" onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <div className="dialog-footer-total"><span>{t('finance.returnValue')}</span><strong className="num">{formatRwf(value)}</strong></div>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.recording')}>{t('finance.recordReturn')}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      {linesError && <p className="field-error" role="alert">{linesError}</p>}
      <ul className="return-lines">
        {lines.map((l) => (
          <li key={l.id} className="return-line">
            <div className="return-line-product">
              <strong>{l.product_name}</strong>
              <span className="text-secondary"> · {formatRwf(price(l))} · {t('finance.canReturn', { count: l.returnable_quantity })}</span>
            </div>
            <Field label={t('finance.quantityToReturn', { name: l.product_name })}>
              <Input type="number" inputMode="numeric" min="0" max={l.returnable_quantity} step="1" value={qty[l.id] ?? ''}
                onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} />
            </Field>
            {!isSupplier && (
              <Checkbox label={t('finance.backInStock')} checked={restock[l.id] !== false}
                onChange={(e) => setRestock((r) => ({ ...r, [l.id]: e.target.checked }))} />
            )}
          </li>
        ))}
      </ul>
      <div className="form-row">
        <Field label={t('finance.returnReason')} required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {cfg.reasons.map((r) => <option key={r} value={r}>{t(`finance.reasons.${r}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('finance.notes')}><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
      </div>
      {isSupplier ? (
        <p className="field-hint">{t('finance.supplierReturnEffect')}</p>
      ) : (
        <>
          <div className="form-section-title">{t('finance.refundNow')}</div>
          <p className="field-hint">{t('finance.refundNowHint', { paid: formatRwf(invoice.amount_paid) })}</p>
          <MoneyFields amount={refundAmount} setAmount={setRefundAmount} method={refundMethod} setMethod={setRefundMethod}
            reference={refundRef} setReference={setRefundRef} amountLabel={t('finance.refundAmountOptional')} />
          <p className="field-hint">{t('finance.approvalHint')}</p>
        </>
      )}
    </Dialog>
  );
}

/* ---------------- Invoice detail: lines, balance breakdown, full history ---------------- */

const TXN_LABEL = (t, kind, txn, invoiceId) => {
  if (txn.type === 'credit_applied') {
    return txn.invoice_id === invoiceId ? t('finance.creditFromInvoice', { id: txn.source_invoice_id }) : t('finance.creditToInvoice', { id: txn.invoice_id });
  }
  if (txn.type === 'refund') return kind === 'supplier' ? t('finance.entry.supplierRefund') : t('finance.entry.customerRefund');
  return t(`finance.entry.${txn.type}`);
};

export function InvoiceDetail({ kind, invoiceId, onClose, onChanged }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission, user } = useAuth();
  const cfg = KIND[kind];
  const isSupplier = kind === 'supplier';
  const [invoice, setInvoice] = useState(null);
  const [siblings, setSiblings] = useState([]);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(financeUrl(kind, `/invoices/${invoiceId}`));
      setInvoice(data);
      if (hasPermission('ledger.manage')) {
        const { data: list } = await client.get(financeUrl(kind, '/invoices'), { params: { party_id: data.party_id ?? data[isSupplier ? 'supplier_id' : 'institution_id'] } });
        setSiblings(list);
      }
      setError(null);
    } catch (err) {
      setError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = (message) => {
    setDialog(null);
    if (message) toast.success(message);
    load();
    onChanged?.();
  };

  async function markDelivered() {
    try {
      await client.post(`/institution-orders/${invoice.id}/deliver`);
      changed(t('institutions.markedDelivered', { id: invoice.id }));
    } catch (err) {
      setError(err);
    }
  }

  const canManageLedger = hasPermission('ledger.manage');
  const creditSources = siblings.filter((s) => s.id !== invoice?.id && s.balance < 0);
  const canReturn = invoice && hasPermission(cfg.returnsManage) && invoice.items.some((i) => i.returnable_quantity > 0);

  const footer = invoice && (
    <>
      <Button variant="ghost" icon={FileText} onClick={() => setDialog({ type: 'receipt' })}>{t('receipts.viewReceipt')}</Button>
      {!isSupplier && invoice.delivery_status === 'pending' && hasPermission('institution_orders.manage') && (
        <Button icon={CheckCheck} onClick={markDelivered}>{t('institutions.markDelivered')}</Button>
      )}
      {canReturn && <Button icon={PackageMinus} onClick={() => setDialog({ type: 'return' })}>{t('finance.recordReturn')}</Button>}
      {canManageLedger && invoice.balance > 0 && creditSources.length > 0 && (
        <Button icon={ArrowLeftRight} onClick={() => setDialog({ type: 'credit' })}>{t('finance.applyCredit')}</Button>
      )}
      {canManageLedger && invoice.balance < 0 && (
        <Button icon={Undo2} onClick={() => setDialog({ type: 'refund' })}>{t('finance.recordRefund')}</Button>
      )}
      {hasPermission(cfg.payManage) && invoice.balance > 0 && (
        <Button variant="primary" icon={Wallet} onClick={() => setDialog({ type: 'pay' })}>{t('payment.recordPayment')}</Button>
      )}
    </>
  );

  return (
    <Dialog title={invoice ? t(isSupplier ? 'finance.purchaseInvoiceTitle' : 'finance.salesInvoiceTitle', { id: invoice.id }) : t('common.loading')}
      description={invoice?.party_name} size="lg" onClose={onClose} footer={footer}>
      {error && <ErrorState error={error} onRetry={load} />}
      {!invoice && !error && <SkeletonPanel lines={8} />}
      {invoice && (
        <>
          <div className="record-card-badges">
            <StatusBadge tone={INVOICE_TONE[invoice.status]}>{t(`badges.${invoice.status}`)}</StatusBadge>
            {invoice.overdue && <StatusBadge tone="danger">{t('finance.overdue')}</StatusBadge>}
            {!isSupplier && (
              <StatusBadge tone={invoice.delivery_status === 'delivered' ? 'success' : 'neutral'}>
                {invoice.delivery_status === 'delivered' ? t('badges.delivered') : t('badges.pendingDelivery')}
              </StatusBadge>
            )}
          </div>

          <div className="invoice-columns">
            <DescriptionList items={[
              { label: isSupplier ? t('delivery.deliveryDate') : t('order.orderDate'), value: formatDate(invoice.invoice_date) },
              { label: t('finance.dueDate'), value: invoice.due_date ? formatDate(invoice.due_date) : '—' },
              isSupplier && { label: t('finance.supplierReference'), value: invoice.reference_no || '—' },
              isSupplier ? { label: t('finance.receivedBy'), value: invoice.received_by_name || '—' } : { label: t('finance.soldBy'), value: invoice.recorded_by_name || '—' },
              invoice.notes && { label: t('finance.notes'), value: invoice.notes },
            ]} />
            <DescriptionList items={[
              !isSupplier && invoice.discount_amount > 0 && { label: t('finance.subtotal'), value: formatRwf(invoice.subtotal) },
              !isSupplier && invoice.discount_amount > 0 && { label: t('finance.discount'), value: formatRwf(-invoice.discount_amount) },
              { label: t('finance.invoiceTotal'), value: formatRwf(invoice.total_amount) },
              invoice.returns_total > 0 && { label: t('finance.returns'), value: formatRwf(-invoice.returns_total) },
              { label: t('finance.paid'), value: formatRwf(-invoice.amount_paid) },
              invoice.credit_applied > 0 && { label: t('finance.creditApplied'), value: formatRwf(-invoice.credit_applied) },
              invoice.refunds_total > 0 && { label: isSupplier ? t('finance.refundsReceived') : t('finance.refundsPaid'), value: formatRwf(invoice.refunds_total) },
              invoice.credit_given > 0 && { label: t('finance.creditMovedOut'), value: formatRwf(invoice.credit_given) },
              {
                label: invoice.balance < 0 ? t('finance.creditBalance') : t('finance.balance'),
                value: formatRwf(Math.abs(invoice.balance)), strong: true, tone: invoice.balance > 0 ? 'danger' : invoice.balance < 0 ? 'info' : 'success',
              },
            ]} />
          </div>

          <h3 className="subheading">{t('delivery.items')}</h3>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('delivery.items')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('common.product')}</th>
                  <th scope="col" className="align-right">{t('delivery.qty')}</th>
                  <th scope="col" className="align-right">{isSupplier ? t('finance.unitCost') : t('finance.unitPrice')}</th>
                  {isSupplier && <th scope="col">{t('finance.batchNo')}</th>}
                  {isSupplier && <th scope="col">{t('finance.expiryDate')}</th>}
                  <th scope="col" className="align-right">{t('finance.returned')}</th>
                  <th scope="col" className="align-right">{t('common.total')}</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.product_name}<div className="text-muted">{i.sku}</div></td>
                    <td className="align-right num">{i.quantity}</td>
                    <td className="align-right num">{formatRwf(isSupplier ? i.unit_cost : i.unit_price)}</td>
                    {isSupplier && <td>{i.batch_no || '—'}</td>}
                    {isSupplier && <td>{i.expiry_date ? formatDate(i.expiry_date) : '—'}</td>}
                    <td className="align-right num">{i.returned_quantity || '—'}</td>
                    <td className="align-right num">{formatRwf(i.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="subheading">{t('finance.moneyHistory')}</h3>
          {invoice.transactions.length === 0 ? (
            <p className="text-secondary">{t('finance.noTransactions')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">{t('finance.moneyHistory')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('common.date')}</th>
                    <th scope="col">{t('finance.entryType')}</th>
                    <th scope="col">{t('payment.method')}</th>
                    <th scope="col">{t('finance.referenceNo')}</th>
                    <th scope="col">{t('finance.recordedBy')}</th>
                    <th scope="col" className="align-right">{t('payment.amount')}</th>
                    {canManageLedger && <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {invoice.transactions.map((x) => (
                    <tr key={x.id} className={x.reversed_by ? 'txn-reversed' : undefined}>
                      <td>{formatDate(x.txn_date)}</td>
                      <td>
                        {TXN_LABEL(t, kind, x, invoice.id)}
                        {x.reversed_by && <div><StatusBadge tone="neutral">{t('finance.reversed')}</StatusBadge> <span className="text-muted">{x.reversal_reason}</span></div>}
                        {x.type === 'reversal' && x.note && <div className="text-muted">{x.note}</div>}
                      </td>
                      <td>{x.method ? t(`paymentMethods.${x.method}`, { defaultValue: x.method }) : '—'}</td>
                      <td>{x.reference_no || '—'}</td>
                      <td>{x.recorded_by_name}</td>
                      <td className="align-right num">{formatRwf(x.amount)}</td>
                      {canManageLedger && (
                        <td className="align-right">
                          {x.type !== 'reversal' && !x.reversed_by && (
                            <IconButton icon={RotateCcw} size="sm" label={t('finance.reverseNamed', { type: TXN_LABEL(t, kind, x, invoice.id), amount: formatRwf(x.amount) })}
                              onClick={() => setDialog({ type: 'reverse', txn: x })} />
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="subheading">{t('finance.returns')}</h3>
          {invoice.returns.length === 0 ? (
            <p className="text-secondary">{t('finance.noReturns')}</p>
          ) : (
            <ul className="record-list">
              {invoice.returns.map((r) => (
                <li key={r.id} className="record-card">
                  <div className="record-card-top">
                    <span className="record-card-title">#{r.id} · {formatDate(r.return_date)} · {t(`finance.reasons.${r.reason}`)}</span>
                    <span className="record-card-badges">
                      {isSupplier
                        ? <StatusBadge tone={SUPPLIER_RESPONSE_TONE[r.supplier_response]}>{t(`finance.supplierResponse.${r.supplier_response}`)}</StatusBadge>
                        : <StatusBadge tone={RETURN_STATUS_TONE[r.status]}>{t(`finance.returnStatus.${r.status}`)}</StatusBadge>}
                    </span>
                  </div>
                  <div className="record-card-amounts num">
                    <span>{t('finance.returnValue')}: <strong>{formatRwf(r.total_value)}</strong></span>
                    {r.refund_amount > 0 && <span>{t('finance.refunded')}: {formatRwf(r.refund_amount)} ({t(`paymentMethods.${r.refund_method}`)})</span>}
                    <span>{t('finance.recordedBy')}: {r.recorded_by_name}</span>
                  </div>
                  <p className="text-secondary">{r.items.map((i) => `${i.quantity} × ${i.product_name}${i.restock === false ? ` (${t('finance.writtenOff')})` : ''}`).join(', ')}</p>
                  {r.notes && <p className="text-secondary">{r.notes}</p>}
                  {(r.decision_note || r.response_note) && <p className="text-secondary">{r.decided_by_name || r.responded_by_name}: {r.decision_note || r.response_note}</p>}
                  <div className="record-card-actions">
                    {isSupplier && canManageLedger && r.supplier_response === 'pending' && (
                      <>
                        <Button size="sm" onClick={() => setDialog({ type: 'response', ret: r, response: 'accepted' })}>{t('finance.supplierAccepted')}</Button>
                        <Button size="sm" onClick={() => setDialog({ type: 'response', ret: r, response: 'disputed' })}>{t('finance.supplierDisputed')}</Button>
                      </>
                    )}
                    {!isSupplier && r.status === 'pending' && hasPermission('customer_returns.approve') && r.requested_by !== user?.id && (
                      <>
                        <Button size="sm" variant="primary" onClick={() => setDialog({ type: 'decide', ret: r, decision: 'approve' })}>{t('finance.approveReturn')}</Button>
                        <Button size="sm" onClick={() => setDialog({ type: 'decide', ret: r, decision: 'reject' })}>{t('finance.rejectReturn')}</Button>
                      </>
                    )}
                    {!isSupplier && r.status === 'pending' && r.requested_by === user?.id && <span className="field-hint">{t('finance.waitingForManager')}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {dialog?.type === 'pay' && (
        <MoneyDialog kind={kind} invoice={invoice} mode="payment" onClose={() => setDialog(null)}
          onDone={(amount) => changed(t('payment.recorded', { amount: formatRwf(amount) }))} />
      )}
      {dialog?.type === 'refund' && (
        <MoneyDialog kind={kind} invoice={invoice} mode="refund" onClose={() => setDialog(null)}
          onDone={(amount) => changed(t('finance.refundRecorded', { amount: formatRwf(amount) }))} />
      )}
      {dialog?.type === 'credit' && (
        <CreditDialog kind={kind} invoice={invoice} sources={creditSources} onClose={() => setDialog(null)}
          onDone={(amount) => changed(t('finance.creditApplied_toast', { amount: formatRwf(amount) }))} />
      )}
      {dialog?.type === 'return' && (
        <ReturnDialog kind={kind} invoice={invoice} onClose={() => setDialog(null)}
          onDone={(data) => changed(data.pending_approval ? t('finance.returnPending') : t('finance.returnRecorded', { amount: formatRwf(data.return.total_value) }))} />
      )}
      {dialog?.type === 'reverse' && (
        <ReasonDialog title={t('finance.reverseTitle')} description={t('finance.reverseHint', { amount: formatRwf(dialog.txn.amount) })}
          label={t('businessDay.review.reason')} minLength={5} danger confirmLabel={t('finance.reverse')} onClose={() => setDialog(null)}
          onSubmit={async (reason) => { await client.post(financeUrl(kind, `/transactions/${dialog.txn.id}/reverse`), { reason }); changed(t('finance.reversedToast')); }} />
      )}
      {dialog?.type === 'response' && (
        <ReasonDialog title={t(`finance.supplierResponseTitle.${dialog.response}`)} label={t('businessDay.review.note')} required={false}
          confirmLabel={t('common.save')} onClose={() => setDialog(null)}
          onSubmit={async (note) => {
            await client.post(financeUrl(kind, `/returns/${dialog.ret.id}/response`), { response: dialog.response, note: note || undefined });
            changed(t('finance.responseSaved'));
          }} />
      )}
      {dialog?.type === 'decide' && (
        <ReasonDialog title={t(dialog.decision === 'approve' ? 'finance.approveReturnTitle' : 'finance.rejectReturnTitle')}
          description={t('finance.decideReturnHint', { amount: formatRwf(dialog.ret.total_value) })}
          label={dialog.decision === 'approve' ? t('businessDay.review.note') : t('businessDay.review.reason')}
          required={dialog.decision === 'reject'} minLength={dialog.decision === 'reject' ? 3 : 0} danger={dialog.decision === 'reject'}
          confirmLabel={dialog.decision === 'approve' ? t('finance.approveReturn') : t('finance.rejectReturn')} onClose={() => setDialog(null)}
          onSubmit={async (note) => {
            await client.post(financeUrl(kind, `/returns/${dialog.ret.id}/decision`), { decision: dialog.decision, note: note || undefined });
            changed(dialog.decision === 'approve' ? t('finance.returnApproved') : t('finance.returnRejected'));
          }} />
      )}
      {dialog?.type === 'receipt' && <ReceiptModal type={cfg.receiptType} id={invoice.id} onClose={() => setDialog(null)} />}
    </Dialog>
  );
}

/* ---------------- Account: summary, invoices and statement ---------------- */

export function PartyDetail({ kind, id, onClose }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const cfg = KIND[kind];
  const [party, setParty] = useState(null);
  const [statement, setStatement] = useState(null);
  const [tab, setTab] = useState('invoices');
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // { type: 'record' | 'invoice', id? }
  const canSeeMoney = hasPermission(cfg.moneyView);

  const load = useCallback(async () => {
    try {
      const [{ data: partyData }, statementRes] = await Promise.all([
        client.get(`${cfg.endpoint}/${id}`),
        canSeeMoney ? client.get(financeUrl(kind, `/parties/${id}/statement`)) : Promise.resolve(null),
      ]);
      setParty(partyData);
      setStatement(statementRes?.data || null);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [cfg, id, kind, canSeeMoney]);

  useEffect(() => {
    load();
  }, [load]);

  const invoices = party ? (party.deliveries || party.orders || []) : null;
  const summary = statement?.summary;
  const RecordIcon = cfg.recordIcon;
  return (
    <Dialog title={party?.name || t('common.loading')} description={party?.payment_terms || undefined} size="lg" onClose={onClose}
      footer={hasPermission(cfg.recordManage) ? (
        <Button variant="primary" icon={Plus} onClick={() => setDialog({ type: 'record' })}>{t(`${cfg.ns}.recordNew`)}</Button>
      ) : null}
    >
      {error && <ErrorState error={error} onRetry={load} />}
      {!party && !error && <SkeletonPanel lines={5} />}
      {party && (
        <ul className="contact-list">
          {kind === 'institution' && <li><StatusBadge tone="neutral" dot={false}>{t(`institutions.types.${party.type}`, { defaultValue: party.type })}</StatusBadge></li>}
          {party.contact_person && <li><UserRound aria-hidden="true" />{party.contact_person}</li>}
          {party.contact_phone && <li><Phone aria-hidden="true" /><a href={`tel:${party.contact_phone}`}>{party.contact_phone}</a></li>}
          {party.contact_email && <li><Mail aria-hidden="true" /><a href={`mailto:${party.contact_email}`}>{party.contact_email}</a></li>}
        </ul>
      )}

      {summary && (
        <>
          <div className="ledger-summary">
            <Metric label={t(`finance.${cfg.side}.owed`)} value={formatRwf(summary.owed)} tone={summary.owed > 0 ? 'danger' : undefined} />
            <Metric label={t('finance.overdue')} value={formatRwf(summary.overdue)} hint={summary.overdue_count ? t('finance.invoicesCount', { count: summary.overdue_count }) : undefined}
              tone={summary.overdue > 0 ? 'danger' : undefined} />
            <Metric label={t(`finance.${cfg.side}.credit`)} value={formatRwf(summary.credit)} />
            <Metric label={t('finance.totalPaid')} value={formatRwf(summary.paid)} hint={t('finance.ofInvoiced', { amount: formatRwf(summary.invoiced) })} />
          </div>
          {summary.pending_returns > 0 && <Alert tone="warning" title={t('finance.pendingReturns', { count: summary.pending_returns })} />}
          <Tabs label={t('finance.accountTabs')} value={tab} onChange={setTab} items={[
            { id: 'invoices', label: t(`${cfg.ns}.records`), count: invoices?.length },
            { id: 'statement', label: t('finance.statement') },
          ]} />
        </>
      )}
      {!summary && <h3 className="subheading">{t(`${cfg.ns}.records`)}</h3>}

      {(tab === 'invoices' || !summary) && invoices && invoices.length === 0 && (
        <EmptyState compact icon={RecordIcon} title={t(`${cfg.ns}.noRecords`)} description={t(`${cfg.ns}.noRecordsHint`)} />
      )}
      {(tab === 'invoices' || !summary) && invoices && invoices.length > 0 && (
        <ul className="record-list">
          {invoices.map((r) => (
            <li key={r.id} className="record-card">
              <div className="record-card-top">
                <span className="record-card-title">#{r.id} · {formatDate(r.invoice_date)}{r.reference_no ? ` · ${r.reference_no}` : ''}</span>
                <span className="record-card-badges">
                  <StatusBadge tone={INVOICE_TONE[r.status]}>{t(`badges.${r.status}`)}</StatusBadge>
                  {r.overdue && <StatusBadge tone="danger">{t('finance.overdue')}</StatusBadge>}
                  {kind === 'institution' && r.delivery_status === 'pending' && <StatusBadge tone="neutral">{t('badges.pendingDelivery')}</StatusBadge>}
                </span>
              </div>
              <div className="record-card-amounts num">
                <span>{t('common.total')}: <strong>{formatRwf(r.total_amount)}</strong></span>
                {r.returns_total > 0 && <span>{t('finance.returns')}: {formatRwf(r.returns_total)}</span>}
                <span>{t('finance.paid')}: {formatRwf(r.amount_paid)}</span>
                {r.balance > 0 && <span className="text-danger">{t('receipts.balanceDue')}: {formatRwf(r.balance)}</span>}
                {r.balance < 0 && <span className="text-info">{t('finance.creditBalance')}: {formatRwf(-r.balance)}</span>}
              </div>
              <div className="record-card-actions">
                <Button size="sm" icon={BookOpen} onClick={() => setDialog({ type: 'invoice', id: r.id })}>{t('finance.openInvoice')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {summary && tab === 'statement' && (
        statement.entries.length === 0 ? <p className="text-secondary">{t('finance.noTransactions')}</p> : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('finance.statement')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('common.date')}</th>
                  <th scope="col">{t('finance.entryType')}</th>
                  <th scope="col">{t('payment.method')}</th>
                  <th scope="col" className="align-right">{t('finance.change')}</th>
                  <th scope="col" className="align-right">{t('finance.runningBalance')}</th>
                </tr>
              </thead>
              <tbody>
                {statement.entries.map((e) => (
                  <tr key={e.id} className={e.reversed ? 'txn-reversed' : undefined}>
                    <td>{formatDate(e.date)}</td>
                    <td>
                      <button type="button" className="link-button" onClick={() => setDialog({ type: 'invoice', id: e.invoice_id })}>
                        {e.kind === 'refund' ? t(kind === 'supplier' ? 'finance.entry.supplierRefund' : 'finance.entry.customerRefund') : t(`finance.entry.${e.kind}`)} · #{e.invoice_id}
                      </button>
                      {e.reason && <span className="text-muted"> · {t(`finance.reasons.${e.reason}`)}</span>}
                    </td>
                    <td>{e.method ? t(`paymentMethods.${e.method}`, { defaultValue: e.method }) : '—'}</td>
                    <td className="align-right num">{e.effect ? signed(e.effect) : '—'}</td>
                    <td className="align-right num">{formatRwf(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {dialog?.type === 'record' && (
        <LineItemsDialog kind={kind} partyId={id} onClose={() => setDialog(null)}
          onRecorded={() => { setDialog(null); toast.success(t(`${cfg.ns}.recorded`)); load(); }} />
      )}
      {dialog?.type === 'invoice' && <InvoiceDetail kind={kind} invoiceId={dialog.id} onClose={() => setDialog(null)} onChanged={load} />}
    </Dialog>
  );
}

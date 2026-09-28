import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText, Plus, Trash2, Truck, ClipboardList, CheckCheck, Wallet, Undo2, ArrowLeftRight, RotateCcw, PackageMinus,
} from 'lucide-react';
import client from '../api/client';
import { useIdempotencyKey } from '../api/idempotency';
import { useAuth } from '../context/AuthContext';
import Dialog from '../ui/Dialog';
import Button, { IconButton } from '../ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '../ui/Field';
import { DescriptionList, ErrorState, SkeletonPanel, StatusBadge } from '../ui/display';
import { useToast } from '../ui/Toast';
import { formatRwf, formatDate } from '../ui/format';
import ReceiptModal from './ReceiptModal';
import CreditLimitPrompt, { isCreditError } from './CreditLimitPrompt';
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

export const financeUrl = (kind, path) => `/finance/${KIND[kind].side}${path}`;
const signed = (v) => formatRwf(v, { signed: true });

/* ---------------- Create supplier / customer ---------------- */

export const PARTY_STATUSES = { institution: ['active', 'inactive', 'blocked'], supplier: ['active', 'inactive', 'under_review'] };
export const STATUS_TONE = { active: 'success', inactive: 'neutral', blocked: 'danger', under_review: 'warning' };
const PARTY_FIELDS = {
  institution: ['name', 'type', 'status', 'contact_person', 'contact_phone', 'alt_phone', 'contact_email', 'address', 'district', 'sector', 'city', 'country', 'id_number', 'assigned_user_id', 'payment_terms', 'notes'],
  supplier: ['name', 'category', 'status', 'contact_person', 'contact_phone', 'alt_phone', 'contact_email', 'address', 'district', 'sector', 'city', 'country', 'registration_no', 'tin', 'payment_terms', 'notes'],
};

/** Create a supplier/client, or edit one (pass `party`). Every change is audited server-side. */
export function PartyFormDialog({ kind, party, onClose, onCreated, onSaved }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const cfg = KIND[kind];
  const editing = !!party;
  const [form, setForm] = useState(() => Object.fromEntries(PARTY_FIELDS[kind].map((k) => {
    if (party) return [k, party[k] ?? ''];
    return [k, { type: 'shop', status: 'active' }[k] ?? ''];
  })));
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const canAssign = kind === 'institution' && hasPermission('employees.manage');

  useEffect(() => {
    if (canAssign) client.get('/auth/employees').then(({ data }) => setStaff(data.filter((u) => u.status !== 'inactive' || u.id === party?.assigned_user_id))).catch(() => setStaff([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAssign]);

  async function submit() {
    setError(null);
    setLoading(true);
    const body = { ...form, ...(kind === 'institution' && { assigned_user_id: form.assigned_user_id ? Number(form.assigned_user_id) : null }) };
    if (!canAssign) delete body.assigned_user_id;
    try {
      const { data } = editing ? await client.put(`${cfg.endpoint}/${party.id}`, body) : await client.post(cfg.endpoint, body);
      (editing ? onSaved : onCreated)(data);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  const text = (key, label, props = {}) => <Field label={label} hint={props.hint}><Input value={form[key]} onChange={set(key)} maxLength={props.max || 255} type={props.type} /></Field>;
  return (
    <Dialog title={editing ? t('profile.editTitle', { name: party.name }) : t(`${cfg.ns}.newTitle`)} size="lg" onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.saving')}>{editing ? t('common.save') : t(`${cfg.ns}.add`)}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      <Field label={kind === 'supplier' ? t('profile.companyName') : t('common.name')} required><Input value={form.name} onChange={set('name')} required autoFocus maxLength={255} /></Field>
      <div className="form-row">
        {kind === 'institution' ? (
          <Field label={t('institutions.type')}>
            <Select value={form.type} onChange={set('type')}>
              {CLIENT_TYPES.map((ct) => <option key={ct} value={ct}>{t(`institutions.types.${ct}`)}</option>)}
            </Select>
          </Field>
        ) : text('category', t('profile.category'), { hint: t('profile.categoryHint'), max: 100 })}
        <Field label={t('profile.status')} hint={form.status === 'blocked' ? t('profile.blockedHint') : undefined}>
          <Select value={form.status} onChange={set('status')}>
            {PARTY_STATUSES[kind].map((st) => <option key={st} value={st}>{t(`profile.statuses.${st}`)}</option>)}
          </Select>
        </Field>
      </div>

      <div className="form-section-title">{t('profile.contact')}</div>
      <div className="form-row">
        {text('contact_person', t('institutions.contactPerson'))}
        {text('contact_email', t('suppliers.contactEmail'), { type: 'email' })}
      </div>
      <div className="form-row">
        {text('contact_phone', t('suppliers.contactPhone'), { type: 'tel' })}
        {text('alt_phone', t('profile.altPhone'), { type: 'tel' })}
      </div>

      <div className="form-section-title">{t('profile.addressSection')}</div>
      {text('address', t('suppliers.address'))}
      <div className="form-row">
        {text('district', t('profile.district'))}
        {text('sector', t('profile.sector'))}
      </div>
      <div className="form-row">
        {text('city', t('profile.city'))}
        {text('country', t('profile.country'))}
      </div>

      <div className="form-section-title">{t('profile.businessSection')}</div>
      {kind === 'institution' ? (
        <div className="form-row">
          {text('id_number', t('profile.idNumber'), { hint: t('profile.idNumberHint'), max: 64 })}
          {canAssign && (
            <Field label={t('profile.assignedStaff')} hint={t('profile.assignedStaffHint')}>
              <Select value={form.assigned_user_id ?? ''} onChange={set('assigned_user_id')}>
                <option value="">{t('profile.nobody')}</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </Select>
            </Field>
          )}
        </div>
      ) : (
        <div className="form-row">
          {text('registration_no', t('profile.registrationNo'), { max: 64 })}
          {text('tin', t('profile.tin'), { max: 64 })}
        </div>
      )}
      <Field label={t('common.paymentTerms')} hint={t('suppliers.paymentTermsPlaceholder')}><Input value={form.payment_terms} onChange={set('payment_terms')} maxLength={500} /></Field>
      <Field label={t('profile.notesField')} hint={t('profile.notesFieldHint')}><Textarea value={form.notes} onChange={set('notes')} rows={3} maxLength={2000} /></Field>
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
  const idem = useIdempotencyKey();
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

  // extra: a credit approval when retrying a sale that went over the limit (not the form event)
  async function submit(extra) {
    const approval = extra && !extra.nativeEvent ? extra : {};
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
          discount_amount: Number(discount) || 0, notes: notes || undefined, items, payment, ...approval,
        };
      const { data } = await client.post(cfg.recordsEndpoint, body, idem.config());
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
      {error && (isCreditError(error)
        ? <CreditLimitPrompt error={error} institutionId={partyId} onRetry={submit} busy={loading} />
        : <ErrorState error={error} />)}
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
  const idem = useIdempotencyKey();
  const { t } = useTranslation();
  const isRefund = mode === 'refund';
  const settleable = isRefund ? invoice.returns.filter((r) => kind === 'supplier' || r.status === 'approved') : [];
  const [returnId, setReturnId] = useState(settleable.length === 1 ? String(settleable[0].id) : '');
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
        return_id: returnId ? Number(returnId) : undefined,
      }, idem.config());
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
      {settleable.length > 0 && (
        <Field label={t('finance.settlesReturn')}>
          <Select value={returnId} onChange={(e) => setReturnId(e.target.value)}>
            <option value="">{t('finance.noSpecificReturn')}</option>
            {settleable.map((r) => (
              <option key={r.id} value={r.id}>{t('finance.returnOption', { id: r.id, date: formatDate(r.return_date), amount: formatRwf(r.total_value) })}</option>
            ))}
          </Select>
        </Field>
      )}
      <div className="form-row">
        <Field label={isRefund ? t('finance.dateOfRefund') : t('payment.datePaid')} required>
          <Input type="date" value={txnDate} max={todayIso()} onChange={(e) => setTxnDate(e.target.value)} required />
        </Field>
        <Field label={t('finance.notes')}><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
      </div>
    </Dialog>
  );
}

/* ---------------- Pay the account (spread over owed invoices, oldest first) ---------------- */

export function AccountPaymentDialog({ kind, partyId, invoices, owed, onClose, onDone }) {
  const idem = useIdempotencyKey();
  const { t } = useTranslation();
  const [amount, setAmount] = useState(String(owed));
  const [method, setMethod] = useState(kind === 'supplier' ? 'bank_transfer' : 'cash');
  const [reference, setReference] = useState('');
  const [txnDate, setTxnDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Mirrors the server's split so the person paying sees where the money goes
  const open = invoices.filter((i) => i.balance > 0)
    .sort((a, b) => String(a.invoice_date).localeCompare(String(b.invoice_date)) || a.id - b.id);
  let left = Number(amount) || 0;
  const split = open.map((i) => {
    const share = Math.max(0, Math.min(left, i.balance));
    left -= share;
    return { ...i, share };
  });
  const tooMuch = Number(amount) > owed;

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const { data } = await client.post(financeUrl(kind, `/parties/${partyId}/payments`), {
        amount: Number(amount), method, reference_no: reference || undefined, txn_date: txnDate, note: note || undefined,
      }, idem.config());
      onDone(data);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Dialog title={t('finance.payAccount')} description={t('finance.payAccountHint', { amount: formatRwf(owed) })} onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.recording')} disabled={tooMuch}>{t('payment.recordPayment')}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} action={t('errors.actions.payment')} />}
      <MoneyFields amount={amount} setAmount={setAmount} method={method} setMethod={setMethod} reference={reference} setReference={setReference} autoFocus
        hint={tooMuch ? t('finance.payAccountTooMuch') : undefined} />
      <div className="form-row">
        <Field label={t('payment.datePaid')} required>
          <Input type="date" value={txnDate} max={todayIso()} onChange={(e) => setTxnDate(e.target.value)} required />
        </Field>
        <Field label={t('finance.notes')}><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
      </div>
      <div className="form-section-title">{t('finance.payAccountSplit')}</div>
      <DescriptionList items={split.map((i) => ({
        label: t('finance.payAccountInvoice', { id: i.id, date: formatDate(i.invoice_date) }),
        value: t('finance.payAccountShare', { share: formatRwf(i.share), owed: formatRwf(i.balance) }),
        tone: i.share >= i.balance ? 'success' : undefined,
      }))} />
    </Dialog>
  );
}

/* ---------------- Apply credit from another invoice ---------------- */

function CreditDialog({ kind, invoice, sources, onClose, onDone }) {
  const idem = useIdempotencyKey();
  const { t } = useTranslation();
  const [sourceId, setSourceId] = useState(String(sources[0]?.id || ''));
  const source = sources.find((s) => String(s.id) === sourceId);
  const max = source ? Math.min(-source.balance, invoice.balance) : 0;
  const [amount, setAmount] = useState(String(max || ''));
  const [sourceReturns, setSourceReturns] = useState([]);
  const [returnId, setReturnId] = useState('');

  // The returns on the chosen source invoice - the credit usually comes from one of them
  useEffect(() => {
    if (!sourceId) return;
    setReturnId('');
    client.get(financeUrl(kind, `/invoices/${sourceId}`))
      .then(({ data }) => {
        const list = data.returns.filter((r) => kind === 'supplier' || r.status === 'approved');
        setSourceReturns(list);
        if (list.length === 1) setReturnId(String(list[0].id));
      })
      .catch(() => setSourceReturns([]));
  }, [kind, sourceId]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      await client.post(financeUrl(kind, `/invoices/${invoice.id}/credits`), {
        source_invoice_id: Number(sourceId), amount: Number(amount), return_id: returnId ? Number(returnId) : undefined,
      }, idem.config());
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
      {sourceReturns.length > 0 && (
        <Field label={t('finance.creditFromReturn')}>
          <Select value={returnId} onChange={(e) => setReturnId(e.target.value)}>
            <option value="">{t('finance.noSpecificReturn')}</option>
            {sourceReturns.map((r) => (
              <option key={r.id} value={r.id}>{t('finance.returnOption', { id: r.id, date: formatDate(r.return_date), amount: formatRwf(r.total_value) })}</option>
            ))}
          </Select>
        </Field>
      )}
    </Dialog>
  );
}

/* ---------------- Return goods ---------------- */

function ReturnDialog({ kind, invoice, onClose, onDone }) {
  const idem = useIdempotencyKey();
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
      }, idem.config());
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
  const idem = useIdempotencyKey();
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
                    <th scope="col" className="align-right">{t('finance.balanceAfter')}</th>
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
                      <td className="align-right num">{x.balance_after === undefined ? '—' : formatRwf(x.balance_after)}</td>
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
                    {r.balance_after !== undefined && <span>{t('finance.balanceAfter')}: {formatRwf(r.balance_after)}</span>}
                    <span>{t('finance.recordedBy')}: {r.recorded_by_name}</span>
                  </div>
                  {r.settlements?.length > 0 && (
                    <p className="text-secondary">
                      {t('finance.settledBy')}: {r.settlements.map((x) => (x.type === 'refund'
                        ? t('finance.settledRefund', { amount: formatRwf(x.amount), method: t(`paymentMethods.${x.method}`) })
                        : t('finance.settledCredit', { amount: formatRwf(x.amount), id: x.invoice_id }))).join(', ')}
                    </p>
                  )}
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
          onSubmit={async (reason) => { await client.post(financeUrl(kind, `/transactions/${dialog.txn.id}/reverse`), { reason }, idem.config()); idem.reset(); changed(t('finance.reversedToast')); }} />
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

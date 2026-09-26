import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Plus, Trash2, Truck, ClipboardList, Phone, Mail, UserRound, CheckCheck, Wallet } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import Dialog from '../ui/Dialog';
import Button, { IconButton } from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { EmptyState, ErrorState, SkeletonPanel, StatusBadge } from '../ui/display';
import { useToast } from '../ui/Toast';
import { formatRwf, formatDate } from '../ui/format';
import ReceiptModal from './ReceiptModal';

// Suppliers and clients (institutions) share one set of components; KIND
// holds everything that differs. Replaces 8 near-duplicate files.
export const CLIENT_TYPES = ['shop', 'school', 'individual', 'company', 'other'];
export const PAYMENT_TONE = { unpaid: 'danger', partial: 'warning', paid: 'success' };
const SUPPLIER_PAY_METHODS = ['cash', 'mobile_money', 'bank_transfer']; // supplier/client payments are outside the POS methods

export const KIND = {
  supplier: {
    ns: 'suppliers',
    endpoint: '/suppliers',
    recordsEndpoint: '/supplier-deliveries',
    recordsParam: 'supplier_id',
    payEndpoint: (id) => `/supplier-deliveries/${id}/payments`,
    receiptType: 'supplier-delivery',
    manage: 'suppliers.manage',
    recordManage: 'supplier_deliveries.manage',
    payManage: 'supplier_payments.manage',
    unpaidView: 'supplier_payments.view',
    unpaidEndpoint: '/supplier-deliveries/unpaid-summary',
    unpaidKey: 'supplier_id',
    unpaidName: 'supplier_name',
    recordDate: (r) => r.delivery_date,
    paymentStatus: (r) => r.status,
    recordIcon: Truck,
  },
  institution: {
    ns: 'institutions',
    endpoint: '/institutions',
    recordsEndpoint: '/institution-orders',
    recordsParam: 'institution_id',
    payEndpoint: (id) => `/institution-orders/${id}/payments`,
    receiptType: 'institution-order',
    manage: 'institutions.manage',
    recordManage: 'institution_orders.manage',
    payManage: 'institution_payments.manage',
    unpaidView: 'institution_payments.view',
    unpaidEndpoint: '/institution-orders/unpaid-summary',
    unpaidKey: 'institution_id',
    unpaidName: 'institution_name',
    recordDate: (r) => r.order_date,
    paymentStatus: (r) => r.payment_status,
    recordIcon: ClipboardList,
  },
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/* ---------------- Create supplier / client ---------------- */

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

/* ---------------- Record a delivery (supplier) / order (client) ---------------- */

export function LineItemsDialog({ kind, partyId, onClose, onRecorded }) {
  const { t } = useTranslation();
  const isDelivery = kind === 'supplier';
  const priceKey = isDelivery ? 'unit_cost' : 'unit_price';
  const emptyLine = () => ({ product_id: '', quantity: '', [priceKey]: '' });
  const [products, setProducts] = useState([]);
  const [mainDate, setMainDate] = useState(todayIso());
  const [secondDate, setSecondDate] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [error, setError] = useState(null);
  const [linesError, setLinesError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client.get('/products').then(({ data }) => setProducts(data)).catch(setError);
  }, []);

  const updateLine = (index, field, value) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l[priceKey]) || 0), 0);

  async function submit() {
    const items = lines
      .filter((l) => l.product_id && l.quantity && l[priceKey] !== '')
      .map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity), [priceKey]: Number(l[priceKey]) }));
    if (!items.length) {
      setLinesError(t('common.atLeastOneLineItem'));
      return;
    }
    setLinesError('');
    setError(null);
    setLoading(true);
    try {
      const body = isDelivery
        ? { supplier_id: partyId, delivery_date: mainDate, payment_due_date: secondDate || null, items }
        : { institution_id: partyId, order_date: mainDate, delivery_date: secondDate || null, items };
      const { data } = await client.post(isDelivery ? '/supplier-deliveries' : '/institution-orders', body);
      onRecorded(data);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Dialog title={isDelivery ? t('delivery.title') : t('order.title')} description={isDelivery ? t('delivery.hint') : t('order.hint')}
      size="lg" onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <div className="dialog-footer-total"><span>{t('common.total')}</span><strong className="num">{formatRwf(total)}</strong></div>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.recording')}>
            {isDelivery ? t('delivery.recordDelivery') : t('order.createOrder')}
          </Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      <div className="form-row">
        <Field label={isDelivery ? t('delivery.deliveryDate') : t('order.orderDate')} required>
          <Input type="date" value={mainDate} onChange={(e) => setMainDate(e.target.value)} required />
        </Field>
        <Field label={isDelivery ? t('delivery.paymentDueOptional') : t('order.deliveryDateOptional')}>
          <Input type="date" value={secondDate} onChange={(e) => setSecondDate(e.target.value)} />
        </Field>
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
          </li>
        ))}
      </ol>
      <Button variant="ghost" icon={Plus} onClick={() => setLines((ls) => [...ls, emptyLine()])}>{t('delivery.addAnotherItem')}</Button>
    </Dialog>
  );
}

/* ---------------- Record a payment against a delivery / order ---------------- */

export function PaymentDialog({ kind, record, onClose, onRecorded }) {
  const { t } = useTranslation();
  const balance = Number(record.total_amount) - Number(record.amount_paid);
  const [amount, setAmount] = useState(balance > 0 ? balance : '');
  const [paidDate, setPaidDate] = useState(todayIso());
  const [method, setMethod] = useState('cash');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      await client.post(KIND[kind].payEndpoint(record.id), { amount: Number(amount), paid_date: paidDate, method });
      onRecorded(Number(amount));
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Dialog title={t('payment.title')} description={t('payment.balanceOwed', { amount: formatRwf(balance) })} size="sm" onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.recording')}>{t('payment.recordPayment')}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} action={t('errors.actions.payment')} />}
      <Field label={t('payment.amountRwf')} required hint={Number(amount) > balance ? t('payment.overpaymentWarning') : undefined}>
        <Input type="number" inputMode="numeric" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
      </Field>
      <div className="form-row">
        <Field label={t('payment.datePaid')} required><Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} required /></Field>
        <Field label={t('payment.method')}>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {SUPPLIER_PAY_METHODS.map((m) => <option key={m} value={m}>{t(`paymentMethods.${m}`)}</option>)}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

/* ---------------- Detail (deliveries / orders) ---------------- */

export function PartyDetail({ kind, id, onClose }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const cfg = KIND[kind];
  const [party, setParty] = useState(null);
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // { type: 'record'|'pay'|'receipt', record? }

  const load = useCallback(async () => {
    try {
      const [{ data: partyData }, { data: recordData }] = await Promise.all([
        client.get(`${cfg.endpoint}/${id}`),
        client.get(cfg.recordsEndpoint, { params: { [cfg.recordsParam]: id } }),
      ]);
      setParty(partyData);
      setRecords(recordData);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [cfg, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function markDelivered(orderId) {
    try {
      await client.post(`/institution-orders/${orderId}/deliver`);
      toast.success(t('institutions.markedDelivered', { id: orderId }));
      load();
    } catch (err) {
      setError(err);
    }
  }

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

      <h3 className="subheading">{t(`${cfg.ns}.records`)}</h3>
      {records && records.length === 0 && (
        <EmptyState compact icon={RecordIcon} title={t(`${cfg.ns}.noRecords`)} description={t(`${cfg.ns}.noRecordsHint`)} />
      )}
      {records && records.length > 0 && (
        <ul className="record-list">
          {records.map((r) => {
            const balance = Number(r.total_amount) - Number(r.amount_paid);
            const status = cfg.paymentStatus(r);
            return (
              <li key={r.id} className="record-card">
                <div className="record-card-top">
                  <span className="record-card-title">#{r.id} · {formatDate(cfg.recordDate(r))}</span>
                  <span className="record-card-badges">
                    <StatusBadge tone={PAYMENT_TONE[status]}>{t(`badges.${status}`)}</StatusBadge>
                    {kind === 'institution' && (
                      <StatusBadge tone={r.delivery_status === 'delivered' ? 'success' : 'neutral'}>
                        {r.delivery_status === 'delivered' ? t('badges.delivered') : t('badges.pendingDelivery')}
                      </StatusBadge>
                    )}
                  </span>
                </div>
                <div className="record-card-amounts num">
                  <span>{t('common.total')}: <strong>{formatRwf(r.total_amount)}</strong></span>
                  <span>{t('receipts.amountPaid')}: {formatRwf(r.amount_paid)}</span>
                  {balance > 0 && <span className="text-danger">{t('receipts.balanceDue')}: {formatRwf(balance)}</span>}
                </div>
                <div className="record-card-actions">
                  {kind === 'institution' && r.delivery_status === 'pending' && hasPermission('institution_orders.manage') && (
                    <Button size="sm" icon={CheckCheck} onClick={() => markDelivered(r.id)}>{t('institutions.markDelivered')}</Button>
                  )}
                  {balance > 0 && hasPermission(cfg.payManage) && (
                    <Button size="sm" icon={Wallet} onClick={() => setDialog({ type: 'pay', record: r })}>{t('payment.recordPayment')}</Button>
                  )}
                  <Button size="sm" variant="ghost" icon={FileText} onClick={() => setDialog({ type: 'receipt', record: r })}>{t('receipts.viewReceipt')}</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.type === 'record' && (
        <LineItemsDialog kind={kind} partyId={id} onClose={() => setDialog(null)}
          onRecorded={() => { setDialog(null); toast.success(t(`${cfg.ns}.recorded`)); load(); }} />
      )}
      {dialog?.type === 'pay' && (
        <PaymentDialog kind={kind} record={dialog.record} onClose={() => setDialog(null)}
          onRecorded={(amount) => { setDialog(null); toast.success(t('payment.recorded', { amount: formatRwf(amount) })); load(); }} />
      )}
      {dialog?.type === 'receipt' && <ReceiptModal type={cfg.receiptType} id={dialog.record.id} onClose={() => setDialog(null)} />}
    </Dialog>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Ban, FilePlus2, FileText, Plus, Printer, ShoppingBag, Trash2 } from 'lucide-react';
import client from '../api/client';
import { useIdempotencyKey } from '../api/idempotency';
import { useAuth } from '../context/AuthContext';
import CreditLimitPrompt, { isCreditError } from '../components/CreditLimitPrompt';
import DocumentActions from '../components/documents/DocumentActions';
import { ReasonDialog } from '../components/businessDay/Dialogs';
import { ACCOUNT_METHODS, todayIso } from '../components/finance/constants';
import Dialog from '../ui/Dialog';
import Button, { IconButton } from '../ui/Button';
import DataTable from '../ui/DataTable';
import { Checkbox, Field, Input, Select, Textarea } from '../ui/Field';
import { DescriptionList, ErrorState, PageHeader, SkeletonPanel, StatusBadge } from '../ui/display';
import { useToast } from '../ui/Toast';
import { formatRwf, formatDate } from '../ui/format';

export const PROFORMA_TONE = { issued: 'info', expired: 'neutral', converted: 'success', cancelled: 'neutral' };

/* ---------------- New proforma ---------------- */

function NewProformaDialog({ defaultClientId, onClose, onCreated }) {
  const { t } = useTranslation();
  const idem = useIdempotencyKey();
  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(defaultClientId ? String(defaultClientId) : '');
  const [customerName, setCustomerName] = useState('');
  const [contact, setContact] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState('');
  const [lines, setLines] = useState([{ product_id: '', quantity: '1', unit_price: '' }]);
  const [error, setError] = useState(null);
  const [linesError, setLinesError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client.get('/products').then(({ data }) => setProducts(data)).catch(setError);
    client.get('/institutions').then(({ data }) => setClients(data.filter((c) => c.status !== 'blocked'))).catch(() => setClients([]));
    client.get('/documents/settings').then(({ data }) => setTerms((cur) => cur || data.proforma_terms || '')).catch(() => {});
  }, []);

  const productOf = (id) => products.find((p) => String(p.id) === String(id));
  const priceOf = (l) => (l.unit_price === '' ? Number(productOf(l.product_id)?.selling_price || 0) : Number(l.unit_price) || 0);
  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (l.product_id ? priceOf(l) : 0), 0);
  const total = Math.max(0, subtotal - (Number(discount) || 0));
  const update = (i, field, value) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));

  async function submit() {
    const items = lines.filter((l) => l.product_id && Number(l.quantity) > 0)
      .map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity), ...(l.unit_price !== '' && { unit_price: Number(l.unit_price) }) }));
    if (!items.length) {
      setLinesError(t('common.atLeastOneLineItem'));
      return;
    }
    setLinesError('');
    setError(null);
    setLoading(true);
    try {
      const { data } = await client.post('/proformas', {
        ...(clientId ? { institution_id: Number(clientId) } : { customer_name: customerName, customer_contact: contact || undefined }),
        valid_until: validUntil, payment_terms: terms || undefined, notes: notes || undefined, discount_amount: Number(discount) || 0, items,
      }, idem.config());
      idem.reset();
      onCreated(data);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Dialog title={t('proforma.newTitle')} description={t('proforma.newHint')} size="lg" onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <div className="dialog-footer-total"><span>{t('proforma.totalProposed')}</span><strong className="num">{formatRwf(total)}</strong></div>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.saving')}>{t('proforma.issue')}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      <div className="form-row">
        <Field label={t('proforma.client')} hint={t('proforma.clientHint')}>
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">{t('proforma.walkIn')}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label={t('proforma.validUntil')} hint={t('proforma.validUntilHint')} required>
          <Input type="date" value={validUntil} min={todayIso()} onChange={(e) => setValidUntil(e.target.value)} required />
        </Field>
      </div>
      {!clientId && (
        <div className="form-row">
          <Field label={t('proforma.customerName')} required><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={200} required /></Field>
          <Field label={t('proforma.customerContact')}><Input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} /></Field>
        </div>
      )}

      <div className="form-section-title">{t('delivery.items')}</div>
      {linesError && <p className="field-error" role="alert">{linesError}</p>}
      <ol className="line-editor">
        {lines.map((line, i) => (
          <li key={i} className="line-editor-row">
            <Field label={t('common.product')} className="line-editor-product">
              <Select value={line.product_id} onChange={(e) => update(i, 'product_id', e.target.value)}>
                <option value="">{t('common.selectProduct')}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label={t('delivery.qty')}>
              <Input type="number" inputMode="numeric" min="1" value={line.quantity} onChange={(e) => update(i, 'quantity', e.target.value)} />
            </Field>
            <Field label={t('order.unitPriceRwf')} hint={line.product_id && line.unit_price === '' ? t('proforma.shelfPrice', { amount: formatRwf(priceOf(line)) }) : undefined}>
              <Input type="number" inputMode="numeric" min="0" value={line.unit_price} placeholder={line.product_id ? String(priceOf(line)) : ''} onChange={(e) => update(i, 'unit_price', e.target.value)} />
            </Field>
            <IconButton icon={Trash2} label={t('delivery.removeLine', { n: i + 1 })} disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="line-editor-remove" />
          </li>
        ))}
      </ol>
      <Button variant="ghost" icon={Plus} onClick={() => setLines((ls) => [...ls, { product_id: '', quantity: '1', unit_price: '' }])}>{t('delivery.addAnotherItem')}</Button>

      <Field label={t('finance.discountRwf')}>
        <Input type="number" inputMode="numeric" min="0" step="1" value={discount} onChange={(e) => setDiscount(e.target.value)} />
      </Field>
      <Field label={t('proforma.paymentTerms')} hint={t('proforma.paymentTermsHint')}><Textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} maxLength={1000} /></Field>
      <Field label={t('finance.notes')}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} /></Field>
    </Dialog>
  );
}

/* ---------------- Convert to a sale ---------------- */

function ConvertDialog({ proforma, onClose, onDone }) {
  const { t } = useTranslation();
  const idem = useIdempotencyKey();
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(proforma.institution_id ? String(proforma.institution_id) : '');
  const [dueDate, setDueDate] = useState('');
  const [payNow, setPayNow] = useState(false);
  const [amount, setAmount] = useState(String(proforma.total_amount));
  const [method, setMethod] = useState('cash');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!proforma.institution_id) client.get('/institutions').then(({ data }) => setClients(data.filter((c) => c.status !== 'blocked'))).catch(() => setClients([]));
  }, [proforma.institution_id]);

  async function submit(extra) {
    const approval = extra && !extra.nativeEvent ? extra : {};
    setError(null);
    setLoading(true);
    try {
      const { data } = await client.post(`/proformas/${proforma.id}/convert`, {
        ...(!proforma.institution_id && { institution_id: Number(clientId) || undefined }),
        due_date: dueDate || undefined,
        ...(payNow && Number(amount) > 0 && { payment: { amount: Number(amount), method } }),
        ...approval,
      }, idem.config());
      idem.reset();
      onDone(data);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Dialog title={t('proforma.convertTitle', { number: proforma.number })} description={t('proforma.convertHint', { amount: formatRwf(proforma.total_amount) })}
      onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.recording')}>{t('proforma.convert')}</Button>
        </>
      )}
    >
      {error && (isCreditError(error)
        ? <CreditLimitPrompt error={error} institutionId={proforma.institution_id || clientId} onRetry={submit} busy={loading} />
        : <ErrorState error={error} />)}
      {!proforma.institution_id && (
        <Field label={t('proforma.client')} hint={t('proforma.convertClientHint')} required>
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="">{t('proforma.chooseClient')}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label={t('finance.dueDateOptional')}><Input type="date" value={dueDate} min={todayIso()} onChange={(e) => setDueDate(e.target.value)} /></Field>
      <Checkbox label={t('finance.paidAtSale')} description={t('finance.paidNowHint')} checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />
      {payNow && (
        <div className="form-row">
          <Field label={t('finance.amountPaidNow')}><Input type="number" inputMode="numeric" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label={t('payment.method')}>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {ACCOUNT_METHODS.map((m) => <option key={m} value={m}>{t(`paymentMethods.${m}`)}</option>)}
            </Select>
          </Field>
        </div>
      )}
    </Dialog>
  );
}

/* ---------------- Printable proforma (browser print, single page) ---------------- */

export function ProformaSheet({ proforma: p, business }) {
  const { t } = useTranslation();
  return (
    <div className="receipt proforma-sheet">
      <div className="receipt-header">
        <div className="receipt-brand">{business?.name || t('nav.brand')}</div>
        {business && [business.address, business.phone, business.email, business.tin && `TIN ${business.tin}`].filter(Boolean).length > 0 && (
          <div className="receipt-sku">{[business.address, business.phone, business.email, business.tin && `TIN ${business.tin}`].filter(Boolean).join(' · ')}</div>
        )}
        <div className="receipt-title">{t('proforma.docTitle')}</div>
      </div>
      <div className="receipt-meta">
        <div><span className="receipt-label">{t('proforma.number')}</span><span className="num">{p.number}</span></div>
        <div><span className="receipt-label">{t('common.date')}</span><span>{formatDate(p.issue_date)}</span></div>
        <div><span className="receipt-label">{t('proforma.validUntil')}</span><strong>{formatDate(p.valid_until)}</strong></div>
      </div>
      <div className="receipt-party">
        <span className="receipt-label">{t('proforma.preparedFor')}</span>
        <strong>{p.customer_name}</strong>
        {p.customer_contact && <span>{p.customer_contact}</span>}
      </div>
      <table className="receipt-table">
        <thead>
          <tr>
            <th scope="col">{t('common.product')}</th>
            <th scope="col" className="align-right">{t('delivery.qty')}</th>
            <th scope="col" className="align-right">{t('order.unitPrice')}</th>
            <th scope="col" className="align-right">{t('common.total')}</th>
          </tr>
        </thead>
        <tbody>
          {p.items.map((i) => (
            <tr key={i.id}>
              <td>{i.product_name}{i.sku && <div className="receipt-sku">{i.sku}</div>}</td>
              <td className="align-right num">{i.quantity}</td>
              <td className="align-right num">{formatRwf(i.unit_price)}</td>
              <td className="align-right num">{formatRwf(i.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="receipt-totals">
        <div><dt>{t('finance.subtotal')}</dt><dd className="num">{formatRwf(p.subtotal)}</dd></div>
        {p.discount_amount > 0 && <div><dt>{t('finance.discount')}</dt><dd className="num">{formatRwf(-p.discount_amount)}</dd></div>}
        <div className="receipt-total-final"><dt>{t('proforma.totalProposed')}</dt><dd className="num">{formatRwf(p.total_amount)}</dd></div>
      </dl>
      {p.payment_terms && <><div className="receipt-section">{t('proforma.paymentTerms')}</div><p>{p.payment_terms}</p></>}
      {p.notes && <><div className="receipt-section">{t('finance.notes')}</div><p>{p.notes}</p></>}
      <p className="receipt-footer">{t('proforma.disclaimer')}</p>
    </div>
  );
}

function ProformaDetail({ id, onClose, onChanged }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [p, setP] = useState(null);
  const [business, setBusiness] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const canManage = hasPermission('institution_orders.manage');

  const load = useCallback(async () => {
    try {
      const [{ data }, biz] = await Promise.all([client.get(`/proformas/${id}`), client.get('/documents/settings').catch(() => ({ data: null }))]);
      setP(data);
      setBusiness(biz.data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const footer = p && (
    <>
      {canManage && p.state === 'issued' && <Button icon={Ban} onClick={() => setDialog('cancel')}>{t('proforma.cancel')}</Button>}
      <Button icon={Printer} onClick={() => window.print()}>{t('proforma.print')}</Button>
      <DocumentActions path={`/proformas/${p.id}`} filename={`${p.number}.pdf`} printLabel={t('proforma.openPdf')} />
      {canManage && p.state === 'issued' && <Button variant="primary" icon={ShoppingBag} onClick={() => setDialog('convert')}>{t('proforma.convert')}</Button>}
    </>
  );

  return (
    <Dialog title={p ? `${t('proforma.docTitle')} ${p.number}` : t('common.loading')} description={p ? p.customer_name : undefined} size="lg" onClose={onClose} footer={footer}>
      {error && <ErrorState error={error} onRetry={load} />}
      {!p && !error && <SkeletonPanel lines={8} />}
      {p && (
        <>
          <div className="record-card-badges">
            <StatusBadge tone={PROFORMA_TONE[p.state]}>{t(`proforma.states.${p.state}`)}</StatusBadge>
          </div>
          {p.state === 'converted' && (
            <p className="field-hint">{t('proforma.convertedInfo', { name: p.converted_by_name, id: p.converted_order_id })}</p>
          )}
          {p.state === 'cancelled' && <p className="field-hint">{t('proforma.cancelledInfo', { name: p.cancelled_by_name, reason: p.cancel_reason })}</p>}
          <ProformaSheet proforma={p} business={business} />
          <DescriptionList items={[{ label: t('proforma.preparedBy'), value: p.created_by_name || '—' }]} />
        </>
      )}
      {dialog === 'convert' && (
        <ConvertDialog proforma={p} onClose={() => setDialog(null)} onDone={(data) => {
          setDialog(null);
          toast.success(t('proforma.converted', { id: data.order.id }));
          onChanged();
          load();
          if (data.order.institution_id) navigate(`/institutions/${data.order.institution_id}?tab=invoices`);
        }} />
      )}
      {dialog === 'cancel' && (
        <ReasonDialog title={t('proforma.cancelTitle', { number: p.number })} label={t('businessDay.review.reason')} minLength={3} danger
          confirmLabel={t('proforma.cancel')} onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            await client.post(`/proformas/${p.id}/cancel`, { reason });
            setDialog(null);
            toast.success(t('proforma.cancelled'));
            onChanged();
            load();
          }} />
      )}
    </Dialog>
  );
}

/* ---------------- List ---------------- */

export default function Proformas() {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const canManage = hasPermission('institution_orders.manage');

  const load = useCallback(async () => {
    try {
      const { data } = await client.get('/proformas', { params: status ? { status } : {} });
      setRows(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const newButton = canManage && <Button variant="primary" icon={FilePlus2} onClick={() => setCreating(true)}>{t('proforma.new')}</Button>;
  return (
    <div className="page">
      <PageHeader title={t('proforma.title')} subtitle={t('proforma.subtitle')} actions={newButton} />
      <DataTable
        caption={t('proforma.title')}
        columns={[
          { key: 'number', header: t('proforma.number'), sortable: true, mobile: 'title' },
          { key: 'customer_name', header: t('proforma.customer'), sortable: true, mobile: 'subtitle' },
          { key: 'issue_date', header: t('common.date'), sortable: true, render: (p) => formatDate(p.issue_date) },
          { key: 'valid_until', header: t('proforma.validUntil'), sortable: true, render: (p) => formatDate(p.valid_until) },
          { key: 'state', header: t('common.status'), mobile: 'meta', render: (p) => <StatusBadge tone={PROFORMA_TONE[p.state]}>{t(`proforma.states.${p.state}`)}</StatusBadge> },
          { key: 'total_amount', header: t('common.total'), align: 'right', sortable: true, mobile: 'value', render: (p) => formatRwf(p.total_amount) },
        ]}
        rows={rows}
        loading={!rows}
        error={error}
        onRetry={load}
        searchable
        searchPlaceholder={t('proforma.search')}
        initialSort={{ key: 'number', dir: 'desc' }}
        onRowClick={(p) => setOpenId(p.id)}
        rowLabel={(p) => t('common.openNamed', { name: p.number })}
        toolbar={(
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')} className="filter-select">
            <option value="">{t('profile.allStatuses')}</option>
            {['issued', 'expired', 'converted', 'cancelled'].map((s) => <option key={s} value={s}>{t(`proforma.states.${s}`)}</option>)}
          </Select>
        )}
        empty={{ icon: FileText, title: t('proforma.none'), description: t('proforma.noneHint'), action: newButton || null }}
      />
      {creating && (
        <NewProformaDialog onClose={() => setCreating(false)} onCreated={(p) => {
          setCreating(false);
          toast.success(t('proforma.created', { number: p.number }));
          load();
          setOpenId(p.id);
        }} />
      )}
      {openId && <ProformaDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

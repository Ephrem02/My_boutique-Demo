import { useTranslation } from 'react-i18next';
import { DescriptionList, Panel } from '../../ui/display';
import { formatRwf, formatDate } from '../../ui/format';
import { BehaviourPanel } from './ProfileInsights';
import CreditPanel from './CreditPanel';

const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 1000) / 10}%`);

/** Identity + the figures an owner looks at first + the latest entries. */
export default function ProfileOverview({ kind, party, statement, insights, onOpen, onChanged }) {
  const { t } = useTranslation();
  const isSupplier = kind === 'supplier';
  const f = insights?.financial;
  const place = [party.address, party.sector, party.district, party.city, party.country].filter(Boolean).join(', ');

  const identity = [
    { label: isSupplier ? t('profile.supplierId') : t('profile.clientId'), value: `#${party.id}` },
    !isSupplier && { label: t('institutions.type'), value: t(`institutions.types.${party.type}`, { defaultValue: party.type }) },
    isSupplier && party.category && { label: t('profile.category'), value: party.category },
    party.contact_person && { label: t('institutions.contactPerson'), value: party.contact_person },
    (party.contact_phone || party.alt_phone) && { label: t('suppliers.contactPhone'), value: [party.contact_phone, party.alt_phone].filter(Boolean).join(' · ') },
    party.contact_email && { label: t('suppliers.contactEmail'), value: party.contact_email },
    place && { label: t('suppliers.address'), value: place },
    !isSupplier && party.id_number && { label: t('profile.idNumber'), value: party.id_number },
    isSupplier && party.registration_no && { label: t('profile.registrationNo'), value: party.registration_no },
    isSupplier && party.tin && { label: t('profile.tin'), value: party.tin },
    !isSupplier && { label: t('profile.assignedStaff'), value: party.assigned_user_name || t('profile.nobody') },
    { label: t('common.paymentTerms'), value: party.payment_terms || '—' },
    { label: t('profile.registered'), value: formatDate(party.created_at) },
  ];

  const figures = f && (isSupplier ? [
    { label: t('profile.purchaseInvoices'), value: t('profile.invoiceBreakdown', { total: f.invoice_count, paid: f.fully_paid, partial: f.partially_paid, unpaid: f.unpaid }) },
    { label: t('finance.returns'), value: formatRwf(f.returns) },
    { label: t('finance.refundsReceived'), value: formatRwf(f.refunds_received) },
    { label: t('finance.creditApplied'), value: formatRwf(f.credit_applied) },
    { label: t('finance.supplier.credit'), value: formatRwf(f.credit) },
    { label: t('profile.lastPayment'), value: f.last_payment_date ? formatDate(f.last_payment_date) : '—' },
    { label: t('profile.nextDue'), value: insights.behaviour.next_due ? `${formatDate(insights.behaviour.next_due.due_date)} · ${formatRwf(insights.behaviour.next_due.balance)}` : '—' },
  ] : [
    { label: t('profile.invoicesAndTill'), value: t('profile.invoicesAndTillValue', { invoices: f.invoice_count, till: f.till_purchase_count }) },
    { label: t('profile.discountsGiven'), value: formatRwf(f.discounts) },
    { label: t('finance.returns'), value: formatRwf(f.returns) },
    { label: t('finance.refundsPaid'), value: formatRwf(f.refunds) },
    { label: t('finance.customer.credit'), value: formatRwf(f.credit) },
    { label: t('profile.avgPurchase'), value: f.avg_purchase !== null ? formatRwf(f.avg_purchase) : '—' },
    { label: t('profile.lastPayment'), value: f.last_payment_date ? formatDate(f.last_payment_date) : '—' },
    { label: t('profile.nextDue'), value: insights.behaviour.next_due ? `${formatDate(insights.behaviour.next_due.due_date)} · ${formatRwf(insights.behaviour.next_due.balance)}` : '—' },
    { label: t('profile.completionRate'), value: pct(f.completion_rate) },
  ]);

  const recent = statement ? statement.entries.slice(0, 8) : [];
  return (
    <>
      <div className="finance-grid">
        <Panel title={t('profile.identity')}>
          <DescriptionList items={identity} />
        </Panel>
        {figures && (
          <Panel title={t('profile.financialIndicators')} subtitle={t('profile.fromLedger')}>
            <DescriptionList items={figures} />
          </Panel>
        )}
      </div>

      {!isSupplier && statement && <CreditPanel party={party} onChanged={onChanged} />}

      {insights && <BehaviourPanel behaviour={insights.behaviour} kind={kind} />}

      {recent.length > 0 && (
        <Panel title={t('profile.recentActivity')} className="profile-section">
          <ul className="profile-timeline">
            {recent.map((e) => (
              <li key={e.id} className={e.reversed ? 'txn-reversed' : undefined}>
                <span className="profile-timeline-date">{formatDate(e.date)}</span>
                <button type="button" className="link-button" onClick={() => onOpen(e.invoice_id)}>
                  {e.kind === 'refund' ? t(isSupplier ? 'finance.entry.supplierRefund' : 'finance.entry.customerRefund') : t(`finance.entry.${e.kind}`)} · #{e.invoice_id}
                </button>
                <span className="num">{e.effect ? formatRwf(e.effect, { signed: true }) : '—'}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

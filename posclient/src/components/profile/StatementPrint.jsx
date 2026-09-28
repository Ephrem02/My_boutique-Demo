import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import { formatRwf, formatDate, formatDateTime } from '../../ui/format';

const dateOnly = (v) => {
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * A printable account statement for one supplier/customer: opening balance,
 * every entry in the period (oldest first) with its running balance, closing
 * balance. Printing shows only the .receipt block (see pages.css).
 */
export default function StatementPrint({ kind, party, statement, from, to, onClose }) {
  const { t } = useTranslation();
  const all = [...statement.entries].reverse(); // oldest first
  const before = from ? all.filter((e) => dateOnly(e.date) < from) : [];
  const opening = before.length ? before[before.length - 1].balance : 0;
  const rows = all.filter((e) => (!from || dateOnly(e.date) >= from) && (!to || dateOnly(e.date) <= to));
  const closing = rows.length ? rows[rows.length - 1].balance : opening;
  const label = (e) => (e.kind === 'refund'
    ? t(kind === 'supplier' ? 'finance.entry.supplierRefund' : 'finance.entry.customerRefund')
    : t(`finance.entry.${e.kind}`));
  const isSupplier = kind === 'supplier';

  return (
    <Dialog title={t('profile.statementTitle')} hideTitle size="lg" onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>{t('receipts.print')}</Button>
        </>
      )}
    >
      <div className="receipt">
        <div className="receipt-header">
          <div className="receipt-brand">{t('nav.brand')}</div>
          <div className="receipt-title">{t('profile.statementTitle')}</div>
        </div>
        <div className="receipt-party">
          <span className="receipt-label">{isSupplier ? t('receipts.supplierLabel') : t('receipts.clientLabel')}</span>
          <strong>{party.name}</strong>
          {[party.address, party.district, party.city].filter(Boolean).length > 0 && <span>{[party.address, party.sector, party.district, party.city].filter(Boolean).join(', ')}</span>}
          {party.contact_phone && <span>{party.contact_phone}</span>}
        </div>
        <div className="receipt-meta">
          <div><span className="receipt-label">{t('profile.period')}</span><span>{from ? formatDate(from) : t('profile.beginning')} – {to ? formatDate(to) : t('profile.today')}</span></div>
          <div><span className="receipt-label">{t('profile.printedOn')}</span><span>{formatDateTime(new Date())}</span></div>
        </div>

        <table className="receipt-table">
          <thead>
            <tr>
              <th scope="col">{t('common.date')}</th>
              <th scope="col">{t('finance.entryType')}</th>
              <th scope="col">{t('finance.referenceNo')}</th>
              <th scope="col" className="align-right">{t('finance.change')}</th>
              <th scope="col" className="align-right">{t('finance.balance')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{from ? formatDate(from) : '—'}</td>
              <td colSpan={3}><strong>{t('profile.openingBalance')}</strong></td>
              <td className="align-right num"><strong>{formatRwf(opening)}</strong></td>
            </tr>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.date)}</td>
                <td>
                  {label(e)} · #{e.invoice_id}
                  {e.method && ` · ${t(`paymentMethods.${e.method}`, { defaultValue: e.method })}`}
                  {e.reversed && ` (${t('finance.reversed')})`}
                </td>
                <td>{e.reference_no || '—'}</td>
                <td className="align-right num">{e.effect ? formatRwf(e.effect, { signed: true }) : '—'}</td>
                <td className="align-right num">{formatRwf(e.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="receipt-totals">
          <div className="receipt-total-final">
            <dt>{closing < 0 ? t('finance.creditBalance') : isSupplier ? t('profile.weOwe') : t('profile.amountDue')}</dt>
            <dd className="num">{formatRwf(Math.abs(closing))}</dd>
          </div>
        </dl>
        <p className="receipt-footer">{t('profile.statementFooter')}</p>
      </div>
    </Dialog>
  );
}

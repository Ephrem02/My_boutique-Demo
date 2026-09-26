import { useTranslation } from 'react-i18next';
import { Lock, UserRound } from 'lucide-react';
import { StatusBadge, HEALTH_TONE, Metric, DescriptionList, Alert } from '../../ui/display';
import { formatRwf, formatDate, formatTime, formatNumber } from '../../ui/format';
import useBreakpoint from '../../ui/useBreakpoint';
import { METHODS } from './Dialogs';

export const DAY_STATUS_TONE = {
  open: 'success',
  closing_in_progress: 'warning',
  closing_submitted: 'warning',
  closed: 'neutral',
  closed_with_adjustment: 'info',
};
const BAND_TONE = { normal: undefined, attention: 'warning', critical: 'danger' };

/** Who opened / requested / submitted / accepted, and who worked - names only. */
export function PeopleList({ people, closed }) {
  const { t } = useTranslation();
  const rows = [
    people.opened_by && [t('businessDay.people.openedBy'), people.opened_by],
    people.closing_requested_by && [t('businessDay.people.closingRequestedBy'), people.closing_requested_by],
    closed && people.submitted_by && [t('businessDay.people.submittedBy'), people.submitted_by],
    closed && people.acceptance === 'manager' && people.accepted_by && [t('businessDay.people.acceptedBy'), people.accepted_by],
  ].filter(Boolean);
  return (
    <div className="people">
      <ul className="people-list">
        {rows.map(([label, person]) => (
          <li key={label}>
            <span className="people-label">{label}</span>
            <span className="people-name"><UserRound aria-hidden="true" />{person.name}</span>
            {person.at && <span className="people-time num">{formatTime(person.at)}</span>}
          </li>
        ))}
        {closed && people.acceptance === 'auto' && (
          <li>
            <span className="people-label">{t('businessDay.people.acceptance')}</span>
            <span className="people-name">{t('businessDay.autoAccepted')}</span>
          </li>
        )}
      </ul>
      {people.worked?.length > 0 && (
        <p className="people-worked">
          <span className="people-label">{closed ? t('businessDay.people.workedThisDay') : t('businessDay.people.onDutySoFar')}</span>
          <span>{people.worked.join(', ')}</span>
        </p>
      )}
    </div>
  );
}

export function HealthBadge({ health }) {
  const { t } = useTranslation();
  if (!health) return null;
  const reasons = health.reasons.map((r) => t(`businessDay.reasons.${r}`, { defaultValue: r })).join(' · ');
  return (
    <StatusBadge tone={HEALTH_TONE[health.status]}>
      {t(`businessDay.health.${health.status}`)}
      {reasons && <span className="sr-only">: {reasons}</span>}
    </StatusBadge>
  );
}

/**
 * Read-only closing report rendered from the stored snapshot (+ approved
 * adjustments). Used for "Last closing" on the dashboard and the day detail page.
 */
export default function ClosingReport({ board, title, actions, headingLevel = 2 }) {
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();
  const { day, figures, people, closing, corrected } = board;
  const Heading = `h${headingLevel}`;
  const variance = corrected ? corrected.variance : closing.variance;
  const reasons = board.health?.reasons.map((r) => t(`businessDay.reasons.${r}`, { defaultValue: r })) || [];

  return (
    <section className="panel closing-report" aria-label={title}>
      <header className="closing-report-header">
        <div>
          <div className="eyebrow"><Lock aria-hidden="true" />{title}</div>
          <Heading className="closing-report-date">{formatDate(day.business_date, { weekday: true })}</Heading>
          <div className="closing-report-sub">
            <StatusBadge tone={DAY_STATUS_TONE[day.status]}>{t(`businessDay.status.${day.status}`)}</StatusBadge>
            {day.closed_at && <span className="text-muted">{t('businessDay.closedAt', { time: formatTime(day.closed_at) })}</span>}
          </div>
        </div>
        <HealthBadge health={board.health} />
      </header>

      {reasons.length > 0 && board.health.status !== 'normal' && (
        <p className={`health-reasons text-${board.health.status === 'critical' ? 'danger' : 'warning'}`}>{reasons.join(' · ')}</p>
      )}
      {day.recount_requested_at && <Alert tone="warning" title={t('businessDay.recountPending', { reason: day.recount_reason || '' })} />}

      <div className="metric-row">
        <Metric size="lg" label={t('businessDay.fig.totalSales')} value={formatRwf(figures.sales.gross)} hint={t('businessDay.transactionsCount', { count: figures.sales.transactions })} />
        <Metric size="lg" label={t('businessDay.fig.variance')} value={formatRwf(variance, { signed: true })} tone={BAND_TONE[closing.variance_band]}
          hint={`${t('businessDay.fig.countedCash')} ${formatRwf(corrected ? corrected.values.counted_cash.corrected : closing.counted_cash)}`} />
      </div>
      {closing.explanation && <blockquote className="closing-quote">“{closing.explanation}”</blockquote>}

      <PeopleList people={people} closed />

      <details className="closing-details" open={!isMobile}>
        <summary>{t('businessDay.fullReport')}</summary>
        <div className="closing-details-grid">
          <div>
            <h3 className="subheading">{t('businessDay.paymentMethods')}</h3>
            <DescriptionList items={[
              ...METHODS.map((m) => ({ label: t(`paymentMethods.${m}`), value: formatRwf(figures.payment_methods[m]) })),
              { label: t('businessDay.fig.refunds'), value: formatRwf(-figures.sales.refunds) },
              { label: t('businessDay.fig.voids'), value: formatNumber(figures.sales.void_count) },
              { label: t('businessDay.fig.netSales'), value: formatRwf(figures.sales.net), strong: true },
            ]} />
          </div>
          <div>
            <h3 className="subheading">{t('businessDay.fig.cash')}</h3>
            <DescriptionList items={[
              { label: t('businessDay.fig.openingFloat'), value: formatRwf(figures.cash.opening_float) },
              { label: t('businessDay.fig.cashSales'), value: formatRwf(figures.cash.cash_sales) },
              { label: t('businessDay.fig.cashRefunds'), value: formatRwf(-figures.cash.cash_refunds) },
              { label: t('businessDay.fig.expectedCash'), value: formatRwf(corrected ? corrected.expected_cash : figures.cash.expected_cash) },
              { label: t('businessDay.fig.countedCash'), value: formatRwf(corrected ? corrected.values.counted_cash.corrected : closing.counted_cash) },
              { label: t('businessDay.fig.variance'), value: formatRwf(variance, { signed: true }), strong: true, tone: BAND_TONE[closing.variance_band] },
            ]} />
            {corrected?.adjusted && <p className="field-hint">{t('businessDay.originalVariance', { value: formatRwf(closing.variance, { signed: true }) })}</p>}
          </div>
          <div>
            <h3 className="subheading">{t('businessDay.fig.inventory')}</h3>
            <DescriptionList items={[
              { label: t('businessDay.fig.lowStock'), value: formatNumber(figures.inventory.low_stock_count), tone: figures.inventory.low_stock_count ? 'warning' : undefined },
              { label: t('businessDay.fig.outOfStock'), value: formatNumber(figures.inventory.out_of_stock_count), tone: figures.inventory.out_of_stock_count ? 'danger' : undefined },
            ]} />
          </div>
          {figures.per_cashier?.length > 0 && (
            <div>
              <h3 className="subheading">{t('businessDay.perCashier')}</h3>
              <DescriptionList items={figures.per_cashier.map((c) => ({
                label: `${c.name} · ${t('businessDay.transactionsCount', { count: c.transactions })}`, value: formatRwf(c.sales),
              }))} />
            </div>
          )}
        </div>

        {board.adjustments?.length > 0 && (
          <div className="adjustments">
            <h3 className="subheading">{t('businessDay.adjustments')}</h3>
            <ul>
              {board.adjustments.map((a) => (
                <li key={a.id}>
                  <strong>{t(`businessDay.fields.${a.field}`)}</strong>{' '}
                  <span className="num">{formatRwf(a.original_value)} → {formatRwf(a.adjusted_value)} ({formatRwf(a.delta, { signed: true })})</span>
                  <div className="field-hint">{t('businessDay.adjustmentBy', { requester: a.requested_by_name, approver: a.approved_by_name })} · {a.reason}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>

      {actions && <div className="panel-footer-actions">{actions}</div>}
    </section>
  );
}

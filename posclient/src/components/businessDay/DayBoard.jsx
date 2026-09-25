import { useTranslation } from 'react-i18next';
import { METHODS, HEALTH_BADGE, rwf, signedRwf, formatDate, formatTime } from './format';

function Person({ label, person }) {
  if (!person?.name) return null;
  return (
    <div className="board-person">
      <span className="board-person-label">{label}</span>
      <span className="board-person-name">{person.name}</span>
      {person.at && <span className="board-person-time">{formatTime(person.at)}</span>}
    </div>
  );
}

function Row({ label, value, strong, tone }) {
  return (
    <div className={`board-row${strong ? ' strong' : ''}`}>
      <span>{label}</span>
      <span className="num" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</span>
    </div>
  );
}

/**
 * One of the two dashboard boards. `board.kind` is 'closed' (Board A, from the
 * stored snapshot) or 'live' (Board B). Both boards show who opened the day
 * and who requested the closing, so everyone can see who worked.
 */
export default function DayBoard({ board, title, children }) {
  const { t } = useTranslation();
  const { day, figures, people } = board;
  const closed = board.kind === 'closed';
  const statusLabel = t(`businessDay.status.${day.status}`);
  const sub = closed
    ? `${statusLabel}${day.closed_at ? ` ${formatTime(day.closed_at)}` : ''}`
    : `${statusLabel} · ${t('businessDay.since', { time: formatTime(day.opened_at) })}`;

  const corrected = board.corrected;
  const variance = closed ? (corrected ? corrected.variance : board.closing.variance) : null;
  // Colour follows the variance band: within tolerance stays neutral
  const varianceTone = { critical: 'danger', attention: 'warn' }[board.closing?.variance_band];

  return (
    <section className={`day-board${closed ? ' closed' : ' live'}`} aria-label={title}>
      <header className="day-board-header">
        <div>
          <div className="day-board-title">{title}</div>
          <div className="day-board-date">{formatDate(day.business_date)}</div>
          <div className="day-board-sub">{sub}</div>
        </div>
        {board.health && (
          <span className={`badge ${HEALTH_BADGE[board.health.status]}`} title={board.health.reasons.map((r) => t(`businessDay.reasons.${r}`, { defaultValue: r })).join(', ')}>
            {t(`businessDay.health.${board.health.status}`)}
          </span>
        )}
      </header>

      <div className="board-people">
        <Person label={t('businessDay.people.openedBy')} person={people.opened_by} />
        <Person label={t('businessDay.people.closingRequestedBy')} person={people.closing_requested_by} />
        {closed && <Person label={t('businessDay.people.submittedBy')} person={people.submitted_by} />}
        {closed && people.acceptance === 'manager' && <Person label={t('businessDay.people.acceptedBy')} person={people.accepted_by} />}
        {closed && people.acceptance === 'auto' && (
          <div className="board-person"><span className="board-person-label">{t('businessDay.people.acceptance')}</span><span>{t('businessDay.autoAccepted')}</span></div>
        )}
        {people.worked?.length > 0 && (
          <div className="board-person worked">
            <span className="board-person-label">{closed ? t('businessDay.people.workedThisDay') : t('businessDay.people.onDutySoFar')}</span>
            <span className="board-person-name">{people.worked.join(', ')}</span>
          </div>
        )}
      </div>

      {day.recount_requested_at && (
        <div className="warn-banner">{t('businessDay.recountPending', { reason: day.recount_reason || '' })}</div>
      )}

      <div className="board-section">
        <Row label={closed ? t('businessDay.fig.totalSales') : t('businessDay.fig.salesSoFar')} value={rwf(figures.sales.gross)} strong />
        <Row label={t('businessDay.fig.transactions')} value={figures.sales.transactions} />
        {METHODS.map((m) => <Row key={m} label={t(`paymentMethods.${m}`)} value={rwf(figures.payment_methods[m])} />)}
        <Row label={t('businessDay.fig.refunds')} value={figures.sales.refunds ? `−${rwf(figures.sales.refunds)}` : rwf(0)} />
        <Row label={t('businessDay.fig.voids')} value={figures.sales.void_count} />
        <Row label={t('businessDay.fig.netSales')} value={rwf(figures.sales.net)} strong />
      </div>

      <div className="board-section">
        <div className="board-section-title">{t('businessDay.fig.cash')}</div>
        <Row label={t('businessDay.fig.openingFloat')} value={rwf(figures.cash.opening_float)} />
        <Row label={t('businessDay.fig.expectedCash')} value={rwf(corrected ? corrected.expected_cash : figures.cash.expected_cash)} />
        {closed && <Row label={t('businessDay.fig.countedCash')} value={rwf(corrected ? corrected.values.counted_cash.corrected : board.closing.counted_cash)} />}
        {closed && <Row label={t('businessDay.fig.variance')} value={signedRwf(variance)} strong tone={varianceTone} />}
        {closed && board.closing.explanation && <p className="board-note">“{board.closing.explanation}”</p>}
        {closed && corrected?.adjusted && (
          <p className="board-note">{t('businessDay.originalVariance', { value: signedRwf(board.closing.variance) })}</p>
        )}
      </div>

      {closed && board.adjustments?.length > 0 && (
        <div className="board-section">
          <div className="board-section-title">{t('businessDay.adjustments')}</div>
          {board.adjustments.map((a) => (
            <div key={a.id} className="board-adjustment">
              <strong>{t(`businessDay.fields.${a.field}`)}</strong>: {rwf(a.original_value)} → {rwf(a.adjusted_value)} ({signedRwf(a.delta)})
              <div className="hint">{t('businessDay.adjustmentBy', { requester: a.requested_by_name, approver: a.approved_by_name })} · {a.reason}</div>
            </div>
          ))}
        </div>
      )}

      <div className="board-section">
        <div className="board-section-title">{t('businessDay.fig.inventory')}</div>
        <Row label={t('businessDay.fig.lowStock')} value={figures.inventory.low_stock_count} tone={figures.inventory.low_stock_count ? 'warn' : undefined} />
        <Row label={t('businessDay.fig.outOfStock')} value={figures.inventory.out_of_stock_count} tone={figures.inventory.out_of_stock_count ? 'danger' : undefined} />
      </div>

      {figures.per_cashier && figures.per_cashier.length > 0 && (
        <div className="board-section">
          <div className="board-section-title">{t('businessDay.perCashier')}</div>
          {figures.per_cashier.map((c) => (
            <Row key={c.user_id} label={`${c.name} (${c.transactions})`} value={rwf(c.sales)} />
          ))}
        </div>
      )}

      {children && <div className="board-actions">{children}</div>}
    </section>
  );
}

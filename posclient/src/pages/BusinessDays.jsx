import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import DayBoard from '../components/businessDay/DayBoard';
import { HEALTH_BADGE, rwf, signedRwf, formatDate } from '../components/businessDay/format';
import { humanizeType } from '../utils/notificationDisplay';

const BAND_BADGE = { normal: 'paid', attention: 'partial', critical: 'unpaid' };

/** /business-days - every business day (managers only; enforced by the API). */
export function BusinessDayHistory() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/business-days', { params: { page } }).then(({ data: d }) => setData(d)).catch((err) => setError(err.message));
  }, [page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{t('businessDay.history')}</h1>
        <Link className="btn" to="/">{t('businessDay.backToDashboard')}</Link>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {data && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('businessDay.businessDate')}</th>
              <th>{t('common.status')}</th>
              <th>{t('businessDay.people.openedBy')}</th>
              <th>{t('businessDay.people.submittedBy')}</th>
              <th>{t('businessDay.fig.netSales')}</th>
              <th>{t('businessDay.fig.variance')}</th>
              <th>{t('businessDay.corrections')}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((d) => (
              <tr key={d.id}>
                <td><Link to={`/business-days/${d.id}`}>{formatDate(d.business_date)}</Link></td>
                <td>
                  {t(`businessDay.status.${d.status}`)}
                  {d.reopened_count > 0 && <span className="badge unpaid" style={{ marginLeft: 6 }}>{t('businessDay.reopenedTimes', { count: d.reopened_count })}</span>}
                </td>
                <td>{d.opened_by_name || '—'}</td>
                <td>{d.submitted_by_name || '—'}</td>
                <td className="num">{d.net_sales === null ? '—' : rwf(d.net_sales)}</td>
                <td>{d.variance === null ? '—' : <span className={`badge ${BAND_BADGE[d.variance_band]}`}>{signedRwf(d.variance)}</span>}</td>
                <td>
                  {d.pending_corrections > 0 && <span className="badge partial">{t('businessDay.pendingCorrections', { count: d.pending_corrections })}</span>}
                  {d.adjustments > 0 && <span className="hint"> {t('businessDay.adjustmentsCount', { count: d.adjustments })}</span>}
                </td>
              </tr>
            ))}
            {data.items.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--ink-muted)' }}>{t('businessDay.noClosingYet')}</td></tr>}
          </tbody>
        </table>
      )}
      {pages > 1 && (
        <div className="pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('common.previous')}</button>
          <span className="num">{t('common.pageOf', { page, pages })}</span>
          <button className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('common.next')}</button>
        </div>
      )}
    </div>
  );
}

function timelineLabel(item, t) {
  if (item.kind === 'event') return t(`notificationTypes.${item.code}`, { defaultValue: humanizeType(item.code) });
  return t(`businessDay.timeline.${item.code.replace(/\./g, '_')}`, { defaultValue: item.code });
}

/** /business-days/:id - one day's board, closing versions and accountability timeline. */
export function BusinessDayDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [board, setBoard] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([client.get(`/business-days/${id}`), client.get(`/business-days/${id}/timeline`)])
      .then(([b, tl]) => {
        setBoard(b.data);
        setTimeline(tl.data.items);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{board ? formatDate(board.day.business_date) : t('businessDay.history')}</h1>
        <Link className="btn" to="/business-days">{t('businessDay.history')}</Link>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="boards">
        {board && <DayBoard board={board} title={board.kind === 'live' ? t('businessDay.today') : t('businessDay.closingReport')} />}
        <section className="day-board">
          <div className="day-board-title">{t('businessDay.timeline.title')}</div>
          {board?.health && (
            <p>
              <span className={`badge ${HEALTH_BADGE[board.health.status]}`}>{t(`businessDay.health.${board.health.status}`)}</span>{' '}
              <span className="hint">{board.health.reasons.map((r) => t(`businessDay.reasons.${r}`, { defaultValue: r })).join(' · ')}</span>
            </p>
          )}
          {board?.versions?.length > 1 && (
            <div className="board-section">
              <div className="board-section-title">{t('businessDay.versions')}</div>
              {board.versions.map((v) => (
                <div key={v.id} className="board-row">
                  <span>v{v.version} · {v.submitted_by_name} · {new Date(v.submitted_at).toLocaleString()}</span>
                  <span className="num">{signedRwf(v.variance)}</span>
                </div>
              ))}
            </div>
          )}
          <ol className="timeline">
            {(timeline || []).map((item) => (
              <li key={item.id} className={`timeline-item ${item.severity || item.result || ''}`}>
                <span className="timeline-time num">{new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="timeline-text">
                  <strong>{timelineLabel(item, t)}</strong>
                  {item.actor_name && <span className="hint"> · {item.actor_name}</span>}
                  {item.entity_type && item.entity_type !== 'business_day' && <span className="hint"> · {item.entity_type} #{item.entity_id}</span>}
                  {item.occurrences > 1 && <span className="hint"> · ×{item.occurrences}</span>}
                </span>
              </li>
            ))}
            {timeline && timeline.length === 0 && <li className="hint">{t('businessDay.timeline.empty')}</li>}
          </ol>
        </section>
      </div>
    </div>
  );
}

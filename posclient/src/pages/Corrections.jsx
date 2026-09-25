import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { ReasonDialog } from '../components/businessDay/Dialogs';
import { rwf, formatDate } from '../components/businessDay/format';

const STATUS_BADGE = { pending: 'partial', approved: 'paid', rejected: 'unpaid' };

// Reviewers (day.review) see every request and decide them - never their own.
// Everyone else sees only the requests they made.
export default function Corrections() {
  const { t } = useTranslation();
  const { hasPermission, user } = useAuth();
  const { version } = useNotifications();
  const canReview = hasPermission('day.review');
  const [status, setStatus] = useState(canReview ? 'pending' : '');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [deciding, setDeciding] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows((await client.get('/corrections', { params: status ? { status } : {} })).data);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load, version]);

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{canReview ? t('businessDay.correctionsReview') : t('businessDay.myCorrections')}</h1>
        <Link className="btn" to="/">{t('businessDay.backToDashboard')}</Link>
      </div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {['pending', 'approved', 'rejected', ''].map((s) => (
          <button key={s || 'all'} className={`tab${status === s ? ' active' : ''}`} onClick={() => setStatus(s)}>
            {s ? t(`businessDay.correctionStatus.${s}`) : t('admin.deliveries.all')}
          </button>
        ))}
      </div>
      {error && <div className="error-banner">{error}</div>}

      <table className="data-table">
        <thead>
          <tr>
            <th>{t('businessDay.businessDate')}</th>
            <th>{t('businessDay.correction.field')}</th>
            <th>{t('businessDay.correction.change')}</th>
            <th>{t('businessDay.correction.reason')}</th>
            <th>{t('businessDay.correction.requestedBy')}</th>
            <th>{t('common.status')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDate(r.business_date)}</td>
              <td>{t(`businessDay.fields.${r.field}`)}</td>
              <td className="num">{rwf(r.original_value)} → {rwf(r.requested_value)}</td>
              <td style={{ fontSize: 13 }}>{r.reason}{r.explanation && <div className="hint">{r.explanation}</div>}</td>
              <td>{r.requested_by_name}<div className="hint">{new Date(r.requested_at).toLocaleString()}</div></td>
              <td>
                <span className={`badge ${STATUS_BADGE[r.status]}`}>{t(`businessDay.correctionStatus.${r.status}`)}</span>
                {r.reviewed_by_name && <div className="hint">{r.reviewed_by_name}{r.review_reason ? `: ${r.review_reason}` : ''}</div>}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {canReview && r.status === 'pending' && r.requested_by !== user.id && (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => setDeciding({ row: r, decision: 'approve' })}>{t('businessDay.correction.approve')}</button>
                    <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => setDeciding({ row: r, decision: 'reject' })}>{t('businessDay.correction.reject')}</button>
                  </>
                )}
                {canReview && r.status === 'pending' && r.requested_by === user.id && <span className="hint">{t('businessDay.correction.ownRequest')}</span>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--ink-muted)' }}>{t('businessDay.correction.none')}</td></tr>}
        </tbody>
      </table>

      {deciding && (
        <ReasonDialog
          title={deciding.decision === 'approve' ? t('businessDay.correction.approveTitle') : t('businessDay.correction.rejectTitle')}
          hint={`${t(`businessDay.fields.${deciding.row.field}`)}: ${rwf(deciding.row.original_value)} → ${rwf(deciding.row.requested_value)}`}
          label={t('businessDay.review.reason')}
          required={deciding.decision === 'reject'}
          minLength={deciding.decision === 'reject' ? 5 : 0}
          danger={deciding.decision === 'reject'}
          confirmLabel={deciding.decision === 'approve' ? t('businessDay.correction.approve') : t('businessDay.correction.reject')}
          onClose={() => setDeciding(null)}
          onSubmit={async (reason) => {
            await client.post(`/corrections/${deciding.row.id}/decision`, { decision: deciding.decision, reason });
            setDeciding(null);
            load();
          }}
        />
      )}
    </div>
  );
}

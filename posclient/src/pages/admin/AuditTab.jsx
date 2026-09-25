import { Fragment, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';

const PAGE_SIZE = 50;
const EMPTY = { action: '', role: '', result: '', entity_type: '', entity_id: '', ip: '', user_id: '', from: '', to: '', q: '' };

function JsonBlock({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <strong>{label}</strong>
      <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export default function AuditTab() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  const params = useCallback(() => Object.fromEntries(Object.entries(applied).filter(([, v]) => v !== '')), [applied]);

  const load = useCallback(async () => {
    try {
      setData((await client.get('/admin/audit-logs', { params: { ...params(), page, limit: PAGE_SIZE } })).data);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [params, page]);

  useEffect(() => {
    load();
  }, [load]);

  function apply(e) {
    e.preventDefault();
    setApplied(filters);
    setPage(1);
  }

  async function exportCsv() {
    try {
      const res = await client.get('/admin/audit-logs/export', { params: params(), responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  const set = (key) => (e) => setFilters({ ...filters, [key]: e.target.value });
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <p className="hint-text">{t('admin.audit.intro')}</p>
      <form className="filter-grid" onSubmit={apply}>
        <select value={filters.action} onChange={set('action')} aria-label={t('admin.audit.action')}>
          <option value="">{t('admin.audit.anyAction')}</option>
          {(data?.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filters.role} onChange={set('role')} aria-label={t('admin.audit.role')}>
          <option value="">{t('admin.audit.anyRole')}</option>
          {['cashier', 'store_keeper', 'store_manager'].map((r) => <option key={r} value={r}>{t(`roles.${r}`, { defaultValue: r })}</option>)}
        </select>
        <select value={filters.result} onChange={set('result')} aria-label={t('admin.audit.result')}>
          <option value="">{t('admin.audit.anyResult')}</option>
          {['success', 'denied', 'failure'].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input placeholder={t('admin.audit.userId')} value={filters.user_id} onChange={set('user_id')} inputMode="numeric" />
        <input placeholder={t('admin.audit.entityType')} value={filters.entity_type} onChange={set('entity_type')} />
        <input placeholder={t('admin.audit.entityId')} value={filters.entity_id} onChange={set('entity_id')} />
        <input placeholder="IP" value={filters.ip} onChange={set('ip')} />
        <input placeholder={t('admin.audit.search')} value={filters.q} onChange={set('q')} />
        <input type="date" value={filters.from} onChange={set('from')} aria-label={t('admin.audit.from')} />
        <input type="date" value={filters.to} onChange={set('to')} aria-label={t('admin.audit.to')} />
        <button type="submit" className="btn btn-primary">{t('admin.audit.apply')}</button>
        <button type="button" className="btn" onClick={exportCsv}>{t('admin.audit.export')}</button>
      </form>

      {error && <div className="error-banner">{error}</div>}
      {data && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('common.date')}</th>
              <th>{t('admin.audit.actor')}</th>
              <th>{t('admin.audit.action')}</th>
              <th>{t('admin.audit.entity')}</th>
              <th>{t('admin.audit.result')}</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <Fragment key={r.id}>
                <tr className="clickable" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.actor_name || (r.actor_user_id ? `#${r.actor_user_id}` : '—')}<div className="hint">{r.actor_role || ''}</div></td>
                  <td><code>{r.action}</code></td>
                  <td>{r.entity_type ? `${r.entity_type} ${r.entity_id ?? ''}` : '—'}</td>
                  <td><span className={`badge ${r.result === 'success' ? 'paid' : 'unpaid'}`}>{r.result}</span></td>
                  <td>{r.ip || '—'}</td>
                </tr>
                {expanded === r.id && (
                  <tr key={`${r.id}-detail`}>
                    <td colSpan={6} style={{ background: 'var(--surface)', fontSize: 13 }}>
                      <div><strong>{t('admin.audit.requestId')}:</strong> <code>{r.request_id || '—'}</code></div>
                      <div><strong>{t('admin.audit.userAgent')}:</strong> {r.user_agent || '—'}</div>
                      <JsonBlock label={t('admin.audit.oldValues')} value={r.old_values} />
                      <JsonBlock label={t('admin.audit.newValues')} value={r.new_values} />
                      <JsonBlock label={t('admin.audit.metadata')} value={r.metadata} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {data.items.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--ink-muted)' }}>{t('admin.audit.empty')}</td></tr>}
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
    </>
  );
}

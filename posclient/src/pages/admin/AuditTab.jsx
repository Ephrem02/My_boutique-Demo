import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Filter, ShieldCheck } from 'lucide-react';
import client from '../../api/client';
import Button from '../../ui/Button';
import Dialog from '../../ui/Dialog';
import { Field, Input, Select } from '../../ui/Field';
import { DescriptionList, ErrorState, StatusBadge } from '../../ui/display';
import DataTable from '../../ui/DataTable';
import { formatDateTime, formatWhen } from '../../ui/format';
import AdminSection from './AdminSection';

const EMPTY = { action: '', role: '', result: '', entity_type: '', entity_id: '', ip: '', user_id: '', from: '', to: '', q: '' };
const RESULT_TONE = { success: 'success', denied: 'warning', failure: 'danger' };

function JsonBlock({ label, value }) {
  if (!value) return null;
  return (
    <div className="json-section">
      <div className="form-section-title">{label}</div>
      <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export default function AuditTab() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [exportError, setExportError] = useState(null);

  const params = useCallback(() => Object.fromEntries(Object.entries(applied).filter(([, v]) => v !== '')), [applied]);

  const load = useCallback(async () => {
    try {
      setData((await client.get('/admin/audit-logs', { params: { ...params(), limit: 200 } })).data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  async function exportCsv() {
    setExportError(null);
    try {
      const res = await client.get('/admin/audit-logs/export', { params: params(), responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err);
    }
  }

  const set = (key) => (e) => setFilters({ ...filters, [key]: e.target.value });
  const columns = [
    { key: 'created_at', header: t('common.date'), mobile: 'subtitle', render: (r) => formatWhen(r.created_at, t) },
    { key: 'actor', header: t('admin.audit.actor'), render: (r) => <span className="cell-stack"><span>{r.actor_name || (r.actor_user_id ? `#${r.actor_user_id}` : t('admin.audit.system'))}</span><span className="cell-note">{r.actor_role || ''}</span></span> },
    { key: 'action', header: t('admin.audit.action'), mobile: 'title', render: (r) => <code>{r.action}</code> },
    { key: 'entity', header: t('admin.audit.entity'), render: (r) => (r.entity_type ? `${r.entity_type} ${r.entity_id ?? ''}` : '—') },
    { key: 'result', header: t('admin.audit.result'), mobile: 'meta', render: (r) => <StatusBadge tone={RESULT_TONE[r.result]}>{t(`admin.audit.results.${r.result}`)}</StatusBadge> },
    { key: 'ip', header: 'IP', render: (r) => <span className="num">{r.ip || '—'}</span> },
  ];

  return (
    <AdminSection title={t('admin.sections.audit.title')} description={t('admin.audit.intro')}
      actions={<Button icon={Download} onClick={exportCsv}>{t('admin.audit.export')}</Button>}>
      {exportError && <ErrorState error={exportError} action={t('errors.actions.export')} />}
      <form className="panel filter-panel" onSubmit={(e) => { e.preventDefault(); setApplied(filters); }}>
        <div className="filter-grid">
          <Field label={t('admin.audit.action')}>
            <Select value={filters.action} onChange={set('action')}>
              <option value="">{t('admin.audit.anyAction')}</option>
              {(data?.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </Field>
          <Field label={t('admin.audit.role')}>
            <Select value={filters.role} onChange={set('role')}>
              <option value="">{t('admin.audit.anyRole')}</option>
              {['cashier', 'store_keeper', 'store_manager'].map((r) => <option key={r} value={r}>{t(`roles.${r}`, { defaultValue: r })}</option>)}
            </Select>
          </Field>
          <Field label={t('admin.audit.result')}>
            <Select value={filters.result} onChange={set('result')}>
              <option value="">{t('admin.audit.anyResult')}</option>
              {['success', 'denied', 'failure'].map((r) => <option key={r} value={r}>{t(`admin.audit.results.${r}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('admin.audit.userId')}><Input inputMode="numeric" value={filters.user_id} onChange={set('user_id')} /></Field>
          <Field label={t('admin.audit.entityType')}><Input value={filters.entity_type} onChange={set('entity_type')} /></Field>
          <Field label={t('admin.audit.entityId')}><Input value={filters.entity_id} onChange={set('entity_id')} /></Field>
          <Field label="IP"><Input value={filters.ip} onChange={set('ip')} /></Field>
          <Field label={t('admin.audit.search')}><Input value={filters.q} onChange={set('q')} /></Field>
          <Field label={t('admin.audit.from')}><Input type="date" value={filters.from} onChange={set('from')} /></Field>
          <Field label={t('admin.audit.to')}><Input type="date" value={filters.to} onChange={set('to')} /></Field>
        </div>
        <div className="panel-footer-actions">
          <Button variant="ghost" onClick={() => { setFilters(EMPTY); setApplied(EMPTY); }}>{t('admin.audit.clear')}</Button>
          <Button type="submit" variant="primary" icon={Filter}>{t('admin.audit.apply')}</Button>
        </div>
      </form>

      <DataTable caption={t('admin.sections.audit.title')} columns={columns} rows={data?.items} loading={!data} error={error} onRetry={load}
        onRowClick={setDetail} rowLabel={(r) => t('admin.audit.openEntry', { action: r.action })} pageSize={50}
        empty={{ icon: ShieldCheck, title: t('admin.audit.empty') }} />
      {data && data.total > data.items.length && <p className="field-hint">{t('admin.audit.showingLatest', { shown: data.items.length, total: data.total })}</p>}

      {detail && (
        <Dialog title={detail.action} description={formatDateTime(detail.created_at)} size="lg" onClose={() => setDetail(null)}>
          <DescriptionList items={[
            { label: t('admin.audit.actor'), value: `${detail.actor_name || (detail.actor_user_id ? `#${detail.actor_user_id}` : t('admin.audit.system'))}${detail.actor_role ? ` · ${detail.actor_role}` : ''}` },
            { label: t('admin.audit.entity'), value: detail.entity_type ? `${detail.entity_type} ${detail.entity_id ?? ''}` : '—' },
            { label: t('admin.audit.result'), value: <StatusBadge tone={RESULT_TONE[detail.result]}>{t(`admin.audit.results.${detail.result}`)}</StatusBadge> },
            { label: 'IP', value: detail.ip || '—' },
            { label: t('admin.audit.requestId'), value: <code>{detail.request_id || '—'}</code> },
            { label: t('admin.audit.userAgent'), value: detail.user_agent || '—' },
          ]} />
          <JsonBlock label={t('admin.audit.oldValues')} value={detail.old_values} />
          <JsonBlock label={t('admin.audit.newValues')} value={detail.new_values} />
          <JsonBlock label={t('admin.audit.metadata')} value={detail.metadata} />
        </Dialog>
      )}
    </AdminSection>
  );
}

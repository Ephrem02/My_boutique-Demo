import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, Plus, Truck } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { KIND, CLIENT_TYPES, PARTY_STATUSES, STATUS_TONE, PartyFormDialog } from '../components/parties';
import { PageHeader, Panel, StatusBadge } from '../ui/display';
import DataTable from '../ui/DataTable';
import Button from '../ui/Button';
import { Select } from '../ui/Field';
import { useToast } from '../ui/Toast';
import { formatRwf } from '../ui/format';

/** Suppliers and clients: list + who we owe / who owes us. */
export default function PartiesPage({ kind }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const cfg = KIND[kind];
  const [parties, setParties] = useState(null);
  const [unpaid, setUnpaid] = useState([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const navigate = useNavigate();
  const profilePath = (partyId) => `/${kind === 'supplier' ? 'suppliers' : 'institutions'}/${partyId}`;
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data }, unpaidRes] = await Promise.all([
        client.get(cfg.endpoint, { params: { ...(kind === 'institution' && typeFilter && { type: typeFilter }), ...(statusFilter && { status: statusFilter }) } }),
        hasPermission(cfg.unpaidView) ? client.get(cfg.unpaidEndpoint) : Promise.resolve(null),
      ]);
      setParties(data);
      setUnpaid(unpaidRes ? unpaidRes.data : []);
      setError(null);
    } catch (err) {
      setError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, typeFilter, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const owedTotal = unpaid.reduce((s, u) => s + Number(u.balance_due), 0);
  const columns = [
    { key: 'name', header: t('common.name'), sortable: true, mobile: 'title' },
    kind === 'institution' && {
      key: 'type', header: t('institutions.type'), sortable: true, mobile: 'meta',
      render: (p) => <StatusBadge tone="neutral" dot={false}>{t(`institutions.types.${p.type}`, { defaultValue: p.type })}</StatusBadge>,
    },
    kind === 'supplier' && { key: 'category', header: t('profile.category'), sortable: true, mobile: 'meta', render: (p) => p.category || '—' },
    {
      key: 'status', header: t('profile.status'), sortable: true, mobile: 'meta',
      render: (p) => <StatusBadge tone={STATUS_TONE[p.status]}>{t(`profile.statuses.${p.status}`)}</StatusBadge>,
    },
    { key: 'contact', header: t('common.contact'), mobile: 'subtitle', render: (p) => p.contact_person || p.contact_phone || p.contact_email || '—', searchValue: (p) => `${p.contact_person || ''} ${p.contact_phone || ''} ${p.alt_phone || ''} ${p.contact_email || ''} ${p.district || ''} ${p.city || ''}` },
    { key: 'payment_terms', header: t('common.paymentTerms'), render: (p) => <span className="text-secondary">{p.payment_terms || '—'}</span> },
    unpaid.length > 0 && {
      key: 'balance', header: t(`${cfg.ns}.balanceHeader`), align: 'right', mobile: 'value', sortable: true,
      sortValue: (p) => Number(unpaid.find((u) => u[cfg.unpaidKey] === p.id)?.balance_due || 0),
      render: (p) => {
        const u = unpaid.find((x) => x[cfg.unpaidKey] === p.id);
        return u ? <span className="text-danger">{formatRwf(u.balance_due)}</span> : <span className="text-muted">—</span>;
      },
    },
  ].filter(Boolean);

  const Icon = kind === 'supplier' ? Truck : Building2;
  return (
    <div className="page">
      <PageHeader
        title={t(`${cfg.ns}.title`)}
        subtitle={t(`${cfg.ns}.subtitle`)}
        actions={hasPermission(cfg.manage) && <Button variant="primary" icon={Plus} onClick={() => setShowCreate(true)}>{t(`${cfg.ns}.new`)}</Button>}
      />

      {unpaid.length > 0 && (
        <Panel className="owed-panel" title={t(`${cfg.ns}.owedTitle`)} subtitle={t(`${cfg.ns}.owedSubtitle`, { total: formatRwf(owedTotal) })}>
          <ul className="owed-list">
            {unpaid.slice(0, 6).map((u) => (
              <li key={u[cfg.unpaidKey]}>
                <button type="button" className="owed-item" onClick={() => navigate(profilePath(u[cfg.unpaidKey]))}>
                  <span className="owed-name">{u[cfg.unpaidName]}</span>
                  <span className="owed-amount num">{formatRwf(u.balance_due)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <DataTable
        caption={t(`${cfg.ns}.title`)}
        columns={columns}
        rows={parties}
        loading={!parties}
        error={error}
        onRetry={load}
        searchable
        searchPlaceholder={t(`${cfg.ns}.search`)}
        initialSort={{ key: 'name', dir: 'asc' }}
        onRowClick={(p) => navigate(profilePath(p.id))}
        rowLabel={(p) => t('common.openNamed', { name: p.name })}
        toolbar={(
          <>
            {kind === 'institution' && (
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label={t('institutions.type')} className="filter-select">
                <option value="">{t('institutions.allTypes')}</option>
                {CLIENT_TYPES.map((ct) => <option key={ct} value={ct}>{t(`institutions.types.${ct}`)}</option>)}
              </Select>
            )}
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t('profile.status')} className="filter-select">
              <option value="">{t('profile.allStatuses')}</option>
              {PARTY_STATUSES[kind].map((st) => <option key={st} value={st}>{t(`profile.statuses.${st}`)}</option>)}
            </Select>
          </>
        )}
        empty={{
          icon: Icon,
          title: t(`${cfg.ns}.none`),
          description: t(`${cfg.ns}.noneHint`),
          action: hasPermission(cfg.manage) ? <Button variant="primary" icon={Plus} onClick={() => setShowCreate(true)}>{t(`${cfg.ns}.new`)}</Button> : null,
        }}
      />

      {showCreate && (
        <PartyFormDialog kind={kind} onClose={() => setShowCreate(false)}
          onCreated={(p) => { setShowCreate(false); toast.success(t(`${cfg.ns}.created`, { name: p.name })); navigate(profilePath(p.id)); }} />
      )}
    </div>
  );
}

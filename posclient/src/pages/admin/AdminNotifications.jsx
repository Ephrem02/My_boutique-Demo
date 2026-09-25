import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import OverviewTab from './OverviewTab';
import RulesTab from './RulesTab';
import TemplatesTab from './TemplatesTab';
import EmailTab from './EmailTab';
import DeliveriesTab from './DeliveriesTab';
import AuditTab from './AuditTab';
import SendTab from './SendTab';
import ClosingTab from './ClosingTab';

// Tabs are filtered by permission for convenience only - every endpoint
// behind them enforces the same permission on the server.
const TABS = [
  { id: 'overview', permission: 'notifications.manage', Component: OverviewTab },
  { id: 'rules', permission: 'notifications.manage', Component: RulesTab },
  { id: 'templates', permission: 'notifications.manage', Component: TemplatesTab },
  { id: 'send', permission: 'notifications.manage', Component: SendTab },
  { id: 'email', permission: 'settings.manage', Component: EmailTab },
  { id: 'closing', permission: 'settings.manage', Component: ClosingTab },
  { id: 'deliveries', permission: 'notifications.deliveries.manage', Component: DeliveriesTab },
  { id: 'audit', permission: 'audit.view', Component: AuditTab },
];

export default function AdminNotifications() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((tab) => hasPermission(tab.permission));
  const active = tabs.find((tab) => tab.id === params.get('tab')) || tabs[0];

  if (!active) return <div className="page-body"><p>{t('admin.noAccess')}</p></div>;
  const { Component } = active;

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{t('admin.title')}</h1>
      </div>
      <div className="tabs" role="tablist" style={{ marginBottom: 20 }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === active.id}
            className={`tab${tab.id === active.id ? ' active' : ''}`}
            onClick={() => setParams({ tab: tab.id })}
          >
            {t(`admin.tabs.${tab.id}`)}
          </button>
        ))}
      </div>
      <Component />
    </div>
  );
}

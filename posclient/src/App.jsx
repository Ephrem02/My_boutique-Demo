import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import RequirePermission from './components/RequirePermission';
import LoginPage from './pages/LoginPage';
import POSPage from './pages/POSPage';
import Suppliers from './pages/Suppliers';
import Institutions from './pages/Institutions';
import Products from './pages/Products';
import Stock from './pages/Stock';
import SalesHistory from './pages/SalesHistory';
import Employees from './pages/Employees';
import Reports from './pages/Reports';
import Finance from './pages/Finance';
import Notifications from './pages/Notifications';
import Settings from './pages/Settings';
import Dashboard from './pages/Dashboard';
import Corrections from './pages/Corrections';
import { BusinessDayHistory, BusinessDayDetail } from './pages/BusinessDays';
import AdminLayout, { AdminHome } from './pages/admin/AdminLayout';
import OverviewTab from './pages/admin/OverviewTab';
import RulesTab from './pages/admin/RulesTab';
import TemplatesTab from './pages/admin/TemplatesTab';
import SendTab from './pages/admin/SendTab';
import EmailTab from './pages/admin/EmailTab';
import DeliveriesTab from './pages/admin/DeliveriesTab';
import AuditTab from './pages/admin/AuditTab';
import ClosingTab from './pages/admin/ClosingTab';
import { ADMIN_PERMISSIONS } from './navigation';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Old "?tab=" admin links (bookmarks, notifications) map to the new routes.
const LEGACY_ADMIN_TABS = {
  overview: '/admin/monitoring', rules: '/admin/notifications/rules', templates: '/admin/notifications/templates',
  send: '/admin/notifications/send', email: '/admin/email', closing: '/admin/closing', deliveries: '/admin/deliveries', audit: '/admin/audit',
};
function LegacyAdminRedirect() {
  const [params] = useSearchParams();
  return <Navigate to={LEGACY_ADMIN_TABS[params.get('tab')] || '/admin/notifications/rules'} replace />;
}

const guard = (anyOf, element) => <RequirePermission anyOf={anyOf}>{element}</RequirePermission>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/pos" element={guard(['sales.create'], <POSPage />)} />
        <Route path="/sales-history" element={guard(['sales.view'], <SalesHistory />)} />
        <Route path="/suppliers" element={guard(['suppliers.view'], <Suppliers />)} />
        <Route path="/institutions" element={guard(['institutions.view'], <Institutions />)} />
        <Route path="/products" element={guard(['products.view'], <Products />)} />
        <Route path="/stock" element={guard(['stock.view'], <Stock />)} />
        <Route path="/reports" element={guard(['reports.sales.view', 'reports.shrinkage.view', 'reports.financial.view'], <Reports />)} />
        <Route path="/finance" element={guard(['reports.financial.view'], <Finance />)} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/closing/corrections" element={guard(['day.corrections.request', 'day.review'], <Corrections />)} />
        <Route path="/business-days" element={guard(['day.history.view'], <BusinessDayHistory />)} />
        <Route path="/business-days/:id" element={guard(['day.history.view'], <BusinessDayDetail />)} />

        <Route path="/admin" element={guard(ADMIN_PERMISSIONS, <AdminLayout />)}>
          <Route index element={<AdminHome />} />
          <Route path="monitoring" element={guard(['notifications.manage'], <OverviewTab />)} />
          <Route path="closing" element={guard(['settings.manage'], <ClosingTab />)} />
          <Route path="users" element={guard(['employees.manage'], <Employees />)} />
          <Route path="notifications" element={<LegacyAdminRedirect />} />
          <Route path="notifications/rules" element={guard(['notifications.manage'], <RulesTab />)} />
          <Route path="notifications/templates" element={guard(['notifications.manage'], <TemplatesTab />)} />
          <Route path="notifications/send" element={guard(['notifications.manage'], <SendTab />)} />
          <Route path="email" element={guard(['settings.manage'], <EmailTab />)} />
          <Route path="deliveries" element={guard(['notifications.deliveries.manage'], <DeliveriesTab />)} />
          <Route path="audit" element={guard(['audit.view'], <AuditTab />)} />
        </Route>

        {/* Old URLs */}
        <Route path="/employees" element={<Navigate to="/admin/users" replace />} />
        <Route path="/notifications/settings" element={<Navigate to="/settings?section=notifications" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

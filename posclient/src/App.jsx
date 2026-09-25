import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import POSPage from './pages/POSPage';
import Suppliers from './pages/Suppliers';
import Institutions from './pages/Institutions';
import Products from './pages/Products';
import Stock from './pages/Stock';
import SalesHistory from './pages/SalesHistory';
import Employees from './pages/Employees';
import Reports from './pages/Reports';
import Notifications from './pages/Notifications';
import NotificationPreferences from './pages/NotificationPreferences';
import AdminNotifications from './pages/admin/AdminNotifications';
import RequirePermission from './components/RequirePermission';

const ADMIN_PERMISSIONS = ['notifications.manage', 'notifications.deliveries.manage', 'settings.manage', 'audit.view'];

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<POSPage />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/institutions" element={<Institutions />} />
        <Route path="/products" element={<Products />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/sales-history" element={<SalesHistory />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/notifications/settings" element={<NotificationPreferences />} />
        <Route
          path="/admin/notifications"
          element={
            <RequirePermission anyOf={ADMIN_PERMISSIONS}>
              <AdminNotifications />
            </RequirePermission>
          }
        />
      </Route>
    </Routes>
  );
}

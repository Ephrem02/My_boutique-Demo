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

function ProtectedRoute({ children }) {
  const { user } = useAuth();
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
      </Route>
    </Routes>
  );
}

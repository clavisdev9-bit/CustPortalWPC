import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import OtpLoginPage from './pages/OtpLoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import TwoFactorPage from './pages/TwoFactorPage';
import SsoCallbackPage from './pages/SsoCallbackPage';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
import SecurityPage from './pages/SecurityPage';
import CompanyProfilePage from './pages/CompanyProfilePage';
import AddressesPage from './pages/AddressesPage';
import ContactsPage from './pages/ContactsPage';
import QuotationsPage from './pages/QuotationsPage';
import OrdersPage from './pages/OrdersPage';
import InvoicesPage from './pages/InvoicesPage';
import DeliveriesPage from './pages/DeliveriesPage';
import ShipmentTrackingPage from './pages/ShipmentTrackingPage';
import ShipmentDetailPage from './pages/ShipmentDetailPage';
import VesselSchedulePage from './pages/VesselSchedulePage';
import VesselScheduleDetailPage from './pages/VesselScheduleDetailPage';
import LclCapacityPage from './pages/LclCapacityPage';
import AirSchedulePage from './pages/AirSchedulePage';
import RequestsPage from './pages/RequestsPage';
import DocumentsPage from './pages/DocumentsPage';
import ProductsPage from './pages/ProductsPage';
import TicketsPage from './pages/TicketsPage';
import RmaPage from './pages/RmaPage';
import WarrantyPage from './pages/WarrantyPage';
import MaintenancePage from './pages/MaintenancePage';
import EquipmentPage from './pages/EquipmentPage';
import DueReplacementsPage from './pages/DueReplacementsPage';
import SubscriptionsPage from './pages/SubscriptionsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import AssistantAdminPage from './pages/AssistantAdminPage';
import OdooConnectionSettingsPage from './pages/OdooConnectionSettingsPage';
import AiProviderSettingsPage from './pages/AiProviderSettingsPage';
import AppShell from './components/AppShell';

function ProtectedRoute({ children }) {
  const { status } = useAuth();
  if (status === 'loading' || status === 'idle') return <div className="full-page-loader">Loading...</div>;
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { status } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={status === 'authenticated' ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/otp-login" element={status === 'authenticated' ? <Navigate to="/" replace /> : <OtpLoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/2fa" element={<TwoFactorPage />} />
      <Route path="/sso/callback" element={<SsoCallbackPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="company-profile" element={<CompanyProfilePage />} />
        <Route path="addresses" element={<AddressesPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="quotations" element={<QuotationsPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="deliveries" element={<DeliveriesPage />} />
        {/* Docs/CR/prompt-shipment-tracking-interactive-prototype_1.md: clickable prototype over an
            in-memory mock dataset, no backend involved -- see ShipmentTrackingPage.jsx header. */}
        <Route path="shipment-tracking" element={<ShipmentTrackingPage />} />
        <Route path="shipment-tracking/:id" element={<ShipmentDetailPage />} />
        {/* Docs/CR/customer_portal_vessel_schedule.md, Fase 0-P: clickable prototype over an
            in-memory mock (freight_schedule addon doesn't exist in Odoo yet) -- see
            VesselSchedulePage.jsx header. */}
        <Route path="vessel-schedule" element={<VesselSchedulePage />} />
        <Route path="vessel-schedule/:id" element={<VesselScheduleDetailPage />} />
        {/* Portal WPC group (freight-forwarding blueprint attachment): clickable prototype over an
            in-memory mock, no backend involved -- see LclCapacityPage.jsx header. */}
        <Route path="lcl-capacity" element={<LclCapacityPage />} />
        {/* Docs/CR/air_schedule.md, Fase 0: same situation as Vessel Schedule above -- in-memory
            mock only, no `freight_schedule` addon extension to read from yet. Staff-only per
            D-4/AS-7 -- see AirSchedulePage.jsx header; the nav entry (AppShell.jsx) is likewise
            hidden from customer roles, not just this route. */}
        <Route path="air-schedule" element={<AirSchedulePage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="rma" element={<RmaPage />} />
        <Route path="warranty" element={<WarrantyPage />} />
        <Route path="maintenance" element={<MaintenancePage />} />
        <Route path="equipment" element={<EquipmentPage />} />
        <Route path="equipment/due" element={<DueReplacementsPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        {/* Gerbang sebenarnya ada di backend (requirePlatformAdmin); halaman ini juga
            memeriksa is_platform_admin sendiri supaya non-admin melihat pesan, bukan tabel kosong. */}
        <Route path="admin/assistant" element={<AssistantAdminPage />} />
        <Route path="settings/odoo-connection" element={<OdooConnectionSettingsPage />} />
        <Route path="settings/ai-provider" element={<AiProviderSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from './lib/queryClient';

import { AppLayout } from './components/layout/AppLayout';
import { AuthLayout } from './components/layout/AuthLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { useAuthStore } from './stores/auth.store';
import { apiClient } from './lib/api';

// Auth Pages
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage'));
const AcceptInvitePage = lazy(() => import('./pages/auth/AcceptInvitePage'));
const VerifyEmailPage = lazy(() => import('./pages/auth/VerifyEmailPage'));

// App Pages
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const OrganizationPage = lazy(() => import('./pages/settings/OrganizationPage'));
const UsersPage = lazy(() => import('./pages/settings/UsersPage'));
const SettingsLayout = lazy(() => import('./pages/settings/SettingsLayout'));

// Locations & Products
const LocationsListPage = lazy(() => import('./pages/locations/LocationsListPage'));
const LocationDetailPage = lazy(() => import('./pages/locations/LocationDetailPage'));
const ProductsListPage = lazy(() => import('./pages/products/ProductsListPage'));
const ProductDetailPage = lazy(() => import('./pages/products/ProductDetailPage'));
const LotsListPage = lazy(() => import('./pages/lots/LotsListPage'));
const LotDetailPage = lazy(() => import('./pages/lots/LotDetailPage'));
const EventsListPage = lazy(() => import('./pages/events/EventsListPage'));
const RecordEventPage = lazy(() => import('./pages/events/RecordEventPage'));
const EventDetailPage = lazy(() => import('./pages/events/EventDetailPage'));
const TracePage = lazy(() => import('./pages/trace/TracePage'));
const AuditLogPage = lazy(() => import('./pages/audit/AuditLogPage'));
const ComplianceGapsPage = lazy(() => import('./pages/reports/ComplianceGapsPage'));
const ExportDetailPage = lazy(() => import('./pages/reports/ExportDetailPage'));
const ImportPage = lazy(() => import('./pages/imports/ImportPage'));
const RecallSimulationsPage = lazy(() => import('./pages/recall/RecallSimulationsPage'));
const RecallSimulationDetailPage = lazy(() => import('./pages/recall/RecallSimulationDetailPage'));

const PageLoader = () => (
  <div className="flex h-screen items-center justify-center">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
  </div>
);

function App() {
  const { setAuth, clearAuth } = useAuthStore();

  useEffect(() => {
    const initAuth = async () => {
      const isAuthenticated = localStorage.getItem('isAuthenticated');
      if (!isAuthenticated) {
        clearAuth();
        return;
      }
      try {
        const { data } = await apiClient.post('/auth/refresh');
        const { user, accessToken } = data.data;
        setAuth(user, accessToken);
      } catch (error) {
        clearAuth();
      }
    };
    initAuth();
  }, [setAuth, clearAuth]);

  return (
    <QueryClientProvider client={queryClient}>
      <Toaster position="top-right" richColors />
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Auth Routes */}
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/accept-invite" element={<AcceptInvitePage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
            </Route>

            {/* App Routes */}
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/settings" element={<SettingsLayout />}>
                <Route index element={<OrganizationPage />} />
                <Route path="users" element={<UsersPage />} />
              </Route>
              
              {/* Locations & Products */}
              <Route path="/locations" element={<LocationsListPage />} />
              <Route path="/locations/:locationId" element={<LocationDetailPage />} />
              <Route path="/products" element={<ProductsListPage />} />
              <Route path="/products/:productId" element={<ProductDetailPage />} />

              {/* Placeholders for remaining routes */}
              <Route path="/lots" element={<LotsListPage />} />
              <Route path="/lots/:id" element={<LotDetailPage />} />
              <Route path="/events" element={<EventsListPage />} />
              <Route path="/events/record" element={<RecordEventPage />} />
              <Route path="/events/:id" element={<EventDetailPage />} />
              <Route path="/trace" element={<TracePage />} />
              <Route path="/imports" element={<ImportPage />} />
              <Route path="/reports/compliance-gaps" element={<ComplianceGapsPage />} />
              <Route path="/reports/exports/:exportId" element={<ExportDetailPage />} />
              <Route path="/recall" element={<RecallSimulationsPage />} />
              <Route path="/recall/:id" element={<RecallSimulationDetailPage />} />
              <Route path="/audit" element={<AuditLogPage />} />
            </Route>
            
            <Route path="*" element={<div>404 Not Found</div>} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;

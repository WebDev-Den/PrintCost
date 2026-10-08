import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.tsx';
import { AppDataProvider } from './context/AppDataContext.tsx';

// Layout
import { AppLayout } from './components/layout/AppLayout.tsx';

// Public pages
import { LandingPage } from './pages/public/LandingPage.tsx';
import { LoginPage } from './pages/public/LoginPage.tsx';
import { RegisterPage } from './pages/public/RegisterPage.tsx';
import { ForgotPasswordPage } from './pages/public/ForgotPasswordPage.tsx';
import { ResetPasswordPage } from './pages/public/ResetPasswordPage.tsx';
import { AuthCallbackPage } from './pages/public/AuthCallbackPage.tsx';
import { CheckEmailPage } from './pages/public/CheckEmailPage.tsx';
import { FilamentsDirectoryPage } from './pages/public/FilamentsDirectoryPage.tsx';

// App pages
import { DashboardPage } from './pages/app/DashboardPage.tsx';
const CalculatorPage = lazy(() => import('./pages/app/CalculatorPage.tsx').then((m) => ({ default: m.CalculatorPage })));
import { CalculationsHistoryPage } from './pages/app/CalculationsHistoryPage.tsx';
const CalculationDetailsPage = lazy(() => import('./pages/app/CalculationDetailsPage.tsx').then((m) => ({ default: m.CalculationDetailsPage })));
import { MaterialsPage } from './pages/app/MaterialsPage.tsx';
import { PrintersPage } from './pages/app/PrintersPage.tsx';
import { SettingsPage } from './pages/app/SettingsPage.tsx';
import { AccountPage } from './pages/app/AccountPage.tsx';
import { OnboardingPage } from './pages/app/OnboardingPage.tsx';
const CatalogAdminPage = lazy(() => import('./pages/app/CatalogAdminPage.tsx').then((m) => ({ default: m.CatalogAdminPage })));
const AdministrationPage = lazy(() => import('./pages/app/AdministrationPage.tsx').then((m) => ({ default: m.AdministrationPage })));

// Fallback pages
import { NotFoundPage } from './pages/NotFoundPage.tsx';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppDataProvider>
          <Suspense fallback={<div role="status" className="p-12 text-center">Завантаження…</div>}><Routes>
            {/* Public Routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/filaments" element={<FilamentsDirectoryPage />} />
            <Route path="/auth/login" element={<LoginPage />} />
            <Route path="/auth/register" element={<RegisterPage />} />
            <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/auth/check-email" element={<CheckEmailPage />} />

            {/* Cabinet App Routes */}
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Navigate to="/app/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="calculator" element={<CalculatorPage />} />
              <Route path="calculations" element={<CalculationsHistoryPage />} />
              <Route path="calculations/:id" element={<CalculationDetailsPage />} />
              <Route path="materials" element={<MaterialsPage />} />
              <Route path="printers" element={<PrintersPage />} />
              <Route path="admin/catalog" element={<CatalogAdminPage />} />
              <Route path="admin/access" element={<AdministrationPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="onboarding" element={<OnboardingPage />} />
            </Route>

            {/* 404 Catch-All */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes></Suspense>
        </AppDataProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

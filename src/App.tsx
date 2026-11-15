import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { HealthSystemProvider, useHealthSystem } from './context/HealthSystemContext.tsx';
import { TopNav } from './components/TopNav.tsx';
import { Footer } from './components/Footer.tsx';
import { OverviewPage } from './components/OverviewPage.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { DoctorDashboard } from './components/DoctorDashboard.tsx';
import { PatientDashboard } from './components/PatientDashboard.tsx';
import { RegistrationPage } from './components/RegistrationPage.tsx';
import {
  ConsentManagementPage,
  DataAccessHistoryPage,
  PrivacyPolicyPage,
  TermsOfServicePage,
} from './components/GovernancePages.tsx';

const RouteViewport: React.FC = () => {
  const {
    route,
    accessDenied,
    clearAccessDenied,
    navigate,
    effectiveRole,
    authError,
    clearAuthError,
    syncError,
    clearSyncError,
  } = useHealthSystem();

  const renderContent = () => {
    if (accessDenied) {
      return (
        <main className="max-w-[780px] mx-auto px-4 sm:px-6 lg:px-8 pt-10">
          <section
            role="alert"
            className="glass-panel rounded-2xl border-[#FF6B5B]/35 p-6 sm:p-8 space-y-4"
          >
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-6 h-6 text-[#FF6B5B] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1.5">
                <p className="text-xs font-mono font-semibold text-[#FF6B5B]">
                  403 ACCESS RESTRICTED · RBAC ENFORCEMENT
                </p>
                <h1 className="font-editorial text-2xl font-semibold text-[#F4EDE0]">
                  Insufficient Role Privileges
                </h1>
                <p className="text-sm text-[#F4EDE0]/75 leading-relaxed">{accessDenied.reason}</p>
              </div>
            </div>
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  clearAccessDenied();
                  navigate(effectiveRole === 'patient' ? 'patient' : 'overview');
                }}
                className="px-4 py-2.5 text-xs rounded-xl btn-coral cursor-pointer"
              >
                {effectiveRole === 'patient'
                  ? 'Return to My Health Pass'
                  : 'Return to Overview'}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearAccessDenied();
                  navigate('overview');
                }}
                className="px-4 py-2.5 text-xs font-medium rounded-xl btn-glass cursor-pointer"
              >
                Open Public Overview
              </button>
            </div>
          </section>
        </main>
      );
    }

    switch (route) {
      case 'admin':
        return <AdminDashboard />;
      case 'doctor':
        return <DoctorDashboard />;
      case 'patient':
        return <PatientDashboard />;
      case 'register':
        return <RegistrationPage />;
      case 'consent':
        return <ConsentManagementPage />;
      case 'audit':
        return <DataAccessHistoryPage />;
      case 'privacy':
        return <PrivacyPolicyPage />;
      case 'terms':
        return <TermsOfServicePage />;
      case 'overview':
      default:
        return <OverviewPage />;
    }
  };

  return (
    <>
      {(authError || syncError) && (
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pt-3 space-y-2">
          {authError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 bg-[#FF6B5B]/15 border border-[#FF6B5B]/40 text-[#F4EDE0] px-4 py-2.5 rounded-xl text-xs"
            >
              <span>{authError}</span>
              <button
                type="button"
                onClick={clearAuthError}
                className="underline font-medium text-[#FF6B5B] shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}
          {syncError && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 bg-[#F4EDE0]/10 border border-[#F4EDE0]/25 text-[#F4EDE0] px-4 py-2.5 rounded-xl text-xs"
            >
              <span>{syncError}</span>
              <button
                type="button"
                onClick={clearSyncError}
                className="underline font-medium text-[#FF6B5B] shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
      {renderContent()}
    </>
  );
};

export default function App() {
  return (
    <HealthSystemProvider>
      <div className="min-h-screen flex flex-col bg-editorial-ribbed text-[#F4EDE0]">
        <TopNav />
        <div className="flex-1">
          <RouteViewport />
        </div>
        <Footer />
      </div>
    </HealthSystemProvider>
  );
}

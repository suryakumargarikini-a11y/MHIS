import React from 'react';
import { useHealthSystem } from '../context/HealthSystemContext.tsx';

export const Footer: React.FC = () => {
  const {
    navigate,
    user,
    effectiveRole,
    sandboxRoleLocked,
    togglePatientRbacLock,
    signInWithGoogle,
    signOutUser,
    resetDemoDataset,
  } = useHealthSystem();

  return (
    <footer className="border-t border-[#F4EDE0]/12 bg-[#0D172B]/75 backdrop-blur-lg mt-16">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6 text-xs text-[#F4EDE0]/68">
        <div className="space-y-1.5">
          <p className="font-editorial text-sm font-medium text-[#F4EDE0]">
            Migrant Health Intelligence System · SIH25083 Reference Infrastructure
          </p>
          <p>
            Simulated demonstration records only. Designed for interstate public-health continuity
            evaluation. Active Principal:{' '}
            <span className="font-mono font-medium text-[#FF6B5B]">{effectiveRole}</span>
            {user ? ' (Firebase Verified)' : sandboxRoleLocked ? ' (RBAC Locked)' : ' (Demo Sandbox)'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <button
            type="button"
            onClick={() => navigate('consent')}
            className="hover:text-[#F4EDE0] underline-offset-4 hover:underline cursor-pointer whitespace-nowrap py-1"
          >
            Consent Management
          </button>
          <button
            type="button"
            onClick={() => navigate('audit')}
            className="hover:text-[#F4EDE0] underline-offset-4 hover:underline cursor-pointer whitespace-nowrap py-1"
          >
            Data Access History
          </button>
          <button
            type="button"
            onClick={() => navigate('privacy')}
            className="hover:text-[#F4EDE0] underline-offset-4 hover:underline cursor-pointer whitespace-nowrap py-1"
          >
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => navigate('terms')}
            className="hover:text-[#F4EDE0] underline-offset-4 hover:underline cursor-pointer whitespace-nowrap py-1"
          >
            Terms of Service
          </button>
          <span aria-hidden="true" className="text-[#F4EDE0]/20">
            |
          </span>
          {user ? (
            <button
              type="button"
              onClick={() => void signOutUser()}
              className="text-[#FF6B5B] hover:underline cursor-pointer whitespace-nowrap py-1 font-medium"
            >
              Sign out ({user.email})
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                className="text-[#FF6B5B] hover:underline cursor-pointer whitespace-nowrap py-1 font-medium"
              >
                Firebase Sign-In
              </button>
              <button
                type="button"
                onClick={togglePatientRbacLock}
                className="text-[#F4EDE0] hover:underline cursor-pointer whitespace-nowrap py-1"
              >
                {sandboxRoleLocked ? 'Unlock Demo Sandbox' : 'Enforce Patient RBAC'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={resetDemoDataset}
            className="text-[#F4EDE0]/60 hover:text-[#F4EDE0] cursor-pointer whitespace-nowrap py-1"
          >
            Reset Demo Dataset
          </button>
        </div>
      </div>
    </footer>
  );
};

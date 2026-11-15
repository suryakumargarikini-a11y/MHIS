import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useHealthSystem } from '../context/HealthSystemContext.tsx';
import type { AppRoute } from '../types/health.ts';

const NAV_ITEMS: { id: AppRoute; label: string; matchRoutes: AppRoute[] }[] = [
  { id: 'overview', label: 'Overview', matchRoutes: ['overview'] },
  { id: 'admin', label: 'Admin', matchRoutes: ['admin'] },
  { id: 'doctor', label: 'Doctor', matchRoutes: ['doctor'] },
  { id: 'patient', label: 'Patient', matchRoutes: ['patient'] },
  {
    id: 'consent',
    label: 'Governance',
    matchRoutes: ['consent', 'audit', 'privacy', 'terms'],
  },
];

export const TopNav: React.FC = () => {
  const { route, navigate } = useHealthSystem();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = (next: AppRoute) => {
    navigate(next);
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-[#14213D]/82 backdrop-blur-xl border-b border-[#F4EDE0]/10 px-4 sm:px-6 lg:px-10 py-2.5">
      <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
        {/* Left: Clean Single-Line Editorial Brand Wordmark */}
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            handleNav('overview');
          }}
          className="inline-flex items-center gap-2.5 font-editorial text-lg sm:text-xl font-semibold tracking-tight text-[#F4EDE0] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FF6B5B]"
        >
          <span
            className="w-2.5 h-2.5 rounded-sm bg-[#FF6B5B] shrink-0"
            aria-hidden="true"
          />
          <span>Migrant Health</span>
        </a>

        {/* Center: Rounded Translucent Glass Navigation */}
        <nav
          className="hidden md:flex items-center gap-1 rounded-full bg-[#0D172B]/75 backdrop-blur-xl border border-[#F4EDE0]/15 px-1.5 py-1 shadow-[0_12px_32px_-12px_rgba(5,10,22,0.8)]"
          aria-label="Primary navigation"
        >
          {NAV_ITEMS.map((item) => {
            const active = item.matchRoutes.includes(route);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`relative px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF6B5B] ${
                  active
                    ? 'bg-[#F4EDE0]/14 text-[#F4EDE0]'
                    : 'text-[#F4EDE0]/70 hover:text-[#F4EDE0] hover:bg-[#F4EDE0]/6'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    className="absolute left-1/2 -translate-x-1/2 bottom-0.5 w-5 h-[2px] rounded-full bg-[#FF6B5B]"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Right: Single High-Contrast CTA + Mobile Menu Button */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => handleNav('register')}
            className={`hidden sm:inline-flex items-center justify-center px-5 py-2.5 text-xs font-semibold rounded-full whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF6B5B] transition-colors ${
              route === 'register'
                ? 'bg-[#F4EDE0] text-[#14213D]'
                : 'bg-[#FF6B5B] hover:bg-[#FF5543] text-[#0D172B]'
            }`}
          >
            Register Migrant
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-full bg-[#0D172B]/80 backdrop-blur-xl border border-[#F4EDE0]/20 text-[#F4EDE0] hover:bg-[#F4EDE0]/10 cursor-pointer"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Glass Drawer */}
      {mobileOpen && (
        <div className="md:hidden mt-2 rounded-2xl glass-panel p-3 space-y-1 pointer-events-auto">
          {NAV_ITEMS.map((item) => {
            const active = item.matchRoutes.includes(route);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium flex items-center justify-between cursor-pointer ${
                  active
                    ? 'bg-[#F4EDE0]/12 text-[#F4EDE0]'
                    : 'text-[#F4EDE0]/80 hover:bg-[#F4EDE0]/8'
                }`}
              >
                <span>{item.label}</span>
                {active && <span className="w-2 h-2 rounded-full bg-[#FF6B5B]" aria-hidden="true" />}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => handleNav('register')}
            className="w-full text-center px-4 py-3 mt-2 rounded-xl text-sm font-semibold text-[#0D172B] bg-[#FF6B5B] hover:bg-[#FF5543] cursor-pointer"
          >
            Register Migrant
          </button>
        </div>
      )}
    </header>
  );
};

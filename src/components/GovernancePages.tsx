import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileText,
  History,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { useHealthSystem } from '../context/HealthSystemContext.tsx';
import type { AppRoute } from '../types/health.ts';
import { SyntheticNoticeBanner } from './StatusPrimitives.tsx';

const GovernanceLayout: React.FC<{ active: AppRoute; children: React.ReactNode }> = ({
  active,
  children,
}) => {
  const { navigate, auditLogs, patients } = useHealthSystem();
  const navItems: { id: AppRoute; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'consent', label: 'Consent Management', icon: ShieldCheck },
    { id: 'audit', label: 'Data Access History', icon: History },
    { id: 'privacy', label: 'Privacy Policy', icon: Lock },
    { id: 'terms', label: 'Terms of Service', icon: FileText },
  ];

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pt-5 space-y-5">
      <SyntheticNoticeBanner compact />

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Glass Governance Side Rail */}
        <aside className="w-full lg:w-68 shrink-0 glass-panel rounded-2xl p-4 space-y-5">
          <div className="pb-3.5 border-b border-[#F4EDE0]/12">
            <p className="text-[11px] font-mono uppercase tracking-wider text-[#FF6B5B]">
              Oversight &amp; Compliance
            </p>
            <h2 className="font-editorial text-2xl font-medium text-[#F4EDE0] mt-1">
              Data Governance
            </h2>
          </div>

          <nav className="space-y-1.5" aria-label="Governance sections">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#F4EDE0]/14 text-[#F4EDE0] border border-[#FF6B5B]/45'
                      : 'text-[#F4EDE0]/74 hover:bg-[#F4EDE0]/8 hover:text-[#F4EDE0]'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#FF6B5B]' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <dl className="pt-4 border-t border-[#F4EDE0]/12 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-[#F4EDE0]/62">Audit Events</dt>
              <dd className="font-mono tabular-nums text-[#FF6B5B]">{auditLogs.length}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[#F4EDE0]/62">Governed Profiles</dt>
              <dd className="font-mono tabular-nums text-[#F4EDE0]">{patients.length}</dd>
            </div>
          </dl>
        </aside>

        <main className="flex-1 min-w-0 w-full">{children}</main>
      </div>
    </div>
  );
};

export const ConsentManagementPage: React.FC = () => {
  const {
    patients,
    selectedPatient,
    setSelectedPatientId,
    assignedPatientId,
    effectiveRole,
    sandboxRoleLocked,
    user,
    consents,
    updateConsent,
  } = useHealthSystem();
  const [feedback, setFeedback] = useState('');

  const isPatientIsolated =
    effectiveRole === 'patient' && (Boolean(user) || sandboxRoleLocked);

  const activeConsent = consents[selectedPatient.healthId] ?? {
    healthId: selectedPatient.healthId,
    interStateSharing: true,
    emergencyQrAccess: true,
    anonymizedSurveillance: true,
    updatedAt: selectedPatient.updatedAt,
    updatedByRole: 'patient',
  };

  const handleToggle = async (
    key: 'interStateSharing' | 'emergencyQrAccess' | 'anonymizedSurveillance',
    label: string,
  ) => {
    const nextValue = !activeConsent[key];
    await updateConsent(selectedPatient.healthId, { [key]: nextValue });
    setFeedback(
      `${label} ${nextValue ? 'granted' : 'revoked'} for ${selectedPatient.fullName} and recorded in Data Access History.`,
    );
  };

  return (
    <GovernanceLayout active="consent">
      <section className="glass-panel rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#F4EDE0]/12">
          <div>
            <h1 className="font-editorial text-2xl sm:text-3xl font-medium text-[#F4EDE0]">
              Patient Consent Auditing &amp; Controls
            </h1>
            <p className="text-sm text-[#F4EDE0]/70 mt-1">
              Granular purpose-bound consent controls that govern MHIS-QR-v2 Ed25519 payload fields
              and cross-state clinic sharing.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto min-w-0">
            <label
              htmlFor="consent-patient"
              className="text-xs font-medium text-[#F4EDE0]/70 shrink-0"
            >
              Profile:
            </label>
            <select
              id="consent-patient"
              value={selectedPatient.healthId}
              disabled={isPatientIsolated}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="w-full sm:w-auto max-w-full min-w-0 px-3 py-2 text-xs rounded-xl glass-input disabled:opacity-75"
            >
              {(isPatientIsolated
                ? patients.filter((p) => p.healthId === assignedPatientId)
                : patients
              ).map((p) => (
                <option key={p.healthId} value={p.healthId}>
                  {p.fullName} ({p.healthId})
                </option>
              ))}
            </select>
          </div>
        </div>

        {feedback && (
          <div
            role="status"
            className="flex items-center gap-2 bg-[#F4EDE0]/10 border border-[#F4EDE0]/25 text-[#F4EDE0] px-4 py-3 rounded-xl text-xs"
          >
            <CheckCircle2 className="w-4 h-4 text-[#FF6B5B] shrink-0" aria-hidden="true" />
            <span>{feedback}</span>
          </div>
        )}

        <div className="divide-y divide-[#F4EDE0]/10 border border-[#F4EDE0]/14 rounded-xl bg-[#0D172B]/55">
          {[
            {
              key: 'interStateSharing' as const,
              title: 'Inter-State Primary Clinic Record Sharing',
              desc: 'Allows receiving PHCs and CHCs in destination states to inspect linked diagnosis and medication history.',
              enabled: activeConsent.interStateSharing,
            },
            {
              key: 'emergencyQrAccess' as const,
              title: 'Emergency QR Health Pass Clinical Fields',
              desc: 'Includes allergies and chronic conditions inside the Ed25519-signed MHIS-QR-v2 payload. Disabling immediately redacts clinical details on server verification.',
              enabled: activeConsent.emergencyQrAccess,
            },
            {
              key: 'anonymizedSurveillance' as const,
              title: 'Anonymized Inter-State Corridor Surveillance',
              desc: 'Permits de-identified corridor counts to guide mobile clinic and DOTS medicine stock planning.',
              enabled: activeConsent.anonymizedSurveillance,
            },
          ].map((item) => (
            <div
              key={item.key}
              className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1 max-w-2xl">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#FF6B5B] shrink-0" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-[#F4EDE0]">{item.title}</h2>
                </div>
                <p className="text-xs text-[#F4EDE0]/68 leading-relaxed">{item.desc}</p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={item.enabled}
                onClick={() => void handleToggle(item.key, item.title)}
                className={`px-4 py-2 text-xs rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  item.enabled ? 'btn-coral' : 'btn-glass font-medium'
                }`}
              >
                {item.enabled ? 'Consent Granted' : 'Consent Revoked'}
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs text-[#F4EDE0]/60 font-mono">
          Last updated: {new Date(activeConsent.updatedAt).toLocaleString()} · Updated by:{' '}
          {activeConsent.updatedByRole}
        </p>
      </section>
    </GovernanceLayout>
  );
};

export const DataAccessHistoryPage: React.FC = () => {
  const { auditLogs } = useHealthSystem();
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'admin' | 'doctor' | 'patient'>('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return auditLogs.filter((log) => {
      if (roleFilter !== 'ALL' && log.actorRole !== roleFilter) return false;
      if (!q) return true;
      return (
        log.patientName.toLowerCase().includes(q) ||
        log.healthId.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.purpose.toLowerCase().includes(q)
      );
    });
  }, [auditLogs, roleFilter, query]);

  const handleDownloadCsv = () => {
    const header = 'LogID,Timestamp,HealthID,Patient,Role,Actor,State,Action,Scope,Purpose\n';
    const rows = filtered
      .map((l) =>
        [
          l.logId,
          l.timestamp,
          l.healthId,
          `"${l.patientName}"`,
          l.actorRole,
          `"${l.actorName}"`,
          l.facilityState,
          `"${l.action}"`,
          `"${l.scope}"`,
          `"${l.purpose.replace(/"/g, '""')}"`,
        ].join(','),
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mhis-access-audit-history.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <GovernanceLayout active="audit">
      <section className="glass-panel rounded-2xl p-6 sm:p-8 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="font-editorial text-2xl sm:text-3xl font-medium text-[#F4EDE0] flex items-center gap-2.5">
              <History className="w-5 h-5 text-[#FF6B5B]" aria-hidden="true" />
              <span>Data Access History</span>
            </h1>
            <p className="text-sm text-[#F4EDE0]/70 mt-1">
              Append-only ledger of record reads, Ed25519 QR signature verifications, linkage merges,
              and consent changes.
            </p>
          </div>

          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl btn-glass cursor-pointer self-start md:self-auto whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-[#FF6B5B]" aria-hidden="true" />
            <span>Export CSV</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by Health ID, patient, or action..."
            aria-label="Filter access audit history"
            className="px-3.5 py-2 text-sm rounded-xl glass-input w-full sm:w-72"
          />

          <div className="inline-flex items-center p-1 bg-[#0D172B]/75 border border-[#F4EDE0]/14 rounded-xl">
            {(['ALL', 'doctor', 'admin', 'patient'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap ${
                  roleFilter === r
                    ? 'bg-[#FF6B5B] text-[#0D172B] font-semibold'
                    : 'text-[#F4EDE0]/72 hover:text-[#F4EDE0]'
                }`}
              >
                {r === 'ALL' ? 'All Roles' : r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="border border-dashed border-[#F4EDE0]/20 rounded-xl p-8 text-center space-y-2">
            <p className="text-sm font-medium text-[#F4EDE0]">No audit entries match your filter.</p>
            <button
              type="button"
              onClick={() => {
                setRoleFilter('ALL');
                setQuery('');
              }}
              className="px-4 py-2 text-xs rounded-xl btn-coral cursor-pointer"
            >
              Reset Filter
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto border border-[#F4EDE0]/14 rounded-xl bg-[#0D172B]/55">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#F4EDE0]/[0.04] border-b border-[#F4EDE0]/12 text-xs font-medium text-[#F4EDE0]/68">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Actor &amp; Role</th>
                  <th className="py-3 px-4">Patient / Health ID</th>
                  <th className="py-3 px-4">Action &amp; Scope</th>
                  <th className="py-3 px-4">Declared Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F4EDE0]/10">
                {filtered.map((entry) => (
                  <tr key={entry.logId} className="hover:bg-[#F4EDE0]/[0.04]">
                    <td className="py-3 px-4 font-mono text-xs tabular-nums text-[#F4EDE0]/68 whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-[#F4EDE0]">{entry.actorName}</div>
                      <div className="text-xs text-[#F4EDE0]/62">
                        {entry.actorRole} · {entry.facilityState}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-[#F4EDE0]">{entry.patientName}</div>
                      <div className="font-mono text-xs text-[#F4EDE0]/62">{entry.healthId}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-[#FF6B5B]">{entry.action}</div>
                      <div className="text-xs text-[#F4EDE0]/68">{entry.scope}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-[#F4EDE0]/68">{entry.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </GovernanceLayout>
  );
};

export const PrivacyPolicyPage: React.FC = () => (
  <GovernanceLayout active="privacy">
    <article className="glass-panel rounded-2xl p-6 sm:p-10 space-y-6 text-sm text-[#F4EDE0]/88 leading-relaxed">
      <header className="pb-4 border-b border-[#F4EDE0]/12">
        <p className="text-xs font-mono uppercase tracking-wider text-[#FF6B5B]">
          Data Governance Specification
        </p>
        <h1 className="font-editorial text-3xl font-medium text-[#F4EDE0] mt-1">
          Privacy Policy
        </h1>
        <p className="text-xs text-[#F4EDE0]/60 mt-1">
          Migrant Health Intelligence System (SIH25083 Prototype) · Effective November 2026
        </p>
      </header>

      <section className="space-y-2 max-w-2xl">
        <h2 className="text-base font-semibold text-[#F4EDE0]">
          1. Purpose Limitation &amp; Synthetic Scope
        </h2>
        <p className="text-[#F4EDE0]/72">
          This reference application demonstrates portable interstate continuity-of-care workflows.
          Preloaded patient records, clinic identifiers, and migration trajectories are synthetic
          demonstration profiles. Users should not upload real patient-identifiable Protected Health
          Information (PHI) into this prototype environment.
        </p>
      </section>

      <section className="space-y-2 max-w-2xl">
        <h2 className="text-base font-semibold text-[#F4EDE0]">
          2. Consent-Bound QR &amp; Inter-State Access
        </h2>
        <p className="text-[#F4EDE0]/72">
          Every migrant worker profile maintains independent consent toggles for inter-state clinic
          sharing, emergency QR clinical payload exposure, and anonymized corridor counts. Disabling
          Emergency QR Access immediately redacts allergy and diagnosis fields on server-verified
          MHIS-QR-v2 passes.
        </p>
      </section>

      <section className="space-y-2 max-w-2xl">
        <h2 className="text-base font-semibold text-[#F4EDE0]">
          3. Server-Side AI Processing &amp; Integrity Auditing
        </h2>
        <p className="text-[#F4EDE0]/72">
          Clinical RAG queries and continuity-risk handoff syntheses are executed server-side using
          only the selected patient&apos;s retrieved encounter snippets. All record reads, Ed25519 QR
          verifications, entity linkages, and consent updates are recorded in the append-only Data
          Access History ledger.
        </p>
      </section>
    </article>
  </GovernanceLayout>
);

export const TermsOfServicePage: React.FC = () => (
  <GovernanceLayout active="terms">
    <article className="glass-panel rounded-2xl p-6 sm:p-10 space-y-6 text-sm text-[#F4EDE0]/88 leading-relaxed">
      <header className="pb-4 border-b border-[#F4EDE0]/12">
        <p className="text-xs font-mono uppercase tracking-wider text-[#FF6B5B]">
          Operational Conditions
        </p>
        <h1 className="font-editorial text-3xl font-medium text-[#F4EDE0] mt-1">
          Terms of Service
        </h1>
        <p className="text-xs text-[#F4EDE0]/60 mt-1">
          Migrant Health Intelligence System (SIH25083 Prototype) · Effective November 2026
        </p>
      </header>

      <section className="space-y-2 max-w-2xl">
        <h2 className="text-base font-semibold text-[#F4EDE0]">
          1. Non-Diagnostic Decision Support
        </h2>
        <p className="text-[#F4EDE0]/72">
          Continuity-risk scores and Gemini-generated clinical summaries are structured
          decision-support aids designed for demonstration and workflow evaluation. They do not
          replace licensed physician judgment, laboratory confirmation, or national clinical protocols.
        </p>
      </section>

      <section className="space-y-2 max-w-2xl">
        <h2 className="text-base font-semibold text-[#F4EDE0]">
          2. Role Separation &amp; Account Integrity
        </h2>
        <p className="text-[#F4EDE0]/72">
          Administrators, clinicians, and patients operate in role-separated workspaces. When
          connected via Firebase Authentication, Firestore security rules enforce strict ownership
          and schema validation on persisted documents.
        </p>
      </section>

      <section className="space-y-2 max-w-2xl">
        <h2 className="text-base font-semibold text-[#F4EDE0]">3. Honest Representation</h2>
        <p className="text-[#F4EDE0]/72">
          This system makes no claims of formal hospital network partnerships, government deployment
          certification, or clinical trial validation. All metrics shown reflect only the active
          synthetic session dataset.
        </p>
      </section>
    </article>
  </GovernanceLayout>
);

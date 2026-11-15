import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  GitMerge,
  Lock,
  MapPin,
  QrCode,
  ShieldCheck,
} from 'lucide-react';
import { useHealthSystem } from '../context/HealthSystemContext.tsx';
import {
  buildPrivacyPreservingSurveillanceReport,
  SURVEILLANCE_PRIVACY_POLICY,
} from '../lib/surveillancePrivacy.ts';
import type { AppRoute } from '../types/health.ts';
import { IndiaMigrationMap } from './IndiaMigrationMap.tsx';
import { SyntheticNoticeBanner } from './StatusPrimitives.tsx';

interface FeatureStripItem {
  id: string;
  label: string;
  desc: string;
  route: AppRoute;
  icon: React.ComponentType<{ className?: string }>;
  detail: string;
}

const FEATURE_STRIP: FeatureStripItem[] = [
  {
    id: 'surveillance',
    label: 'k-Anonymity Surveillance',
    desc: 'Aggregate interstate corridor tracking',
    route: 'overview',
    icon: MapPin,
    detail:
      'Masks consent-restricted origins and suppresses small subgroups below k = 3 before rendering public corridor flows.',
  },
  {
    id: 'linkage',
    label: 'Identity Resolution',
    desc: 'Deterministic cross-state matching',
    route: 'admin',
    icon: GitMerge,
    detail:
      'Reconciles phonetic name variants, phone suffixes, and origin blocks across state clinics before merging unified Health IDs.',
  },
  {
    id: 'workbench',
    label: 'Clinician RAG',
    desc: 'Consent-scoped handoff synthesis',
    route: 'doctor',
    icon: Activity,
    detail:
      'Grounds clinical summaries strictly on retrieved, consent-authorized encounters with per-claim entailment citations.',
  },
  {
    id: 'qrpass',
    label: 'Ed25519 Health Pass',
    desc: 'Portable signed worker credentials',
    route: 'patient',
    icon: QrCode,
    detail:
      'Issues verifiable MHIS-QR-v2 passes with instant patient revocation, key rotation, and emergency-only redaction.',
  },
  {
    id: 'governance',
    label: 'Consent Governance',
    desc: 'Granular patient audit controls',
    route: 'consent',
    icon: Lock,
    detail:
      'Separates interstate sharing, emergency QR fields, and anonymized surveillance opt-in with an append-only access ledger.',
  },
];

export const OverviewPage: React.FC = () => {
  const {
    navigate,
    patients,
    linkageCandidates,
    consents,
    auditLogs,
  } = useHealthSystem();

  const [selectedCorridor, setSelectedCorridor] = useState<string>('ALL');
  const [activeFeatureId, setActiveFeatureId] = useState<string>('surveillance');

  const surveillanceReport = useMemo(
    () => buildPrivacyPreservingSurveillanceReport(patients, consents),
    [patients, consents],
  );

  const summary = useMemo(() => {
    const pendingLinks = linkageCandidates.filter((c) => c.status === 'PENDING').length;
    const linkedOptedInCount = patients.filter(
      (p) =>
        consents[p.healthId]?.anonymizedSurveillance === true &&
        p.recordLinkageStatus === 'LINKED',
    ).length;

    return {
      totalPatients: surveillanceReport.totalRegisteredPatients,
      optedInCount: surveillanceReport.optedInCount,
      excludedOptOutCount: surveillanceReport.excludedOptOutCount,
      originMaskedCount: surveillanceReport.originMaskedByConsentCount,
      suppressedCorridors: surveillanceReport.suppressedCorridorCount,
      publishableCorridors: surveillanceReport.corridors.filter((c) => !c.suppressed).length,
      destinationStatesCount: surveillanceReport.destinationStates.length,
      highRiskAggregate: surveillanceReport.riskDistribution.HIGH,
      linkedOptedInCount,
      pendingLinks,
    };
  }, [patients, consents, linkageCandidates, surveillanceReport]);

  const visibleCorridors = useMemo(() => {
    if (selectedCorridor === 'ALL') return surveillanceReport.corridors;
    return surveillanceReport.corridors.filter((c) => c.corridorKey === selectedCorridor);
  }, [surveillanceReport.corridors, selectedCorridor]);

  const activeFeature =
    FEATURE_STRIP.find((f) => f.id === activeFeatureId) ?? FEATURE_STRIP[0];

  const scrollToSurveillance = () => {
    const el = document.getElementById('surveillance-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="space-y-14">
      {/* Cinematic Full-Screen Editorial Hero Section */}
      <section className="hero-coral-glow border-b border-[#F4EDE0]/12">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pt-8 sm:pt-12 lg:pt-16 pb-10 min-h-[calc(100vh-5.5rem)] flex flex-col justify-between gap-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center my-auto">
            {/* Left: Oversized Cream Editorial Headline + Dual Actions */}
            <div className="lg:col-span-7 space-y-6">
              <p className="text-[11px] sm:text-xs font-mono uppercase tracking-[0.22em] text-[#FF6B5B]">
                SIH25083 · Interstate Digital Public-Health Continuity
              </p>

              <h1 className="font-editorial text-[42px] sm:text-[62px] lg:text-[78px] font-medium text-[#F4EDE0] leading-[1.03] text-balance">
                Continuity of Care Across Every State Line.
              </h1>

              <p className="text-base sm:text-lg text-[#F4EDE0]/76 leading-relaxed max-w-2xl">
                Consent-governed health passes, deterministic cross-state identity resolution, and
                k-anonymity surveillance built for mobile migrant workforces.
              </p>

              <div className="pt-2 flex flex-wrap items-center gap-4 sm:gap-6">
                <button
                  type="button"
                  onClick={() => navigate('doctor')}
                  className="inline-flex items-center gap-2.5 px-6 py-3.5 text-sm rounded-full btn-coral cursor-pointer whitespace-nowrap shadow-[0_14px_34px_-10px_rgba(255,107,91,0.6)]"
                >
                  <span>Open Doctor Workbench</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={scrollToSurveillance}
                  className="inline-flex items-center gap-2 py-2 text-sm font-medium text-[#F4EDE0] hover:text-[#FF6B5B] transition-colors cursor-pointer whitespace-nowrap underline-offset-4 hover:underline"
                >
                  <span>Explore Migration Ledger</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Right: Floating Translucent Glass Continuity Panel */}
            <div className="lg:col-span-5">
              <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1.5 border-b border-[#F4EDE0]/12 pb-3.5">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-widest text-[#F4EDE0]/60">
                      Live Cohort Intelligence
                    </p>
                    <h2 className="font-editorial text-xl font-medium text-[#F4EDE0] mt-0.5">
                      Privacy-Scoped Snapshot
                    </h2>
                  </div>
                  <span className="font-mono text-[11px] text-[#FF6B5B] shrink-0">
                    {surveillanceReport.policyVersion}
                  </span>
                </div>

                {/* Layered Compact Glass Information Cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="glass-card rounded-2xl p-4 space-y-1">
                    <p className="text-xs text-[#F4EDE0]/68">Surveillance Opt-In</p>
                    <p className="font-mono text-2xl font-semibold tabular-nums text-[#F4EDE0]">
                      {summary.optedInCount}
                      <span className="text-sm font-normal text-[#F4EDE0]/55">
                        {' '}
                        / {summary.totalPatients}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#F4EDE0]/56">
                      {summary.excludedOptOutCount} opted-out excluded
                    </p>
                  </div>

                  <div className="glass-card rounded-2xl p-4 space-y-1">
                    <p className="text-xs text-[#F4EDE0]/68">Publishable Corridors</p>
                    <p className="font-mono text-2xl font-semibold tabular-nums text-[#FF6B5B]">
                      {summary.publishableCorridors}
                    </p>
                    <p className="text-[11px] text-[#F4EDE0]/56">
                      {summary.suppressedCorridors} suppressed (k &lt; {surveillanceReport.minimumCohortSize})
                    </p>
                  </div>
                </div>

                <div className="glass-card rounded-2xl p-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium text-[#F4EDE0]">
                      {activeFeature.label}
                    </p>
                    <p className="text-xs text-[#F4EDE0]/68 leading-relaxed">
                      {activeFeature.detail}
                    </p>
                  </div>
                  {activeFeature.route !== 'overview' && (
                    <button
                      type="button"
                      onClick={() => navigate(activeFeature.route)}
                      className="shrink-0 px-3.5 py-2 text-xs font-medium rounded-xl btn-glass cursor-pointer whitespace-nowrap"
                    >
                      Open
                    </button>
                  )}
                </div>

                <div className="pt-1 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <span className="text-[#F4EDE0]/68 font-mono tabular-nums">
                    {summary.pendingLinks} pending merge · {summary.originMaskedCount} origin masked
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => navigate('admin')}
                      className="text-[#F4EDE0] hover:text-[#FF6B5B] font-medium cursor-pointer"
                    >
                      Admin Console
                    </button>
                    <span aria-hidden="true" className="text-[#F4EDE0]/20">
                      ·
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate('patient')}
                      className="text-[#FF6B5B] hover:underline font-medium cursor-pointer"
                    >
                      Health Pass
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom 5-Item Interactive Feature Strip */}
          <div className="border-t border-[#F4EDE0]/14 pt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4">
            {FEATURE_STRIP.map((item) => {
              const Icon = item.icon;
              const isActive = activeFeatureId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveFeatureId(item.id)}
                  className={`relative text-left px-3 py-3.5 rounded-xl transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#F4EDE0]/[0.07] text-[#F4EDE0]'
                      : 'text-[#F4EDE0]/64 hover:text-[#F4EDE0] hover:bg-[#F4EDE0]/[0.04]'
                  }`}
                >
                  {isActive && (
                    <span
                      className="absolute inset-x-3 top-0 h-[2px] rounded-full bg-[#FF6B5B]"
                      aria-hidden="true"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-[#FF6B5B]' : 'text-[#F4EDE0]/60'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="text-xs sm:text-sm font-medium truncate">{item.label}</span>
                  </div>
                  <p className="text-[11px] text-[#F4EDE0]/56 mt-1 line-clamp-1">{item.desc}</p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Operational Surveillance Workspace */}
      <main
        id="surveillance-section"
        className="scroll-mt-24 max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 space-y-8"
      >
        <SyntheticNoticeBanner />

        {/* Primary Operational Grid: Privacy-Preserving Corridor Map + Surveillance Ledger */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-7 glass-panel rounded-2xl p-5 sm:p-6 flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 mb-4">
              <div>
                <h2 className="font-editorial text-xl sm:text-2xl font-medium text-[#F4EDE0]">
                  Privacy-Preserving Migration Corridor Map
                </h2>
                <p className="text-xs text-[#F4EDE0]/68 mt-1">
                  Excludes opted-out profiles, masks consent-restricted origins, and suppresses
                  subgroups smaller than k = {surveillanceReport.minimumCohortSize}.
                </p>
              </div>
              <span className="font-mono text-xs tabular-nums text-[#FF6B5B] shrink-0">
                {summary.publishableCorridors} Publishable · {summary.suppressedCorridors} Suppressed
              </span>
            </div>

            <div className="flex-1">
              <IndiaMigrationMap
                surveillanceReport={surveillanceReport}
                selectedCorridor={selectedCorridor}
                onSelectCorridor={setSelectedCorridor}
              />
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col gap-6">
            <div className="glass-panel rounded-2xl p-5 sm:p-6">
              <div className="flex items-baseline justify-between pb-3.5 border-b border-[#F4EDE0]/12">
                <h2 className="font-editorial text-xl font-medium text-[#F4EDE0]">
                  Surveillance Privacy &amp; Coverage Ledger
                </h2>
                <span className="font-mono text-[11px] text-[#FF6B5B]">
                  {surveillanceReport.policyVersion}
                </span>
              </div>

              <dl className="divide-y divide-[#F4EDE0]/10 text-sm">
                <div className="py-3 flex items-baseline justify-between gap-4">
                  <dt className="text-[#F4EDE0]/72">Surveillance Opt-In Cohort</dt>
                  <dd className="font-mono font-semibold tabular-nums text-[#F4EDE0]">
                    {summary.optedInCount} / {summary.totalPatients}
                  </dd>
                </div>
                <div className="py-3 flex items-baseline justify-between gap-4">
                  <dt className="text-[#F4EDE0]/72">Excluded by Consent Opt-Out</dt>
                  <dd className="font-mono font-semibold tabular-nums text-[#F4EDE0]/88">
                    {summary.excludedOptOutCount} profile(s)
                  </dd>
                </div>
                <div className="py-3 flex items-baseline justify-between gap-4">
                  <dt className="text-[#F4EDE0]/72">Origin Masked (Inter-State Off)</dt>
                  <dd className="font-mono font-semibold tabular-nums text-[#FF6B5B]">
                    {summary.originMaskedCount} profile(s)
                  </dd>
                </div>
                <div className="py-3 flex items-baseline justify-between gap-4">
                  <dt className="text-[#F4EDE0]/72">
                    Suppressed Small Corridors (k &lt; {surveillanceReport.minimumCohortSize})
                  </dt>
                  <dd className="font-mono font-semibold tabular-nums text-[#F4EDE0]/88">
                    {summary.suppressedCorridors} route(s)
                  </dd>
                </div>
                <div className="py-3 flex items-baseline justify-between gap-4">
                  <dt className="text-[#F4EDE0]/72">High Continuity-Risk (Aggregate)</dt>
                  <dd className="font-mono font-semibold tabular-nums text-[#FF6B5B]">
                    {summary.highRiskAggregate !== null
                      ? `${summary.highRiskAggregate} profile(s)`
                      : `< ${surveillanceReport.minimumCohortSize} (Suppressed)`}
                  </dd>
                </div>
                <div className="py-3 flex items-baseline justify-between gap-4">
                  <dt className="text-[#F4EDE0]/72">Pending Identity Resolution</dt>
                  <dd className="font-mono font-semibold tabular-nums text-[#F4EDE0]">
                    {summary.pendingLinks} candidate(s)
                  </dd>
                </div>
              </dl>
            </div>

            <div className="glass-panel rounded-2xl p-5 sm:p-6 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-baseline justify-between pb-3.5 border-b border-[#F4EDE0]/12">
                  <h2 className="font-editorial text-xl font-medium text-[#F4EDE0]">
                    De-Identified System Activity
                  </h2>
                  <button
                    type="button"
                    onClick={() => navigate('audit')}
                    className="text-xs font-medium text-[#FF6B5B] hover:underline cursor-pointer"
                  >
                    Full Audit Ledger
                  </button>
                </div>

                <div className="divide-y divide-[#F4EDE0]/10">
                  {auditLogs.slice(0, 4).map((entry) => (
                    <div key={entry.logId} className="py-3 space-y-0.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-[#F4EDE0]">{entry.action}</span>
                        <span className="font-mono tabular-nums text-[11px] text-[#F4EDE0]/56 shrink-0">
                          {new Date(entry.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs text-[#F4EDE0]/68">
                        Actor Role: {entry.actorRole} · State Node: {entry.facilityState} ·{' '}
                        {entry.scope}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 mt-2 border-t border-[#F4EDE0]/12 flex flex-wrap items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => navigate('consent')}
                  className="text-[#F4EDE0]/82 hover:text-[#F4EDE0] font-medium hover:underline cursor-pointer"
                >
                  Manage Patient Consent
                </button>
                <button
                  type="button"
                  onClick={() => navigate('register')}
                  className="text-[#FF6B5B] font-medium hover:underline cursor-pointer"
                >
                  Register &amp; Check Duplicates →
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* De-Identified Surveillance Aggregation Matrix */}
        <section className="glass-panel rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-editorial text-xl sm:text-2xl font-medium text-[#F4EDE0]">
                De-Identified Corridor &amp; Sector Surveillance Aggregates
              </h2>
              <p className="text-xs text-[#F4EDE0]/68 mt-1 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#FF6B5B] shrink-0" aria-hidden="true" />
                <span>{SURVEILLANCE_PRIVACY_POLICY.legalBasisSummary}</span>
              </p>
            </div>
            {selectedCorridor !== 'ALL' && (
              <button
                type="button"
                onClick={() => setSelectedCorridor('ALL')}
                className="text-xs font-medium text-[#FF6B5B] hover:underline self-start sm:self-auto cursor-pointer"
              >
                Show All Surveillance Cohorts
              </button>
            )}
          </div>

          <div className="overflow-x-auto border border-[#F4EDE0]/12 rounded-xl bg-[#0D172B]/55">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[#F4EDE0]/[0.04] border-b border-[#F4EDE0]/12 text-xs font-medium text-[#F4EDE0]/68">
                  <th className="py-3 px-4">Corridor Cohort</th>
                  <th className="py-3 px-4">Privacy Status</th>
                  <th className="py-3 px-4 text-right">Opted-In Count</th>
                  <th className="py-3 px-4 text-right">High-Risk Count</th>
                  <th className="py-3 px-4 text-right">Unlinked Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F4EDE0]/10">
                {visibleCorridors.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 px-4 text-center text-xs text-[#F4EDE0]/68">
                      No surveillance cohorts currently have anonymizedSurveillance opt-in enabled.
                    </td>
                  </tr>
                ) : (
                  visibleCorridors.map((c) => (
                    <tr key={c.corridorKey} className="hover:bg-[#F4EDE0]/[0.04] transition-colors">
                      <td className="py-3 px-4 font-medium text-[#F4EDE0]">{c.corridorKey}</td>
                      <td className="py-3 px-4 text-xs text-[#F4EDE0]/68">
                        {c.suppressed
                          ? `Small-cell generalized (k < ${surveillanceReport.minimumCohortSize})`
                          : c.originState
                            ? `Publishable (k ≥ ${surveillanceReport.minimumCohortSize})`
                            : 'Origin masked by inter-state consent'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#F4EDE0]">
                        {c.displayCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#FF6B5B]">
                        {c.highRiskCount !== null
                          ? c.highRiskCount
                          : `< ${surveillanceReport.minimumCohortSize} (Suppressed)`}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#F4EDE0]/72">
                        {c.unlinkedCount !== null
                          ? c.unlinkedCount
                          : `< ${surveillanceReport.minimumCohortSize} (Suppressed)`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  GitMerge,
  Map as MapIcon,
  RefreshCw,
  Search,
  Users,
  XCircle,
} from 'lucide-react';
import { useHealthSystem } from '../context/HealthSystemContext.tsx';
import { applyInterStateConsent } from '../lib/consentGuard.ts';
import { assessContinuityRisk } from '../lib/continuityRisk.ts';
import { buildPrivacyPreservingSurveillanceReport } from '../lib/surveillancePrivacy.ts';
import type { RiskTier } from '../types/health.ts';
import { IndiaMigrationMap } from './IndiaMigrationMap.tsx';
import {
  LinkageStatusLabel,
  RiskTierLabel,
  SyntheticNoticeBanner,
  TableSkeleton,
} from './StatusPrimitives.tsx';

type AdminTab = 'corridors' | 'linkage' | 'facilities';

export const AdminDashboard: React.FC = () => {
  const {
    patients,
    consents,
    linkageCandidates,
    resolveLinkageCandidate,
    setSelectedPatientId,
    navigate,
    isSimulatingLoad,
    triggerLoadingPreview,
  } = useHealthSystem();

  const surveillanceReport = useMemo(
    () => buildPrivacyPreservingSurveillanceReport(patients, consents),
    [patients, consents],
  );

  const [activeTab, setActiveTab] = useState<AdminTab>('corridors');
  const [searchQuery, setSearchQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<'ALL' | RiskTier>('ALL');
  const [corridorFilter, setCorridorFilter] = useState<string>('ALL');
  const [statusFeedback, setStatusFeedback] = useState<string>('');

  const enrichedPatients = useMemo(
    () =>
      patients.map((p) => {
        const consentView = applyInterStateConsent(p, consents[p.healthId], 'admin');
        const scoped = consentView.patient;
        return {
          patient: scoped,
          consentRestricted: consentView.consentRestricted,
          risk: assessContinuityRisk(scoped),
          corridor: consentView.consentRestricted
            ? `Origin Withheld (Consent) -> ${scoped.currentState}`
            : `${scoped.originState} -> ${scoped.currentState}`,
        };
      }),
    [patients, consents],
  );

  const filteredPatients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedPatients.filter(({ patient, risk, corridor }) => {
      if (riskFilter !== 'ALL' && risk.tier !== riskFilter) return false;
      if (corridorFilter !== 'ALL' && corridor !== corridorFilter) return false;
      if (!q) return true;
      return (
        patient.fullName.toLowerCase().includes(q) ||
        patient.healthId.toLowerCase().includes(q) ||
        patient.originState.toLowerCase().includes(q) ||
        patient.currentState.toLowerCase().includes(q) ||
        patient.chronicConditions.some((c) => c.toLowerCase().includes(q))
      );
    });
  }, [enrichedPatients, searchQuery, riskFilter, corridorFilter]);

  const facilities = useMemo(() => {
    const seen = new Map<
      string,
      { facilityName: string; state: string; district: string; sourceSystem: string; count: number }
    >();
    for (const p of patients) {
      for (const enc of p.encounters) {
        const key = `${enc.facilityName}|${enc.state}`;
        const prev = seen.get(key);
        if (prev) {
          prev.count += 1;
        } else {
          seen.set(key, {
            facilityName: enc.facilityName,
            state: enc.state,
            district: enc.district,
            sourceSystem: enc.sourceSystem,
            count: 1,
          });
        }
      }
    }
    return Array.from(seen.values());
  }, [patients]);

  const pendingCount = linkageCandidates.filter((c) => c.status === 'PENDING').length;

  const handleCandidateAction = (candidateId: string, decision: 'MERGED' | 'REJECTED') => {
    resolveLinkageCandidate(candidateId, decision);
    setStatusFeedback(
      decision === 'MERGED'
        ? `Candidate ${candidateId} merged into unified Health ID and logged to audit history.`
        : `Candidate ${candidateId} marked as distinct patient record.`,
    );
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pt-5 space-y-5">
      <SyntheticNoticeBanner compact />

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Translucent Glass Stewardship Rail */}
        <aside className="w-full lg:w-68 shrink-0 glass-panel rounded-2xl p-4 space-y-5">
          <div className="pb-3.5 border-b border-[#F4EDE0]/12">
            <p className="text-[11px] font-mono uppercase tracking-wider text-[#FF6B5B]">
              Administration Workspace
            </p>
            <h1 className="font-editorial text-2xl font-medium text-[#F4EDE0] mt-1">
              State Stewardship
            </h1>
          </div>

          <nav className="space-y-1.5" aria-label="Admin sections">
            <button
              type="button"
              onClick={() => setActiveTab('corridors')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'corridors'
                  ? 'bg-[#F4EDE0]/14 text-[#F4EDE0] border border-[#FF6B5B]/45'
                  : 'text-[#F4EDE0]/74 hover:bg-[#F4EDE0]/8 hover:text-[#F4EDE0]'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <MapIcon
                  className={`w-4 h-4 shrink-0 ${activeTab === 'corridors' ? 'text-[#FF6B5B]' : ''}`}
                  aria-hidden="true"
                />
                <span>Migration &amp; Risk</span>
              </span>
              <span className="font-mono tabular-nums text-xs opacity-80">{patients.length}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('linkage')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'linkage'
                  ? 'bg-[#F4EDE0]/14 text-[#F4EDE0] border border-[#FF6B5B]/45'
                  : 'text-[#F4EDE0]/74 hover:bg-[#F4EDE0]/8 hover:text-[#F4EDE0]'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <GitMerge
                  className={`w-4 h-4 shrink-0 ${activeTab === 'linkage' ? 'text-[#FF6B5B]' : ''}`}
                  aria-hidden="true"
                />
                <span>Entity Resolution</span>
              </span>
              <span className="font-mono tabular-nums text-xs opacity-80">{pendingCount}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('facilities')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'facilities'
                  ? 'bg-[#F4EDE0]/14 text-[#F4EDE0] border border-[#FF6B5B]/45'
                  : 'text-[#F4EDE0]/74 hover:bg-[#F4EDE0]/8 hover:text-[#F4EDE0]'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Building2
                  className={`w-4 h-4 shrink-0 ${activeTab === 'facilities' ? 'text-[#FF6B5B]' : ''}`}
                  aria-hidden="true"
                />
                <span>Clinic Endpoints</span>
              </span>
              <span className="font-mono tabular-nums text-xs opacity-80">{facilities.length}</span>
            </button>
          </nav>

          <div className="pt-4 border-t border-[#F4EDE0]/12 space-y-2.5">
            <button
              type="button"
              onClick={() => navigate('register')}
              className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs rounded-xl btn-coral cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Register New Migrant</span>
            </button>
            <button
              type="button"
              onClick={triggerLoadingPreview}
              className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-medium rounded-xl btn-glass cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Refresh Registry Sync</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('audit')}
              className="w-full text-center px-3 py-2 text-xs text-[#F4EDE0]/75 hover:text-[#FF6B5B] hover:underline cursor-pointer"
            >
              Open System Audit Log
            </button>
          </div>
        </aside>

        {/* Main Admin Content */}
        <main className="flex-1 min-w-0 w-full space-y-6">
          {statusFeedback && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 bg-[#F4EDE0]/10 border border-[#F4EDE0]/25 text-[#F4EDE0] px-4 py-3 rounded-xl text-sm"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#FF6B5B] shrink-0" aria-hidden="true" />
                <span>{statusFeedback}</span>
              </div>
              <button
                type="button"
                onClick={() => setStatusFeedback('')}
                className="text-xs text-[#FF6B5B] underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeTab === 'corridors' && (
            <>
              {/* Map + Corridor Selector Split */}
              <section className="glass-panel rounded-2xl p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="font-editorial text-xl sm:text-2xl font-medium text-[#F4EDE0]">
                      Inter-State Migration Corridors &amp; Privacy-Preserving Distribution
                    </h2>
                    <p className="text-xs text-[#F4EDE0]/68 mt-1">
                      Surveillance opt-in: {surveillanceReport.optedInCount} of{' '}
                      {surveillanceReport.totalRegisteredPatients} profiles (k ≥{' '}
                      {surveillanceReport.minimumCohortSize};{' '}
                      {surveillanceReport.excludedOptOutCount} opted-out excluded,{' '}
                      {surveillanceReport.suppressedCorridorCount} small route(s) suppressed).
                    </p>
                  </div>
                  {corridorFilter !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() => setCorridorFilter('ALL')}
                      className="text-xs font-medium text-[#FF6B5B] hover:underline self-start sm:self-auto cursor-pointer"
                    >
                      Clear corridor filter ({corridorFilter})
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                  <div className="xl:col-span-6">
                    <IndiaMigrationMap
                      surveillanceReport={surveillanceReport}
                      selectedCorridor={corridorFilter}
                      onSelectCorridor={setCorridorFilter}
                    />
                  </div>

                  <div className="xl:col-span-6 border border-[#F4EDE0]/14 rounded-xl overflow-hidden bg-[#0D172B]/55">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-[#F4EDE0]/[0.04] border-b border-[#F4EDE0]/12 text-xs font-medium text-[#F4EDE0]/68">
                          <th className="py-3 px-3.5">Surveillance Cohort Route</th>
                          <th className="py-3 px-3 text-right">Profiles</th>
                          <th className="py-3 px-3 text-right">High Risk</th>
                          <th className="py-3 px-3 text-right">Unlinked</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F4EDE0]/10">
                        {surveillanceReport.corridors.map((c) => {
                          const selected = corridorFilter === c.corridorKey;
                          return (
                            <tr
                              key={c.corridorKey}
                              className={selected ? 'bg-[#FF6B5B]/12' : 'hover:bg-[#F4EDE0]/[0.04]'}
                            >
                              <td className="py-3 px-3.5">
                                {c.suppressed ? (
                                  <span className="font-medium text-[#F4EDE0]/60">
                                    {c.corridorKey}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCorridorFilter(selected ? 'ALL' : c.corridorKey)
                                    }
                                    className="font-medium text-[#F4EDE0] hover:text-[#FF6B5B] hover:underline text-left cursor-pointer"
                                  >
                                    {c.corridorKey}
                                  </button>
                                )}
                              </td>
                              <td className="py-3 px-3 text-right font-mono tabular-nums text-[#F4EDE0]">
                                {c.displayCount}
                              </td>
                              <td
                                className={`py-3 px-3 text-right font-mono tabular-nums ${
                                  (c.highRiskCount ?? 0) > 0
                                    ? 'text-[#FF6B5B] font-semibold'
                                    : 'text-[#F4EDE0]/68'
                                }`}
                              >
                                {c.highRiskCount !== null
                                  ? c.highRiskCount
                                  : `< ${surveillanceReport.minimumCohortSize}`}
                              </td>
                              <td className="py-3 px-3 text-right font-mono tabular-nums text-[#F4EDE0]/68">
                                {c.unlinkedCount !== null
                                  ? c.unlinkedCount
                                  : `< ${surveillanceReport.minimumCohortSize}`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              {/* Cohort Filter & Table */}
              <section className="glass-panel rounded-2xl p-6 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h2 className="font-editorial text-xl sm:text-2xl font-medium text-[#F4EDE0]">
                    Migrant Continuity-Risk Cohort
                  </h2>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                      <Search
                        className="w-4 h-4 text-[#F4EDE0]/55 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search name, ID, condition..."
                        aria-label="Search migrant cohort"
                        className="pl-10 pr-3.5 py-2 text-sm rounded-xl glass-input w-64"
                      />
                    </div>

                    <div
                      className="inline-flex items-center p-1 bg-[#0D172B]/75 border border-[#F4EDE0]/14 rounded-xl"
                      role="group"
                      aria-label="Filter by continuity risk tier"
                    >
                      {(['ALL', 'HIGH', 'MODERATE', 'LOW'] as const).map((tier) => (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => setRiskFilter(tier)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                            riskFilter === tier
                              ? 'bg-[#FF6B5B] text-[#0D172B] font-semibold'
                              : 'text-[#F4EDE0]/72 hover:text-[#F4EDE0]'
                          }`}
                        >
                          {tier === 'ALL' ? 'All Tiers' : tier}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {isSimulatingLoad ? (
                  <TableSkeleton rows={5} />
                ) : filteredPatients.length === 0 ? (
                  <div className="border border-dashed border-[#F4EDE0]/20 rounded-xl p-8 text-center space-y-3">
                    <p className="text-sm font-medium text-[#F4EDE0]">
                      No synthetic patient records match the active filters.
                    </p>
                    <p className="text-xs text-[#F4EDE0]/68">
                      Adjust the search query, corridor selection, or risk tier filter.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setRiskFilter('ALL');
                        setCorridorFilter('ALL');
                      }}
                      className="px-4 py-2 text-xs rounded-xl btn-coral cursor-pointer"
                    >
                      Clear All Filters
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-[#F4EDE0]/14 rounded-xl bg-[#0D172B]/55">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-[#F4EDE0]/[0.04] border-b border-[#F4EDE0]/12 text-xs font-medium text-[#F4EDE0]/68">
                          <th className="py-3 px-4">Patient &amp; Health ID</th>
                          <th className="py-3 px-4">Migration Corridor</th>
                          <th className="py-3 px-4">Linkage</th>
                          <th className="py-3 px-4">Continuity Risk</th>
                          <th className="py-3 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F4EDE0]/10">
                        {filteredPatients.map(({ patient, risk, corridor }) => (
                          <tr key={patient.healthId} className="hover:bg-[#F4EDE0]/[0.04] transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-medium text-[#F4EDE0]">{patient.fullName}</div>
                              <div className="text-xs font-mono tabular-nums text-[#F4EDE0]/62">
                                {patient.healthId} · {patient.age}y {patient.gender}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-[#F4EDE0]/90">
                              <div>{corridor}</div>
                              <div className="text-xs text-[#F4EDE0]/62">{patient.occupationSector}</div>
                            </td>
                            <td className="py-3 px-4">
                              <LinkageStatusLabel status={patient.recordLinkageStatus} />
                            </td>
                            <td className="py-3 px-4">
                              <RiskTierLabel tier={risk.tier} score={risk.score} />
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPatientId(patient.healthId);
                                  navigate('doctor');
                                }}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl btn-glass cursor-pointer whitespace-nowrap"
                              >
                                <span>Inspect Record</span>
                                <ArrowRight className="w-3.5 h-3.5 text-[#FF6B5B]" aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === 'linkage' && (
            <section className="glass-panel rounded-2xl p-6 space-y-5">
              <div>
                <h2 className="font-editorial text-xl sm:text-2xl font-medium text-[#F4EDE0]">
                  Probabilistic Entity-Resolution Queue
                </h2>
                <p className="text-sm text-[#F4EDE0]/70 mt-1">
                  Compare incoming state clinic encounters against existing unified Health IDs
                  using phonetic normalization, origin state, phone suffix, and demographic cohort
                  weights before merging timelines.
                </p>
              </div>

              <div className="space-y-4">
                {linkageCandidates.map((cand) => (
                  <div
                    key={cand.candidateId}
                    className="glass-card rounded-2xl p-5 space-y-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#F4EDE0]/68">
                          <span className="font-mono font-semibold text-[#F4EDE0]">
                            {cand.candidateId}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>Incoming Ref: {cand.incomingRecordRef}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {cand.incomingFacility} ({cand.incomingState})
                          </span>
                        </div>
                        <h3 className="text-base font-semibold text-[#F4EDE0] mt-1">
                          “{cand.incomingName}” → {cand.matchedPatientName} (
                          <span className="font-mono text-[#FF6B5B]">{cand.matchedHealthId}</span>)
                        </h3>
                      </div>

                      <div className="text-left sm:text-right shrink-0">
                        <div className="text-xs text-[#F4EDE0]/62">Composite Similarity</div>
                        <div className="text-lg font-mono font-semibold tabular-nums text-[#FF6B5B]">
                          {Math.round(cand.similarityScore * 100)}% ·{' '}
                          {cand.recommendation.replace('_', ' ')}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-[#F4EDE0]/10">
                      {cand.signals.map((sig) => (
                        <div key={sig.signal} className="bg-[#0D172B]/65 border border-[#F4EDE0]/10 rounded-xl p-3">
                          <div className="text-xs text-[#F4EDE0]/62">{sig.signal}</div>
                          <div className="text-sm font-medium text-[#F4EDE0] mt-0.5">
                            {sig.matchedValue}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <span className="text-xs font-medium text-[#F4EDE0]/68">
                        Queue Status:{' '}
                        <strong className="text-[#F4EDE0]">{cand.status}</strong>
                      </span>

                      {cand.status === 'PENDING' ? (
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => handleCandidateAction(cand.candidateId, 'REJECTED')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl btn-glass cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Mark Distinct</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCandidateAction(cand.candidateId, 'MERGED')}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded-xl btn-coral cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Merge &amp; Link Record</span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-[#FF6B5B]">
                          Adjudication complete
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'facilities' && (
            <section className="glass-panel rounded-2xl p-6 space-y-4">
              <div>
                <h2 className="font-editorial text-xl sm:text-2xl font-medium text-[#F4EDE0]">
                  Simulated Interoperating Clinic Network
                </h2>
                <p className="text-sm text-[#F4EDE0]/70 mt-1">
                  Synthetic PHC, CHC, and urban dispensary endpoints contributing encounters across
                  the active demonstration dataset.
                </p>
              </div>

              <div className="overflow-x-auto border border-[#F4EDE0]/14 rounded-xl bg-[#0D172B]/55">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#F4EDE0]/[0.04] border-b border-[#F4EDE0]/12 text-xs font-medium text-[#F4EDE0]/68">
                      <th className="py-3 px-4">Facility Name (Simulated)</th>
                      <th className="py-3 px-4">State &amp; District</th>
                      <th className="py-3 px-4">Adapter Source</th>
                      <th className="py-3 px-4 text-right">Encounters</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F4EDE0]/10">
                    {facilities.map((fac) => (
                      <tr key={`${fac.facilityName}-${fac.state}`} className="hover:bg-[#F4EDE0]/[0.04]">
                        <td className="py-3 px-4 font-medium text-[#F4EDE0]">{fac.facilityName}</td>
                        <td className="py-3 px-4 text-[#F4EDE0]/72">
                          {fac.district}, {fac.state}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-[#FF6B5B]">
                          {fac.sourceSystem}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-[#F4EDE0]">
                          {fac.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  FilePlus2,
  Pill,
  QrCode,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import { useHealthSystem } from '../context/HealthSystemContext.tsx';
import { applyInterStateConsent } from '../lib/consentGuard.ts';
import { assessContinuityRisk } from '../lib/continuityRisk.ts';
import { buildUnsignedQrPreview, serializeQrPayload } from '../lib/qrPayload.ts';
import { retrieveClinicalContext } from '../lib/ragEngine.ts';
import { INDIAN_STATES } from '../data/syntheticPatients.ts';
import type { ClaimVerificationReport } from '../lib/ragEngine.ts';
import type { QrHealthPassPayload, RagSourceChunk } from '../types/health.ts';
import {
  FormattedClinicalProse,
  LinkageStatusLabel,
  RiskTierLabel,
  SyntheticNoticeBanner,
} from './StatusPrimitives.tsx';

type DoctorTab = 'clinical' | 'timeline' | 'scanner';

interface AiRiskResponse {
  clinicalSummary: string;
  continuityActions: string[];
  patientCounselingNote: string;
  sources: RagSourceChunk[];
  model: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  sources?: RagSourceChunk[];
  claimVerification?: ClaimVerificationReport;
}

export const DoctorDashboard: React.FC = () => {
  const {
    patients,
    selectedPatient,
    setSelectedPatientId,
    consents,
    revokedPassIds,
    getAuthHeaders,
    user,
    addClinicalEncounter,
    logAccessEvent,
  } = useHealthSystem();

  const [activeTab, setActiveTab] = useState<DoctorTab>('clinical');
  const [patientFilter, setPatientFilter] = useState('');

  // Continuity-risk simulation sliders
  const [simMedGap, setSimMedGap] = useState(selectedPatient.medicationGapDays);
  const [simDaysSinceVisit, setSimDaysSinceVisit] = useState(selectedPatient.daysSinceLastVisit);
  const [simUnlinked, setSimUnlinked] = useState(
    selectedPatient.recordLinkageStatus !== 'LINKED',
  );

  // Gemini risk synthesis state
  const [aiRiskLoading, setAiRiskLoading] = useState(false);
  const [aiRiskError, setAiRiskError] = useState('');
  const [aiRiskOutput, setAiRiskOutput] = useState<AiRiskResponse | null>(null);

  // Gemini RAG clinical assistant state
  const [ragQuery, setRagQuery] = useState('');
  const [ragLoading, setRagLoading] = useState(false);
  const [ragError, setRagError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // New Encounter form state
  const [encFacility, setEncFacility] = useState('');
  const [encDistrict, setEncDistrict] = useState(selectedPatient.currentDistrict);
  const [encState, setEncState] = useState(selectedPatient.currentState);
  const [encType, setEncType] = useState<
    'Outpatient' | 'DOTS Follow-up' | 'Antenatal' | 'Occupational Screening' | 'Emergency'
  >('Outpatient');
  const [encDiagnosis, setEncDiagnosis] = useState('');
  const [encIcd, setEncIcd] = useState('');
  const [encMeds, setEncMeds] = useState('');
  const [encNotes, setEncNotes] = useState('');
  const [encError, setEncError] = useState('');
  const [encSuccess, setEncSuccess] = useState('');

  // QR Verification Scanner state
  const [qrInput, setQrInput] = useState('');
  const [qrVerifying, setQrVerifying] = useState(false);
  const [qrResult, setQrResult] = useState<
    | {
        ok: true;
        payload: QrHealthPassPayload;
        warnings?: string[];
        presentationCount?: number;
        serverVerifiedAt?: string;
      }
    | { ok: false; code?: string; error: string }
    | null
  >(null);

  useEffect(() => {
    setSimMedGap(selectedPatient.medicationGapDays);
    setSimDaysSinceVisit(selectedPatient.daysSinceLastVisit);
    setSimUnlinked(selectedPatient.recordLinkageStatus !== 'LINKED');
    setEncDistrict(selectedPatient.currentDistrict);
    setEncState(selectedPatient.currentState);
    setAiRiskOutput(null);
    setAiRiskError('');
    setMessages([]);
    setRagError('');
    setQrResult(null);
  }, [selectedPatient, user]);

  const filteredRoster = useMemo(() => {
    const q = patientFilter.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        p.healthId.toLowerCase().includes(q) ||
        p.currentState.toLowerCase().includes(q),
    );
  }, [patients, patientFilter]);

  const selectedConsent = consents[selectedPatient.healthId];

  const consentView = useMemo(
    () => applyInterStateConsent(selectedPatient, selectedConsent, 'doctor'),
    [selectedPatient, selectedConsent],
  );
  const scopedPatient = consentView.patient;

  const riskResult = useMemo(
    () =>
      assessContinuityRisk(scopedPatient, {
        medicationGapDays: simMedGap,
        daysSinceLastVisit: simDaysSinceVisit,
        unlinkedExternalRecords: simUnlinked,
      }),
    [scopedPatient, simMedGap, simDaysSinceVisit, simUnlinked],
  );

  const handleSynthesizeRisk = async () => {
    setAiRiskLoading(true);
    setAiRiskError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/ai/risk-assess', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          healthId: selectedPatient.healthId,
          simulationOverride: {
            medicationGapDays: simMedGap,
            daysSinceLastVisit: simDaysSinceVisit,
            unlinkedExternalRecords: simUnlinked,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error(
            'Authentication required (HTTP 401): Use Firebase Sign-In in the footer to invoke protected AI risk synthesis.',
          );
        }
        throw new Error(data.error || 'Failed to synthesize clinical handoff.');
      }
      setAiRiskOutput(data as AiRiskResponse);
    } catch (err) {
      setAiRiskError(err instanceof Error ? err.message : 'Unable to reach AI risk endpoint.');
    } finally {
      setAiRiskLoading(false);
    }
  };

  const handleAskRag = async (promptOverride?: string) => {
    const query = (promptOverride ?? ragQuery).trim();
    if (!query) return;
    setRagError('');
    setRagLoading(true);
    setMessages((prev) => [...prev, { role: 'user', text: query }]);
    if (!promptOverride) setRagQuery('');

    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          healthId: selectedPatient.healthId,
          query,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error(
            'Authentication required (HTTP 401): Use Firebase Sign-In in the footer for protected Gemini RAG queries.',
          );
        }
        throw new Error(data.error || 'Gemini RAG query failed.');
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.answer,
          sources: data.sources,
          claimVerification: data.claimVerification,
        },
      ]);
    } catch (err) {
      const fallbackChunks =
        consentView.consentRestricted && scopedPatient.encounters.length === 0
          ? []
          : retrieveClinicalContext(scopedPatient, query, 2);
      setRagError(
        `${err instanceof Error ? err.message : 'Assistant unavailable.'} ${
          fallbackChunks.length > 0
            ? 'Retrieved consent-scoped citations remain inspectable below.'
            : 'No external records may be displayed under active patient consent.'
        }`,
      );
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text:
            consentView.consentRestricted && scopedPatient.encounters.length === 0
              ? 'Inter-state record sharing is withheld by patient consent — origin metadata and encounters are redacted.'
              : `Grounded local encounter retrieval (${fallbackChunks.length} matching records found under active consent) — server Gemini synthesis unavailable.`,
          sources: fallbackChunks,
        },
      ]);
    } finally {
      setRagLoading(false);
    }
  };

  const handleAddEncounter = (e: React.FormEvent) => {
    e.preventDefault();
    setEncError('');
    setEncSuccess('');

    if (encFacility.trim().length < 3 || encDiagnosis.trim().length < 3) {
      setEncError('Please enter both the clinic facility name and primary clinical diagnosis.');
      return;
    }

    addClinicalEncounter(selectedPatient.healthId, {
      facilityName: encFacility.trim(),
      district: encDistrict.trim() || selectedPatient.currentDistrict,
      state: encState,
      encounterDate: new Date().toISOString().slice(0, 10),
      encounterType: encType,
      diagnosis: encDiagnosis.trim(),
      icdCode: encIcd.trim() || 'Z00.0',
      medications: encMeds
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
      followUpRequired: true,
      followUpDueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      clinicianName: 'Dr. Attending Clinician (Demo)',
      notes: encNotes.trim() || 'Cross-state continuity follow-up documented.',
      sourceSystem: 'MHIS Clinician Workbench',
    });

    setEncFacility('');
    setEncDiagnosis('');
    setEncIcd('');
    setEncMeds('');
    setEncNotes('');
    setEncSuccess(`Encounter appended to ${selectedPatient.fullName}'s longitudinal timeline.`);
  };

  const handleVerifyQr = async (rawString?: string) => {
    const target = rawString ?? qrInput;
    setQrVerifying(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/qr/verify', {
        method: 'POST',
        headers,
        body: JSON.stringify({ rawPayload: target, rejectReplay: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        setQrResult({
          ok: false,
          code: data.code || `HTTP_${res.status}`,
          error:
            res.status === 401
              ? 'Authentication required (HTTP 401): Use Firebase Sign-In in the footer with a clinician/admin account to verify Ed25519 QR passes.'
              : data.error || 'QR verification failed.',
        });
        return;
      }
      if (data.ok && revokedPassIds.includes(data.payload.passId)) {
        setQrResult({
          ok: false,
          code: 'REVOKED',
          error: `QR Health Pass ${data.payload.passId} has been revoked in the active session.`,
        });
        return;
      }
      setQrResult(data);
      if (data.ok) {
        void logAccessEvent({
          healthId: data.payload.healthId,
          patientName: data.payload.displayName,
          actorRole: 'doctor',
          actorName: user?.displayName || 'PHC Receiving Physician',
          facilityState: selectedPatient.currentState,
          action: 'Ed25519 QR Health Pass Verified',
          scope: data.payload.emergencyConsent ? 'Emergency QR Access' : 'Consent Restricted',
          purpose: `Server-verified pass ${data.payload.passId} (presentation #${data.presentationCount ?? 1})`,
        });
      }
    } catch {
      setQrResult({
        ok: false,
        error: 'Unable to reach server QR verification endpoint (/api/qr/verify).',
      });
    } finally {
      setQrVerifying(false);
    }
  };

  const getDefaultConsent = () =>
    consents[selectedPatient.healthId] ?? {
      healthId: selectedPatient.healthId,
      interStateSharing: true,
      emergencyQrAccess: true,
      anonymizedSurveillance: true,
      updatedAt: new Date().toISOString(),
      updatedByRole: 'patient' as const,
    };

  const fetchSignedDemoPayload = async (): Promise<QrHealthPassPayload | null> => {
    if (!user) return null;
    const headers = await getAuthHeaders();
    const res = await fetch('/api/qr/issue', {
      method: 'POST',
      headers,
      body: JSON.stringify({ healthId: selectedPatient.healthId }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { payload?: QrHealthPassPayload };
    return data.payload ?? null;
  };

  const simulateValidQr = async () => {
    const signed = await fetchSignedDemoPayload();
    const serialized = serializeQrPayload(
      signed ?? buildUnsignedQrPreview(selectedPatient, getDefaultConsent()),
    );
    setQrInput(serialized);
    void handleVerifyQr(serialized);
  };

  const simulateTamperedQr = async () => {
    const signed =
      (await fetchSignedDemoPayload()) ??
      buildUnsignedQrPreview(selectedPatient, getDefaultConsent());
    const tampered = JSON.stringify({ ...signed, bloodGroup: 'AB-' });
    setQrInput(tampered);
    void handleVerifyQr(tampered);
  };

  const simulateExpiredQr = async () => {
    const base =
      (await fetchSignedDemoPayload()) ??
      buildUnsignedQrPreview(selectedPatient, getDefaultConsent());
    const expired = JSON.stringify({
      ...base,
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-08T00:00:00.000Z',
    });
    setQrInput(expired);
    void handleVerifyQr(expired);
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pt-5 space-y-5">
      <SyntheticNoticeBanner compact />

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Clinical Patient Lookup Rail */}
        <aside className="w-full lg:w-72 shrink-0 glass-panel rounded-2xl p-4 space-y-4">
          <div className="pb-3.5 border-b border-[#F4EDE0]/12">
            <p className="text-[11px] font-mono uppercase tracking-wider text-[#FF6B5B]">
              Clinician Role
            </p>
            <h1 className="font-editorial text-2xl font-medium text-[#F4EDE0] mt-1">
              PHC Care Workbench
            </h1>
          </div>

          <div className="relative">
            <Search
              className="w-4 h-4 text-[#F4EDE0]/55 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={patientFilter}
              onChange={(e) => setPatientFilter(e.target.value)}
              placeholder="Lookup patient or Health ID..."
              aria-label="Filter patient roster"
              className="w-full pl-10 pr-3 py-2 text-xs rounded-xl glass-input"
            />
          </div>

          <div
            className="p-1.5 space-y-1 border border-[#F4EDE0]/14 rounded-xl max-h-[460px] overflow-y-auto bg-[#0D172B]/55"
            role="list"
            aria-label="Patient roster"
          >
            {filteredRoster.length === 0 ? (
              <p className="text-xs text-[#F4EDE0]/68 py-4 text-center">No matching patients.</p>
            ) : (
              filteredRoster.map((p) => {
                const active = p.healthId === selectedPatient.healthId;
                const r = assessContinuityRisk(p);
                return (
                  <button
                    key={p.healthId}
                    type="button"
                    onClick={() => setSelectedPatientId(p.healthId)}
                    className={`w-full text-left p-3 rounded-lg transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#FF6B5B]/16 text-[#F4EDE0] border border-[#FF6B5B]/45'
                        : 'border border-transparent hover:bg-[#F4EDE0]/[0.05] text-[#F4EDE0]/85'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{p.fullName}</span>
                      <span
                        className={`font-mono text-[11px] tabular-nums shrink-0 ${
                          r.tier === 'HIGH'
                            ? 'text-[#FF6B5B] font-semibold'
                            : r.tier === 'MODERATE'
                              ? 'text-[#F4EDE0]'
                              : 'text-[#F4EDE0]/62'
                        }`}
                      >
                        {r.score}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5 truncate text-[#F4EDE0]/62">
                      {consents[p.healthId]?.interStateSharing === false
                        ? `Origin Withheld → ${p.currentState}`
                        : `${p.originState} → ${p.currentState}`}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Main Clinical Chart Workspace */}
        <main className="flex-1 min-w-0 w-full space-y-6">
          {/* Active Clinical Chart Banner */}
          <section className="glass-panel rounded-2xl p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#F4EDE0]/68">
                  <span className="font-mono font-semibold text-[#FF6B5B]">
                    {selectedPatient.healthId}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {selectedPatient.age}y {selectedPatient.gender}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Blood Group {selectedPatient.bloodGroup}</span>
                  <span aria-hidden="true">·</span>
                  <span>Language: {selectedPatient.primaryLanguage}</span>
                </div>
                <h2 className="font-editorial text-2xl sm:text-3xl font-medium text-[#F4EDE0]">
                  {selectedPatient.fullName}
                </h2>
                <p className="text-sm text-[#F4EDE0]/72">
                  Corridor:{' '}
                  <strong className="text-[#F4EDE0]">
                    {consentView.consentRestricted
                      ? 'Origin Withheld (Consent Required)'
                      : `${scopedPatient.originDistrict}, ${scopedPatient.originState}`}
                  </strong>{' '}
                  →{' '}
                  <strong className="text-[#F4EDE0]">
                    {scopedPatient.currentDistrict}, {scopedPatient.currentState}
                  </strong>
                  {' · '}Allergies:{' '}
                  <strong className="text-[#FF6B5B]">{selectedPatient.allergies.join(', ')}</strong>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <LinkageStatusLabel status={selectedPatient.recordLinkageStatus} />
                <RiskTierLabel tier={riskResult.tier} score={riskResult.score} />
              </div>
            </div>

            {/* Active Medication Summary Strip */}
            <div className="glass-card rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#FF6B5B]">
                <Pill className="w-3.5 h-3.5" aria-hidden="true" />
                Active Regimen:
              </span>
              <span className="text-[#F4EDE0]/88">
                {consentView.consentRestricted && scopedPatient.activeMedications.length === 0
                  ? 'Withheld pending patient inter-state sharing consent'
                  : scopedPatient.activeMedications.join(' · ') || 'No active chronic prescriptions'}
              </span>
            </div>

            {consentView.consentRestricted && (
              <div
                role="status"
                className="flex items-start gap-2 bg-[#FF6B5B]/12 border border-[#FF6B5B]/35 text-[#F4EDE0] px-4 py-3 rounded-xl text-xs"
              >
                <AlertCircle className="w-4 h-4 text-[#FF6B5B] shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <strong className="block text-[#FF6B5B]">
                    Inter-State Sharing Restricted by Patient Consent
                  </strong>
                  <span className="text-[#F4EDE0]/82">
                    {consentView.restrictionReason} ({consentView.withheldEncounterCount} external
                    encounter(s) withheld from clinician timeline and RAG indexing.)
                  </span>
                </div>
              </div>
            )}

            {/* Clinical Chart Sub-navigation Tabs */}
            <div className="pt-3 border-t border-[#F4EDE0]/12 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('clinical')}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded-xl cursor-pointer whitespace-nowrap ${
                  activeTab === 'clinical'
                    ? 'btn-coral'
                    : 'btn-glass font-medium'
                }`}
              >
                <Activity className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Continuity Risk &amp; Gemini RAG</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('timeline')}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded-xl cursor-pointer whitespace-nowrap ${
                  activeTab === 'timeline'
                    ? 'btn-coral'
                    : 'btn-glass font-medium'
                }`}
              >
                <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Medical Timeline ({scopedPatient.encounters.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('scanner')}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded-xl cursor-pointer whitespace-nowrap ${
                  activeTab === 'scanner'
                    ? 'btn-coral'
                    : 'btn-glass font-medium'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
                <span>QR Pass Verification</span>
              </button>
            </div>
          </section>

          {activeTab === 'clinical' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              {/* Continuity-Risk Assessment + Handoff Synthesis */}
              <section className="xl:col-span-6 glass-panel rounded-2xl p-6 space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-editorial text-xl font-medium text-[#F4EDE0]">
                        Continuity-of-Care Risk Engine
                      </h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-[#FF6B5B]/15 border border-[#FF6B5B]/35 text-[#FF6B5B] rounded-md">
                        Experimental · Non-Diagnostic
                      </span>
                    </div>
                    <p className="text-xs text-[#F4EDE0]/68 mt-1">
                      Deterministic triage heuristic (not clinically validated) with interactive sensitivity controls.
                    </p>
                  </div>
                  <div className="text-right font-mono tabular-nums whitespace-nowrap shrink-0">
                    <span className="text-2xl font-semibold text-[#FF6B5B]">{riskResult.score}</span>
                    <span className="text-xs text-[#F4EDE0]/60"> / 100</span>
                  </div>
                </div>

                {/* Factor Breakdown */}
                <div className="space-y-3.5">
                  {riskResult.factors.map((f) => (
                    <div key={f.factor} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#F4EDE0]">{f.factor}</span>
                        <span className="font-mono tabular-nums text-[#F4EDE0]/72">
                          {f.points} / {f.maxPoints}
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-[#F4EDE0]/12 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            f.points / f.maxPoints >= 0.7
                              ? 'bg-[#FF6B5B]'
                              : f.points / f.maxPoints >= 0.4
                                ? 'bg-[#F4EDE0]'
                                : 'bg-[#F4EDE0]/65'
                          }`}
                          style={{ width: `${Math.round((f.points / f.maxPoints) * 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-[#F4EDE0]/68">{f.rationale}</p>
                    </div>
                  ))}
                </div>

                {/* Interactive Clinical What-If Controls */}
                <div className="pt-4 border-t border-[#F4EDE0]/12 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#F4EDE0]">
                      Simulate Continuity Variables
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSimMedGap(selectedPatient.medicationGapDays);
                        setSimDaysSinceVisit(selectedPatient.daysSinceLastVisit);
                        setSimUnlinked(selectedPatient.recordLinkageStatus !== 'LINKED');
                      }}
                      className="text-xs text-[#FF6B5B] hover:underline cursor-pointer"
                    >
                      Reset to Record
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="block text-xs text-[#F4EDE0]/72">
                      Medication Gap:{' '}
                      <strong className="font-mono text-[#F4EDE0]">{simMedGap} days</strong>
                      <input
                        type="range"
                        min={0}
                        max={30}
                        value={simMedGap}
                        onChange={(e) => setSimMedGap(Number(e.target.value))}
                        className="mt-1.5 w-full accent-[#FF6B5B]"
                      />
                    </label>
                    <label className="block text-xs text-[#F4EDE0]/72">
                      Days Since Visit:{' '}
                      <strong className="font-mono text-[#F4EDE0]">{simDaysSinceVisit} days</strong>
                      <input
                        type="range"
                        min={0}
                        max={60}
                        value={simDaysSinceVisit}
                        onChange={(e) => setSimDaysSinceVisit(Number(e.target.value))}
                        className="mt-1.5 w-full accent-[#FF6B5B]"
                      />
                    </label>
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs text-[#F4EDE0]/88 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={simUnlinked}
                      onChange={(e) => setSimUnlinked(e.target.checked)}
                      className="accent-[#FF6B5B]"
                    />
                    <span>Simulate unlinked external state clinic record</span>
                  </label>
                </div>

                <div className="glass-card rounded-xl p-3.5 text-xs text-[#F4EDE0]/88 space-y-1.5">
                  <div>
                    <span className="font-semibold text-[#F4EDE0]">Deterministic Triage Action: </span>
                    {riskResult.recommendedAction}
                  </div>
                  {riskResult.methodologyNote && (
                    <p className="text-[11px] text-[#F4EDE0]/62 border-t border-[#F4EDE0]/10 pt-1.5">
                      {riskResult.methodologyNote}
                    </p>
                  )}
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => void handleSynthesizeRisk()}
                    disabled={aiRiskLoading}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm rounded-xl btn-coral disabled:opacity-60 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {aiRiskLoading
                        ? 'Synthesizing Grounded Handoff...'
                        : 'Synthesize Clinical Handoff with Gemini'}
                    </span>
                  </button>
                </div>

                {aiRiskError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 bg-[#FF6B5B]/15 border border-[#FF6B5B]/40 text-[#F4EDE0] p-3 rounded-xl text-xs"
                  >
                    <AlertCircle className="w-4 h-4 text-[#FF6B5B] shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{aiRiskError}</span>
                  </div>
                )}

                {aiRiskOutput && (
                  <div className="border border-[#F4EDE0]/20 bg-[#0D172B]/75 rounded-xl p-4 space-y-3 text-xs text-[#F4EDE0]/88">
                    <div className="font-semibold text-[#FF6B5B]">
                      Gemini Handoff Synthesis ({aiRiskOutput.model})
                    </div>
                    <p className="leading-relaxed">{aiRiskOutput.clinicalSummary}</p>
                    <ul className="list-disc pl-4 space-y-1">
                      {aiRiskOutput.continuityActions.map((act, idx) => (
                        <li key={idx}>{act}</li>
                      ))}
                    </ul>
                    <p className="pt-2 border-t border-[#F4EDE0]/12 text-[#F4EDE0]/72">
                      <strong className="text-[#F4EDE0]">
                        Patient Counseling ({selectedPatient.primaryLanguage}):{' '}
                      </strong>
                      {aiRiskOutput.patientCounselingNote}
                    </p>
                  </div>
                )}
              </section>

              {/* Gemini Clinical RAG Assistant */}
              <section className="xl:col-span-6 glass-panel rounded-2xl p-6 flex flex-col space-y-4">
                <div>
                  <h3 className="font-editorial text-xl font-medium text-[#F4EDE0]">
                    Gemini Clinical RAG Assistant
                  </h3>
                  <p className="text-xs text-[#F4EDE0]/68 mt-1">
                    Queries are grounded over retrieved cross-state encounters for{' '}
                    {selectedPatient.fullName}. Consent sharing:{' '}
                    <strong className="text-[#FF6B5B]">
                      {selectedConsent?.interStateSharing ? 'Authorized' : 'Restricted'}
                    </strong>
                    .
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {[
                    'Summarize prior medications and allergies across states.',
                    'What follow-up action is overdue right now?',
                    'Draft brief discharge advice in plain language.',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => void handleAskRag(preset)}
                      disabled={ragLoading}
                      className="text-left px-3 py-2 text-xs rounded-xl btn-glass cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div className="min-h-[260px] max-h-[380px] overflow-y-auto border border-[#F4EDE0]/14 rounded-xl bg-[#0D172B]/65 p-4 space-y-4">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-10 space-y-2">
                      <p className="text-sm font-medium text-[#F4EDE0]">
                        Ready for clinical record retrieval
                      </p>
                      <p className="text-xs text-[#F4EDE0]/65 max-w-sm">
                        Select a clinical prompt above or submit a question to retrieve cited
                        encounters and synthesize a grounded summary.
                      </p>
                    </div>
                  ) : (
                    messages.map((msg, i) => (
                      <div
                        key={i}
                        className={`p-3.5 rounded-xl text-sm space-y-2 ${
                          msg.role === 'user'
                            ? 'bg-[#FF6B5B] text-[#0D172B] ml-6 font-medium'
                            : 'bg-[#14213D]/90 border border-[#F4EDE0]/14 text-[#F4EDE0] mr-4'
                        }`}
                      >
                        <div className="text-[11px] font-mono uppercase tracking-wider opacity-75">
                          {msg.role === 'user' ? 'Clinician Query' : 'Grounded RAG Response'}
                        </div>
                        {msg.role === 'assistant' ? (
                          <FormattedClinicalProse text={msg.text} />
                        ) : (
                          <p className="whitespace-pre-line leading-relaxed text-xs sm:text-sm">
                            {msg.text}
                          </p>
                        )}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="pt-2 border-t border-[#F4EDE0]/12 space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold text-[#FF6B5B]">
                                Retrieved Encounter Citations
                              </span>
                              {msg.claimVerification && (
                                <span className="text-[10px] font-mono text-[#F4EDE0]/68">
                                  Claim Entailment: {Math.round(msg.claimVerification.supportedRate * 100)}% verified
                                  {msg.claimVerification.unsupportedClaims > 0
                                    ? ` · ${msg.claimVerification.unsupportedClaims} flagged`
                                    : ''}
                                </span>
                              )}
                            </div>
                            {msg.sources.map((src) => (
                              <div key={src.chunkId} className="text-[11px] text-[#F4EDE0]/72">
                                <span className="font-mono font-semibold text-[#F4EDE0]">
                                  [{src.encounterId}]
                                </span>{' '}
                                {src.date} · {src.state} — {src.title}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {ragError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 bg-[#FF6B5B]/15 border border-[#FF6B5B]/40 text-[#F4EDE0] p-3 rounded-xl text-xs"
                  >
                    <AlertCircle className="w-4 h-4 text-[#FF6B5B] shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{ragError}</span>
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleAskRag();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={ragQuery}
                    onChange={(e) => setRagQuery(e.target.value)}
                    placeholder="Ask about prior diagnoses, regimens, or transit gaps..."
                    aria-label="Clinical RAG query"
                    className="flex-1 px-3.5 py-2.5 text-sm rounded-xl glass-input"
                  />
                  <button
                    type="submit"
                    disabled={ragLoading || !ragQuery.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm rounded-xl btn-coral disabled:opacity-50 cursor-pointer whitespace-nowrap"
                  >
                    <Send className="w-4 h-4" aria-hidden="true" />
                    <span>{ragLoading ? 'Querying...' : 'Ask'}</span>
                  </button>
                </form>
              </section>
            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              {/* Longitudinal Multi-State Timeline */}
              <section className="xl:col-span-7 glass-panel rounded-2xl p-6 space-y-4">
                <h3 className="font-editorial text-xl font-medium text-[#F4EDE0]">
                  Cross-State Medical Timeline
                </h3>

                <div className="divide-y divide-[#F4EDE0]/10 border border-[#F4EDE0]/14 rounded-xl bg-[#0D172B]/55">
                  {scopedPatient.encounters.length === 0 ? (
                    <p className="p-6 text-xs text-[#F4EDE0]/68 text-center">
                      No encounters available in the receiving state under the patient&apos;s active
                      consent settings.
                    </p>
                  ) : (
                    scopedPatient.encounters.map((enc) => (
                      <article key={enc.encounterId} className="p-4 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#F4EDE0]/68">
                          <span className="font-mono font-semibold text-[#FF6B5B]">
                            {enc.encounterId} · {enc.encounterDate}
                          </span>
                          <span>
                            {enc.district}, {enc.state} · {enc.sourceSystem}
                          </span>
                        </div>
                        <h4 className="text-sm font-semibold text-[#F4EDE0]">
                          {enc.encounterType}: {enc.diagnosis}{' '}
                          <span className="font-mono text-xs text-[#F4EDE0]/62">({enc.icdCode})</span>
                        </h4>
                        <p className="text-xs text-[#F4EDE0]/72 leading-relaxed">{enc.notes}</p>
                        <div className="pt-2 border-t border-[#F4EDE0]/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-[#F4EDE0]/88">
                            <strong>Medications:</strong> {enc.medications.join(', ') || 'None'}
                          </span>
                          <span className="text-[#F4EDE0]/62">{enc.clinicianName}</span>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>

              {/* Log New Encounter Form */}
              <section className="xl:col-span-5 glass-panel rounded-2xl p-6 space-y-4">
                <h3 className="font-editorial text-xl font-medium text-[#F4EDE0]">
                  Log Cross-State Encounter
                </h3>

                {encError && (
                  <div
                    role="alert"
                    className="bg-[#FF6B5B]/15 border border-[#FF6B5B]/40 text-[#F4EDE0] px-3 py-2 rounded-xl text-xs"
                  >
                    {encError}
                  </div>
                )}
                {encSuccess && (
                  <div
                    role="status"
                    className="bg-[#F4EDE0]/10 border border-[#F4EDE0]/25 text-[#F4EDE0] px-3 py-2 rounded-xl text-xs flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-[#FF6B5B] shrink-0" aria-hidden="true" />
                    <span>{encSuccess}</span>
                  </div>
                )}

                <form onSubmit={handleAddEncounter} className="space-y-3">
                  <div>
                    <label htmlFor="enc-facility" className="block text-xs font-medium text-[#F4EDE0]/82">
                      Clinic / PHC Facility Name *
                    </label>
                    <input
                      id="enc-facility"
                      type="text"
                      value={encFacility}
                      onChange={(e) => setEncFacility(e.target.value)}
                      placeholder="e.g., Thane Municipal Urban PHC"
                      className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="enc-state" className="block text-xs font-medium text-[#F4EDE0]/82">
                        State
                      </label>
                      <select
                        id="enc-state"
                        value={encState}
                        onChange={(e) => setEncState(e.target.value)}
                        className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
                      >
                        {INDIAN_STATES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="enc-district" className="block text-xs font-medium text-[#F4EDE0]/82">
                        District
                      </label>
                      <input
                        id="enc-district"
                        type="text"
                        value={encDistrict}
                        onChange={(e) => setEncDistrict(e.target.value)}
                        className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="enc-type" className="block text-xs font-medium text-[#F4EDE0]/82">
                        Encounter Type
                      </label>
                      <select
                        id="enc-type"
                        value={encType}
                        onChange={(e) => setEncType(e.target.value as typeof encType)}
                        className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
                      >
                        <option value="Outpatient">Outpatient</option>
                        <option value="DOTS Follow-up">DOTS Follow-up</option>
                        <option value="Antenatal">Antenatal</option>
                        <option value="Occupational Screening">Occupational Screening</option>
                        <option value="Emergency">Emergency</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="enc-icd" className="block text-xs font-medium text-[#F4EDE0]/82">
                        ICD-10 Code
                      </label>
                      <input
                        id="enc-icd"
                        type="text"
                        value={encIcd}
                        onChange={(e) => setEncIcd(e.target.value)}
                        placeholder="e.g., A15.0"
                        className="mt-1 w-full px-3 py-2 text-sm font-mono rounded-xl glass-input"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="enc-dx" className="block text-xs font-medium text-[#F4EDE0]/82">
                      Clinical Diagnosis *
                    </label>
                    <input
                      id="enc-dx"
                      type="text"
                      value={encDiagnosis}
                      onChange={(e) => setEncDiagnosis(e.target.value)}
                      placeholder="Primary clinical finding"
                      className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
                    />
                  </div>

                  <div>
                    <label htmlFor="enc-meds" className="block text-xs font-medium text-[#F4EDE0]/82">
                      Dispensed Medications (comma-separated)
                    </label>
                    <input
                      id="enc-meds"
                      type="text"
                      value={encMeds}
                      onChange={(e) => setEncMeds(e.target.value)}
                      placeholder="e.g., HRZE 14-day pack, Pyridoxine 20mg"
                      className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
                    />
                  </div>

                  <div>
                    <label htmlFor="enc-notes" className="block text-xs font-medium text-[#F4EDE0]/82">
                      Clinical Handoff Notes
                    </label>
                    <textarea
                      id="enc-notes"
                      rows={3}
                      value={encNotes}
                      onChange={(e) => setEncNotes(e.target.value)}
                      placeholder="Follow-up instructions or interstate referral context..."
                      className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full px-4 py-2.5 text-sm rounded-xl btn-coral cursor-pointer"
                  >
                    Save Clinical Encounter
                  </button>
                </form>
              </section>
            </div>
          )}

          {activeTab === 'scanner' && (
            <section className="glass-panel rounded-2xl p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-editorial text-xl font-medium text-[#F4EDE0]">
                    QR Health Pass Verification Scanner
                  </h3>
                  <p className="text-xs text-[#F4EDE0]/68 mt-1">
                    Validate Ed25519 MHIS-QR-v2 signatures, enforce authoritative Firestore emergency consent,
                    and record point-of-care reads to the audit trail.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void simulateValidQr()}
                    className="px-3.5 py-2 text-xs rounded-xl btn-coral cursor-pointer"
                  >
                    Simulate Valid QR Scan
                  </button>
                  <button
                    type="button"
                    onClick={() => void simulateTamperedQr()}
                    className="px-3.5 py-2 text-xs font-medium text-[#FF6B5B] bg-[#FF6B5B]/12 hover:bg-[#FF6B5B]/20 border border-[#FF6B5B]/35 rounded-xl cursor-pointer"
                  >
                    Test Tampered Signature
                  </button>
                  <button
                    type="button"
                    onClick={() => void simulateExpiredQr()}
                    className="px-3.5 py-2 text-xs font-medium rounded-xl btn-glass cursor-pointer"
                  >
                    Test Expired QR
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="qr-payload-input" className="block text-xs font-medium text-[#F4EDE0]/82">
                  Scanned or Pasted MHIS-QR-v2 Ed25519 Payload
                </label>
                <textarea
                  id="qr-payload-input"
                  rows={4}
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  placeholder='{"schema":"MHIS-QR-v2",...}'
                  className="w-full p-3.5 text-xs font-mono rounded-xl glass-input"
                />
                <button
                  type="button"
                  disabled={qrVerifying}
                  onClick={() => void handleVerifyQr()}
                  className="px-5 py-2.5 text-xs rounded-xl btn-coral disabled:opacity-60 cursor-pointer"
                >
                  {qrVerifying ? 'Verifying on Server...' : 'Verify & Decode QR Pass'}
                </button>
              </div>

              {qrResult && (
                <div
                  role="status"
                  className={`border rounded-xl p-4 text-sm ${
                    qrResult.ok
                      ? 'bg-[#0D172B]/75 border-[#F4EDE0]/25 text-[#F4EDE0]'
                      : 'bg-[#FF6B5B]/14 border-[#FF6B5B]/45 text-[#F4EDE0]'
                  }`}
                >
                  {qrResult.ok ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 font-semibold text-[#F4EDE0]">
                        <CheckCircle2 className="w-4 h-4 text-[#FF6B5B]" aria-hidden="true" />
                        <span>
                          Server-Verified · Valid Portable Health Pass ({qrResult.payload.passId})
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs pt-2">
                        <div>
                          <span className="text-[#F4EDE0]/60 block">Patient / Health ID</span>
                          <strong>{qrResult.payload.displayName}</strong> ({qrResult.payload.healthId})
                        </div>
                        <div>
                          <span className="text-[#F4EDE0]/60 block">Blood Group &amp; Language</span>
                          <strong>{qrResult.payload.bloodGroup}</strong> ·{' '}
                          {qrResult.payload.primaryLanguage}
                        </div>
                        <div>
                          <span className="text-[#F4EDE0]/60 block">Validity &amp; Key Version</span>
                          <strong className="font-mono">
                            {qrResult.payload.issuedAt.slice(0, 10)} →{' '}
                            {qrResult.payload.expiresAt.slice(0, 10)} ({qrResult.payload.kid} v
                            {qrResult.payload.keyVersion})
                          </strong>
                        </div>
                        <div>
                          <span className="text-[#F4EDE0]/60 block">Emergency Consent</span>
                          <strong>
                            {qrResult.payload.emergencyConsent ? 'Granted' : 'Restricted'}
                          </strong>
                        </div>
                      </div>
                      <div className="text-xs pt-1 text-[#F4EDE0]/85">
                        <strong>Allergies:</strong> {qrResult.payload.allergies.join(', ')}
                        {' · '}
                        <strong>Active Conditions:</strong>{' '}
                        {qrResult.payload.activeConditions.join(', ')}
                      </div>
                      {qrResult.warnings && qrResult.warnings.length > 0 && (
                        <div className="text-xs text-[#F4EDE0] bg-[#FF6B5B]/15 border border-[#FF6B5B]/35 px-3 py-2 rounded-xl">
                          <strong>Replay Audit Notice:</strong> {qrResult.warnings.join(' ')} (Scan
                          count: {qrResult.presentationCount})
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-xs">
                      <AlertCircle className="w-4 h-4 text-[#FF6B5B] shrink-0 mt-0.5" aria-hidden="true" />
                      <div>
                        <strong className="block text-[#FF6B5B]">
                          QR Verification Failed{qrResult.code ? ` (${qrResult.code})` : ''}
                        </strong>
                        <span className="text-[#F4EDE0]/88">{qrResult.error}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
};

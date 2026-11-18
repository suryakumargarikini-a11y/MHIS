import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  MapPin,
  Printer,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useHealthSystem } from '../context/HealthSystemContext.tsx';
import { INDIAN_STATES } from '../data/syntheticPatients.ts';
import { buildUnsignedQrPreview, serializeQrPayload } from '../lib/qrPayload.ts';
import type { QrHealthPassPayload } from '../types/health.ts';
import {
  FormattedClinicalProse,
  QrCodeGraphic,
  SyntheticNoticeBanner,
} from './StatusPrimitives.tsx';

export const PatientDashboard: React.FC = () => {
  const {
    patients,
    selectedPatient,
    setSelectedPatientId,
    assignedPatientId,
    effectiveRole,
    sandboxRoleLocked,
    user,
    consents,
    getAuthHeaders,
    recordMigrationMove,
    navigate,
  } = useHealthSystem();

  const isPatientIsolated =
    effectiveRole === 'patient' && (Boolean(user) || sandboxRoleLocked);

  const [copied, setCopied] = useState(false);
  const [signedQrPayload, setSignedQrPayload] = useState<QrHealthPassPayload | null>(null);
  const [qrIssueLoading, setQrIssueLoading] = useState(false);
  const [passFeedback, setPassFeedback] = useState('');
  const [passError, setPassError] = useState('');
  const [moveState, setMoveState] = useState(selectedPatient.currentState);
  const [moveDistrict, setMoveDistrict] = useState('');
  const [moveSector, setMoveSector] = useState(selectedPatient.occupationSector);
  const [moveFeedback, setMoveFeedback] = useState('');

  const [patientQuery, setPatientQuery] = useState('');
  const [assistantReply, setAssistantReply] = useState('');
  const [assistantError, setAssistantError] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);

  const consent = consents[selectedPatient.healthId] ?? {
    healthId: selectedPatient.healthId,
    interStateSharing: true,
    emergencyQrAccess: true,
    anonymizedSurveillance: true,
    updatedAt: selectedPatient.updatedAt,
    updatedByRole: 'patient',
  };

  const issueServerSignedQr = useCallback(async () => {
    if (!user) {
      setSignedQrPayload(null);
      return;
    }
    setQrIssueLoading(true);
    setPassError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/qr/issue', {
        method: 'POST',
        headers,
        body: JSON.stringify({ healthId: selectedPatient.healthId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        payload?: QrHealthPassPayload;
        error?: string;
      };
      if (!res.ok || !data.payload) {
        setSignedQrPayload(null);
        setPassError(data.error || `Unable to issue server-signed QR pass (HTTP ${res.status}).`);
        return;
      }
      setSignedQrPayload(data.payload);
    } catch {
      setSignedQrPayload(null);
      setPassError('Unable to reach server Ed25519 QR issuance endpoint (/api/qr/issue).');
    } finally {
      setQrIssueLoading(false);
    }
  }, [user, getAuthHeaders, selectedPatient.healthId]);

  useEffect(() => {
    setPassFeedback('');
    setPassError('');
    setAssistantReply('');
    setAssistantError('');
    setMoveState(selectedPatient.currentState);
    setMoveSector(selectedPatient.occupationSector);
    void issueServerSignedQr();
  }, [
    selectedPatient.healthId,
    selectedPatient.currentState,
    selectedPatient.occupationSector,
    consent.emergencyQrAccess,
    issueServerSignedQr,
  ]);

  const previewQrPayload = useMemo(
    () => buildUnsignedQrPreview(selectedPatient, consent),
    [selectedPatient, consent],
  );
  const activeQrPayload = signedQrPayload ?? previewQrPayload;
  const qrPayloadString = useMemo(() => serializeQrPayload(activeQrPayload), [activeQrPayload]);

  const handleRevokeAndRotatePass = async () => {
    const oldPassId = activeQrPayload.passId;
    setPassError('');
    setPassFeedback('');
    if (!user) {
      setPassError(
        'Authentication required (HTTP 401): Sign in via Firebase Sign-In in the footer to revoke and reissue Ed25519-signed QR passes on the server.',
      );
      return;
    }
    setQrIssueLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/qr/reissue', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          healthId: selectedPatient.healthId,
          previousPassId: oldPassId,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        payload?: QrHealthPassPayload;
        error?: string;
      };
      if (!res.ok || !data.payload) {
        setPassError(data.error || `Controlled QR reissuance returned HTTP ${res.status}.`);
        return;
      }
      setSignedQrPayload(data.payload);
      setPassFeedback(
        `Pass ${oldPassId} revoked and reissued under ${data.payload.kid} (v${data.payload.keyVersion}) as ${data.payload.passId}.`,
      );
    } catch {
      setPassError('Unable to reach server controlled QR reissuance endpoint (/api/qr/reissue).');
    } finally {
      setQrIssueLoading(false);
    }
  };

  const handleCopyQr = async () => {
    try {
      await navigator.clipboard.writeText(qrPayloadString);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleMigrationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveDistrict.trim()) return;
    await recordMigrationMove(
      selectedPatient.healthId,
      moveState,
      moveDistrict.trim(),
      moveSector.trim(),
    );
    setMoveDistrict('');
    setMoveFeedback(`Location updated to ${moveDistrict.trim()}, ${moveState}.`);
  };

  const askCareCompanion = async (promptText?: string) => {
    const q = (promptText ?? patientQuery).trim();
    if (!q) return;
    setAssistantLoading(true);
    setAssistantError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          healthId: selectedPatient.healthId,
          query: q,
        }),
      });
      const contentType = res.headers.get('content-type') ?? '';
      const data = contentType.includes('application/json')
        ? await res.json()
        : { error: `Server error (HTTP ${res.status}): ${await res.text().then((t) => t.slice(0, 200))}` };
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error(
            'Authentication required (HTTP 401): Use Firebase Sign-In in the footer to query the protected Gemini Care Companion.',
          );
        }
        throw new Error(data.error || 'Care companion unavailable.');
      }
      setAssistantReply(data.answer);
      if (!promptText) setPatientQuery('');
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : 'Unable to reach assistant.');
    } finally {
      setAssistantLoading(false);
    }
  };

  return (
    <main className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pt-5 space-y-6">
      <SyntheticNoticeBanner compact />

      {/* Top Profile Switcher */}
      <section className="glass-panel rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider text-[#FF6B5B]">
            Patient Self-Service Portal
          </p>
          <h1 className="font-editorial text-2xl sm:text-3xl font-medium text-[#F4EDE0] mt-0.5">
            Portable Migrant Health Pass
          </h1>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 w-full sm:w-auto min-w-0">
          <label
            htmlFor="patient-profile-select"
            className="text-xs font-medium text-[#F4EDE0]/70 shrink-0"
          >
            Active Profile:
          </label>
          <select
            id="patient-profile-select"
            value={selectedPatient.healthId}
            disabled={isPatientIsolated}
            onChange={(e) => setSelectedPatientId(e.target.value)}
            className="w-full sm:w-auto max-w-full min-w-0 px-3.5 py-2 text-sm rounded-xl glass-input truncate disabled:opacity-75"
          >
            {(isPatientIsolated
              ? patients.filter((p) => p.healthId === assignedPatientId)
              : patients
            ).map((p) => (
              <option key={p.healthId} value={p.healthId}>
                {p.fullName} ({p.originState} → {p.currentState})
              </option>
            ))}
          </select>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Digital QR Health Pass + Migration Update */}
        <section className="lg:col-span-5 glass-panel rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="relative overflow-hidden bg-[#0D172B] border border-[#F4EDE0]/20 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-mono text-[#FF6B5B]">
                  Migrant Health Pass · {activeQrPayload.schema} ·{' '}
                  {signedQrPayload ? `Ed25519 (${activeQrPayload.kid})` : 'Unsigned Preview'}
                </p>
                <h2 className="font-editorial text-2xl font-medium text-[#F4EDE0] mt-0.5">
                  {selectedPatient.fullName}
                </h2>
                <p className="text-xs font-mono text-[#F4EDE0]/72 mt-0.5">
                  {selectedPatient.healthId}
                </p>
              </div>
              <span className="font-mono text-sm font-semibold px-3 py-1 bg-[#FF6B5B] text-[#0D172B] rounded-lg">
                {activeQrPayload.bloodGroup}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-5 pt-2">
              <div className="shrink-0">
                <QrCodeGraphic value={qrPayloadString} size={152} />
              </div>
              <div className="space-y-2 text-xs text-[#F4EDE0]">
                <div>
                  <span className="text-[#F4EDE0]/56 block">Home Origin</span>
                  <strong>
                    {selectedPatient.originDistrict}, {selectedPatient.originState}
                  </strong>
                </div>
                <div>
                  <span className="text-[#F4EDE0]/56 block">Current Location</span>
                  <strong>
                    {selectedPatient.currentDistrict}, {selectedPatient.currentState}
                  </strong>
                </div>
                <div>
                  <span className="text-[#F4EDE0]/56 block">Emergency QR Sharing</span>
                  <strong>
                    {consent.emergencyQrAccess ? 'Enabled by Patient' : 'Redacted by Patient'}
                  </strong>
                </div>
                <div>
                  <span className="text-[#F4EDE0]/56 block">Pass ID &amp; Expiry</span>
                  <strong className="font-mono text-[#F4EDE0]/90">
                    {qrIssueLoading
                      ? 'Signing on server...'
                      : `${activeQrPayload.passId} · exp ${activeQrPayload.expiresAt.slice(0, 10)}`}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          {!user && (
            <div
              role="status"
              className="flex items-start gap-2 text-xs text-[#F4EDE0]/85 bg-[#FF6B5B]/12 border border-[#FF6B5B]/35 px-3.5 py-2.5 rounded-xl"
            >
              <AlertCircle className="w-3.5 h-3.5 text-[#FF6B5B] shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Unsigned preview mode. Sign in with Firebase in the footer to mint an
                Ed25519-signed QR pass via <span className="font-mono text-[#FF6B5B]">/api/qr/issue</span>.
              </span>
            </div>
          )}

          {passError && (
            <div
              role="alert"
              className="flex items-start gap-2 text-xs text-[#F4EDE0] bg-[#FF6B5B]/16 border border-[#FF6B5B]/45 px-3.5 py-2.5 rounded-xl"
            >
              <AlertCircle className="w-3.5 h-3.5 text-[#FF6B5B] shrink-0 mt-0.5" aria-hidden="true" />
              <span>{passError}</span>
            </div>
          )}

          {passFeedback && (
            <div
              role="status"
              className="flex items-center gap-1.5 text-xs text-[#F4EDE0] bg-[#F4EDE0]/10 border border-[#F4EDE0]/25 px-3.5 py-2.5 rounded-xl"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-[#FF6B5B] shrink-0" aria-hidden="true" />
              <span>{passFeedback}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void handleCopyQr()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl btn-glass cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{copied ? 'Copied QR Payload' : 'Copy QR Payload'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRevokeAndRotatePass()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#FF6B5B] bg-[#FF6B5B]/12 hover:bg-[#FF6B5B]/20 border border-[#FF6B5B]/35 rounded-xl cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Revoke &amp; Rotate Pass</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl btn-glass cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Print Card</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('consent')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#FF6B5B] hover:underline cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Manage Consent</span>
            </button>
          </div>

          {/* Update Current Migration Location */}
          <form
            onSubmit={(e) => void handleMigrationSubmit(e)}
            className="pt-4 border-t border-[#F4EDE0]/12 space-y-3"
          >
            <h3 className="text-sm font-semibold text-[#F4EDE0] flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-[#FF6B5B]" aria-hidden="true" />
              <span>Log State Relocation</span>
            </h3>

            {moveFeedback && (
              <div
                role="status"
                className="flex items-center gap-1.5 text-xs text-[#F4EDE0] bg-[#F4EDE0]/10 border border-[#F4EDE0]/25 px-3.5 py-2 rounded-xl"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-[#FF6B5B] shrink-0" aria-hidden="true" />
                <span>{moveFeedback}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="move-state" className="block text-xs font-medium text-[#F4EDE0]/72">
                  Destination State
                </label>
                <select
                  id="move-state"
                  value={moveState}
                  onChange={(e) => setMoveState(e.target.value)}
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
                <label htmlFor="move-district" className="block text-xs font-medium text-[#F4EDE0]/72">
                  City / District *
                </label>
                <input
                  id="move-district"
                  type="text"
                  required
                  value={moveDistrict}
                  onChange={(e) => setMoveDistrict(e.target.value)}
                  placeholder="e.g., Nashik"
                  className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
                />
              </div>
            </div>

            <div>
              <label htmlFor="move-sector" className="block text-xs font-medium text-[#F4EDE0]/72">
                Work Site / Sector
              </label>
              <input
                id="move-sector"
                type="text"
                value={moveSector}
                onChange={(e) => setMoveSector(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
              />
            </div>

            <button
              type="submit"
              className="w-full px-4 py-2.5 text-xs rounded-xl btn-coral cursor-pointer"
            >
              Update Portable Location
            </button>
          </form>
        </section>

        {/* Right: Care Companion, Migration Trajectory & Medical Encounters */}
        <div className="lg:col-span-7 space-y-6">
          <section className="glass-panel rounded-2xl p-6 space-y-4">
            <h2 className="font-editorial text-xl sm:text-2xl font-medium text-[#F4EDE0]">
              My Care Instructions &amp; Gemini Companion
            </h2>
            <p className="text-xs text-[#F4EDE0]/68">
              Ask plain-language questions about your prescriptions, next clinic checkup, or how to
              share this pass in <strong className="text-[#F4EDE0]">{selectedPatient.primaryLanguage}</strong> or English.
            </p>

            <div className="flex flex-wrap gap-2">
              {[
                `Explain my current medicines in ${selectedPatient.primaryLanguage} and English.`,
                'When is my next checkup due and why?',
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void askCareCompanion(q)}
                  disabled={assistantLoading}
                  className="px-3.5 py-2 text-xs rounded-xl btn-glass cursor-pointer text-left"
                >
                  {q}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void askCareCompanion();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
                placeholder="Ask a question about your health record..."
                aria-label="Ask patient care companion"
                className="flex-1 px-3.5 py-2.5 text-sm rounded-xl glass-input"
              />
              <button
                type="submit"
                disabled={assistantLoading || !patientQuery.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm rounded-xl btn-coral disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <Send className="w-4 h-4" aria-hidden="true" />
                <span>{assistantLoading ? 'Asking...' : 'Ask'}</span>
              </button>
            </form>

            {assistantError && (
              <div
                role="alert"
                className="bg-[#FF6B5B]/15 border border-[#FF6B5B]/40 text-[#F4EDE0] p-3 rounded-xl text-xs"
              >
                {assistantError}
              </div>
            )}

            {assistantReply && (
              <div className="bg-[#0D172B]/75 border border-[#F4EDE0]/20 rounded-xl p-4">
                <FormattedClinicalProse text={assistantReply} className="text-sm leading-relaxed text-[#F4EDE0]/88" />
              </div>
            )}
          </section>

          {/* Interstate Migration Trajectory */}
          <section className="glass-panel rounded-2xl p-6 space-y-4">
            <h2 className="font-editorial text-xl sm:text-2xl font-medium text-[#F4EDE0]">
              My Interstate Migration &amp; Healthcare Access Log
            </h2>

            <div className="divide-y divide-[#F4EDE0]/10 border border-[#F4EDE0]/14 rounded-xl bg-[#0D172B]/55">
              {selectedPatient.migrationHistory.map((hop, idx) => (
                <div
                  key={`${hop.state}-${hop.arrivalDate}-${idx}`}
                  className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <span className="font-semibold text-[#F4EDE0]">
                      {hop.district}, {hop.state}
                    </span>
                    <span className="text-[#F4EDE0]/62 ml-2">· {hop.sector}</span>
                  </div>
                  <span className="font-mono tabular-nums text-[#FF6B5B]">{hop.arrivalDate}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-panel rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-editorial text-xl sm:text-2xl font-medium text-[#F4EDE0]">
                My Portable Medical Encounters
              </h2>
              <button
                type="button"
                onClick={() => navigate('audit')}
                className="text-xs font-medium text-[#FF6B5B] hover:underline cursor-pointer"
              >
                Who Accessed My Data?
              </button>
            </div>

            <div className="divide-y divide-[#F4EDE0]/10 border border-[#F4EDE0]/14 rounded-xl bg-[#0D172B]/55">
              {selectedPatient.encounters.map((enc) => (
                <div key={enc.encounterId} className="p-4 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#F4EDE0]/68">
                    <span className="font-mono text-[#FF6B5B]">{enc.encounterDate}</span>
                    <span>
                      {enc.facilityName} · {enc.state}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-[#F4EDE0]">{enc.diagnosis}</p>
                  <p className="text-xs text-[#F4EDE0]/68">
                    Medicines: {enc.medications.join(', ') || 'None'}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
};

import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, GitMerge, QrCode, UserPlus } from 'lucide-react';
import { useHealthSystem } from '../context/HealthSystemContext.tsx';
import { INDIAN_STATES } from '../data/syntheticPatients.ts';
import { evaluateEntityResolution, type PatientResolutionMatch } from '../lib/entityResolution.ts';
import type { MigrantPatient } from '../types/health.ts';
import { SyntheticNoticeBanner } from './StatusPrimitives.tsx';

export const RegistrationPage: React.FC = () => {
  const { patients, registerPatient, linkExternalRecordToPatient, setSelectedPatientId, navigate } =
    useHealthSystem();

  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('32');
  const [gender, setGender] = useState<'Female' | 'Male' | 'Other'>('Male');
  const [originState, setOriginState] = useState('Bihar');
  const [originDistrict, setOriginDistrict] = useState('');
  const [currentState, setCurrentState] = useState('Maharashtra');
  const [currentDistrict, setCurrentDistrict] = useState('');
  const [primaryLanguage, setPrimaryLanguage] = useState('Hindi');
  const [occupationSector, setOccupationSector] = useState('Construction');
  const [phoneLast4, setPhoneLast4] = useState('');
  const [bloodGroup, setBloodGroup] = useState('O+');
  const [allergiesText, setAllergiesText] = useState('');
  const [conditionsText, setConditionsText] = useState('');

  const [validationError, setValidationError] = useState('');
  const [matches, setMatches] = useState<PatientResolutionMatch[] | null>(null);
  const [successHealthId, setSuccessHealthId] = useState('');

  const validateForm = (): number | null => {
    setValidationError('');
    if (fullName.trim().length < 2) {
      setValidationError('Full name must be at least 2 characters.');
      return null;
    }
    const parsedAge = Number(age);
    if (!Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > 120) {
      setValidationError('Age must be a valid whole number between 0 and 120.');
      return null;
    }
    if (!/^\d{4}$/.test(phoneLast4.trim())) {
      setValidationError('Please enter the 4-digit phone suffix for entity resolution.');
      return null;
    }
    return parsedAge;
  };

  const handleCheckDuplicates = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAge = validateForm();
    if (parsedAge === null) return;

    const found = evaluateEntityResolution(
      {
        fullName: fullName.trim(),
        age: parsedAge,
        gender,
        originState,
        currentState,
        phoneLast4: phoneLast4.trim(),
      },
      patients,
    );
    setMatches(found);
  };

  const handleCreateNewProfile = async () => {
    const parsedAge = validateForm();
    if (parsedAge === null) return;

    const stateCode = originState.slice(0, 2).toUpperCase();
    const destCode = currentState.slice(0, 2).toUpperCase();
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const healthId = `MHIS-${stateCode}-${destCode}-${suffix}`;
    const today = new Date().toISOString().slice(0, 10);

    const newPatient: MigrantPatient = {
      healthId,
      fullName: fullName.trim(),
      age: parsedAge,
      gender,
      originState,
      originDistrict: originDistrict.trim() || 'Origin Block',
      currentState,
      currentDistrict: currentDistrict.trim() || 'Destination PHC',
      primaryLanguage: primaryLanguage.trim() || 'Hindi',
      occupationSector: occupationSector.trim() || 'General Labor',
      phoneLast4: phoneLast4.trim(),
      bloodGroup,
      allergies: allergiesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .length
        ? allergiesText.split(',').map((s) => s.trim()).filter(Boolean)
        : ['None reported'],
      chronicConditions: conditionsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      activeMedications: [],
      medicationGapDays: 0,
      daysSinceLastVisit: 0,
      recommendedFollowUpDays: 30,
      recordLinkageStatus: 'LINKED',
      externalRefIds: [`REG-${suffix}`],
      migrationHistory: [
        {
          state: originState,
          district: originDistrict.trim() || 'Origin Block',
          arrivalDate: today,
          sector: occupationSector.trim() || 'Seasonal',
        },
        {
          state: currentState,
          district: currentDistrict.trim() || 'Destination PHC',
          arrivalDate: today,
          sector: occupationSector.trim() || 'General Labor',
        },
      ],
      encounters: [
        {
          encounterId: `ENC-${suffix}-01`,
          patientHealthId: healthId,
          facilityName: `${currentDistrict.trim() || currentState} Registration PHC`,
          district: currentDistrict.trim() || currentState,
          state: currentState,
          encounterDate: today,
          encounterType: 'Outpatient',
          diagnosis: conditionsText.trim() || 'Initial Migrant Health Baseline Registration',
          icdCode: 'Z00.0',
          medications: [],
          followUpRequired: false,
          followUpDueDate: null,
          clinicianName: 'PHC Intake Officer (Demo)',
          notes: 'Issued portable MHIS-QR-v2 Health Pass upon registration.',
          sourceSystem: 'MHIS Intake Portal',
        },
      ],
      isSimulated: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await registerPatient(newPatient);
    setSuccessHealthId(healthId);
    setMatches(null);
  };

  const handleLinkToExisting = (targetHealthId: string) => {
    const extRef = `EXT-${Math.floor(10000 + Math.random() * 89999)}`;
    linkExternalRecordToPatient(
      targetHealthId,
      extRef,
      `${currentDistrict.trim() || currentState} Intake PHC`,
      currentState,
    );
    setSelectedPatientId(targetHealthId);
    setSuccessHealthId(targetHealthId);
    setMatches(null);
  };

  return (
    <main className="max-w-[1060px] mx-auto px-4 sm:px-6 lg:px-10 pt-5 space-y-6">
      <SyntheticNoticeBanner />

      <section className="glass-panel rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="pb-4 border-b border-[#F4EDE0]/12">
          <p className="text-[11px] font-mono uppercase tracking-wider text-[#FF6B5B]">
            Cross-State Onboarding &amp; Entity Resolution
          </p>
          <h1 className="font-editorial text-2xl sm:text-3xl font-medium text-[#F4EDE0] mt-1">
            Register Migrant Health Profile
          </h1>
          <p className="text-sm text-[#F4EDE0]/70 mt-1">
            Before issuing a new portable Health ID, the system runs phonetic and demographic
            entity resolution to prevent fragmented duplicate records across states.
          </p>
        </div>

        {validationError && (
          <div
            role="alert"
            className="flex items-start gap-2 bg-[#FF6B5B]/15 border border-[#FF6B5B]/45 text-[#F4EDE0] px-4 py-3 rounded-xl text-sm"
          >
            <AlertCircle className="w-4 h-4 text-[#FF6B5B] shrink-0 mt-0.5" aria-hidden="true" />
            <span>{validationError}</span>
          </div>
        )}

        {successHealthId && (
          <div
            role="status"
            className="bg-[#0D172B]/75 border border-[#F4EDE0]/25 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#F4EDE0]">
                <CheckCircle2 className="w-4 h-4 text-[#FF6B5B]" aria-hidden="true" />
                <span>Unified Health ID Ready: {successHealthId}</span>
              </div>
              <p className="text-xs text-[#F4EDE0]/72">
                Portable QR Health Pass and consent defaults have been initialized.
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => navigate('patient')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded-xl btn-coral cursor-pointer whitespace-nowrap"
              >
                <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Open QR Health Pass</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('doctor')}
                className="px-3.5 py-2 text-xs font-medium rounded-xl btn-glass cursor-pointer whitespace-nowrap"
              >
                Doctor View
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleCheckDuplicates} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <label htmlFor="reg-name" className="block text-xs font-medium text-[#F4EDE0]/82">
                Full Name *
              </label>
              <input
                id="reg-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g., Rames Kumar Mahto"
                className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
              />
            </div>

            <div>
              <label htmlFor="reg-age" className="block text-xs font-medium text-[#F4EDE0]/82">
                Age (Years) *
              </label>
              <input
                id="reg-age"
                type="number"
                min={0}
                max={120}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm font-mono rounded-xl glass-input"
              />
            </div>

            <div>
              <label htmlFor="reg-gender" className="block text-xs font-medium text-[#F4EDE0]/82">
                Gender
              </label>
              <select
                id="reg-gender"
                value={gender}
                onChange={(e) => setGender(e.target.value as typeof gender)}
                className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="reg-origin-state" className="block text-xs font-medium text-[#F4EDE0]/82">
                Origin State *
              </label>
              <select
                id="reg-origin-state"
                value={originState}
                onChange={(e) => setOriginState(e.target.value)}
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
              <label htmlFor="reg-origin-dist" className="block text-xs font-medium text-[#F4EDE0]/82">
                Origin District
              </label>
              <input
                id="reg-origin-dist"
                type="text"
                value={originDistrict}
                onChange={(e) => setOriginDistrict(e.target.value)}
                placeholder="e.g., Darbhanga"
                className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
              />
            </div>

            <div>
              <label htmlFor="reg-phone4" className="block text-xs font-medium text-[#F4EDE0]/82">
                Phone Suffix (Last 4 Digits) *
              </label>
              <input
                id="reg-phone4"
                type="text"
                maxLength={4}
                value={phoneLast4}
                onChange={(e) => setPhoneLast4(e.target.value)}
                placeholder="e.g., 4821"
                className="mt-1 w-full px-3 py-2 text-sm font-mono rounded-xl glass-input"
              />
            </div>

            <div>
              <label htmlFor="reg-curr-state" className="block text-xs font-medium text-[#F4EDE0]/82">
                Current Destination State *
              </label>
              <select
                id="reg-curr-state"
                value={currentState}
                onChange={(e) => setCurrentState(e.target.value)}
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
              <label htmlFor="reg-curr-dist" className="block text-xs font-medium text-[#F4EDE0]/82">
                Current District
              </label>
              <input
                id="reg-curr-dist"
                type="text"
                value={currentDistrict}
                onChange={(e) => setCurrentDistrict(e.target.value)}
                placeholder="e.g., Thane"
                className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
              />
            </div>

            <div>
              <label htmlFor="reg-lang" className="block text-xs font-medium text-[#F4EDE0]/82">
                Preferred Language
              </label>
              <input
                id="reg-lang"
                type="text"
                value={primaryLanguage}
                onChange={(e) => setPrimaryLanguage(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
              />
            </div>

            <div>
              <label htmlFor="reg-sector" className="block text-xs font-medium text-[#F4EDE0]/82">
                Work Sector
              </label>
              <input
                id="reg-sector"
                type="text"
                value={occupationSector}
                onChange={(e) => setOccupationSector(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
              />
            </div>

            <div>
              <label htmlFor="reg-blood" className="block text-xs font-medium text-[#F4EDE0]/82">
                Blood Group
              </label>
              <select
                id="reg-blood"
                value={bloodGroup}
                onChange={(e) => setBloodGroup(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
              >
                {['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((bg) => (
                  <option key={bg} value={bg}>
                    {bg}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="reg-allergies" className="block text-xs font-medium text-[#F4EDE0]/82">
                Known Allergies
              </label>
              <input
                id="reg-allergies"
                type="text"
                value={allergiesText}
                onChange={(e) => setAllergiesText(e.target.value)}
                placeholder="Comma-separated or blank"
                className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
              />
            </div>
          </div>

          <div>
            <label htmlFor="reg-conds" className="block text-xs font-medium text-[#F4EDE0]/82">
              Active Chronic or Continuity Conditions (comma-separated)
            </label>
            <input
              id="reg-conds"
              type="text"
              value={conditionsText}
              onChange={(e) => setConditionsText(e.target.value)}
              placeholder="e.g., Pulmonary Tuberculosis (DOTS), Hypertension"
              className="mt-1 w-full px-3 py-2 text-sm rounded-xl glass-input"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm rounded-xl btn-coral cursor-pointer"
            >
              <GitMerge className="w-4 h-4" aria-hidden="true" />
              <span>Run Entity-Resolution Check</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setFullName('Rames Kumar Mahto');
                setAge('35');
                setGender('Male');
                setOriginState('Bihar');
                setOriginDistrict('Darbhanga');
                setCurrentState('Maharashtra');
                setCurrentDistrict('Thane');
                setPhoneLast4('4821');
              }}
              className="px-4 py-2.5 text-xs font-medium rounded-xl btn-glass cursor-pointer"
            >
              Fill Duplicate Test Case
            </button>
          </div>
        </form>

        {/* Entity Resolution Results Panel */}
        {matches !== null && (
          <div className="pt-6 border-t border-[#F4EDE0]/12 space-y-4">
            {matches.length > 0 ? (
              <div className="bg-[#FF6B5B]/12 border border-[#FF6B5B]/35 rounded-2xl p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-[#FF6B5B]">
                    Potential Cross-State Record Match Detected ({matches.length})
                  </h2>
                  <p className="text-xs text-[#F4EDE0]/72 mt-0.5">
                    Link to the existing unified Health ID to preserve cross-state continuity, or
                    confirm this is a distinct individual.
                  </p>
                </div>

                {matches.map((m) => (
                  <div
                    key={m.patient.healthId}
                    className="bg-[#0D172B]/75 border border-[#F4EDE0]/16 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-[#F4EDE0]">
                        {m.patient.fullName}{' '}
                        <span className="font-mono text-xs text-[#FF6B5B]">
                          ({m.patient.healthId})
                        </span>
                      </div>
                      <div className="text-xs text-[#F4EDE0]/72">
                        {m.patient.originState} → {m.patient.currentState} · Similarity:{' '}
                        <strong className="font-mono text-[#F4EDE0]">
                          {Math.round(m.similarityScore * 100)}%
                        </strong>{' '}
                        ({m.recommendation.replace('_', ' ')})
                      </div>
                      <div className="text-xs text-[#F4EDE0]/62">
                        Signals: {m.signals.map((s) => s.signal).join(' · ')}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleLinkToExisting(m.patient.healthId)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded-xl btn-coral cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <GitMerge className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Link to Existing ID</span>
                    </button>
                  </div>
                ))}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => void handleCreateNewProfile()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl btn-glass cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Register as Distinct New Patient</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-[#0D172B]/75 border border-[#F4EDE0]/20 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-[#F4EDE0]">
                    No Duplicate Records Found
                  </h2>
                  <p className="text-xs text-[#F4EDE0]/70 mt-0.5">
                    Safe to issue a new unified Migrant Health ID and QR Health Pass.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateNewProfile()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs rounded-xl btn-coral cursor-pointer whitespace-nowrap"
                >
                  <UserPlus className="w-4 h-4" aria-hidden="true" />
                  <span>Confirm &amp; Issue Health ID</span>
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
};

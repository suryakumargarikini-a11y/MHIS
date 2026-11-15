import React, { useMemo, useState } from 'react';
import type { PrivacyPreservingSurveillanceReport } from '../lib/surveillancePrivacy.ts';

interface GeoCoord {
  state: string;
  shortCode: string;
  lat: number;
  lon: number;
  labelDx?: number;
  labelDy?: number;
}

const STATE_COORDS: Record<string, GeoCoord> = {
  'Delhi NCR': { state: 'Delhi NCR', shortCode: 'DL', lat: 28.61, lon: 77.21, labelDx: -10, labelDy: -6 },
  Rajasthan: { state: 'Rajasthan', shortCode: 'RJ', lat: 26.2, lon: 73.8, labelDx: -12, labelDy: 4 },
  'Uttar Pradesh': { state: 'Uttar Pradesh', shortCode: 'UP', lat: 26.85, lon: 80.95, labelDx: -6, labelDy: -10 },
  Bihar: { state: 'Bihar', shortCode: 'BR', lat: 25.6, lon: 85.4, labelDx: 8, labelDy: -10 },
  Jharkhand: { state: 'Jharkhand', shortCode: 'JH', lat: 23.55, lon: 85.3, labelDx: -10, labelDy: 2 },
  'West Bengal': { state: 'West Bengal', shortCode: 'WB', lat: 23.2, lon: 87.85, labelDx: 10, labelDy: 6 },
  Odisha: { state: 'Odisha', shortCode: 'OD', lat: 20.4, lon: 84.8, labelDx: 10, labelDy: 8 },
  Gujarat: { state: 'Gujarat', shortCode: 'GJ', lat: 22.1, lon: 71.8, labelDx: -12, labelDy: 4 },
  Maharashtra: { state: 'Maharashtra', shortCode: 'MH', lat: 19.2, lon: 74.8, labelDx: -14, labelDy: 6 },
  Karnataka: { state: 'Karnataka', shortCode: 'KA', lat: 14.2, lon: 76.4, labelDx: -12, labelDy: 6 },
  'Tamil Nadu': { state: 'Tamil Nadu', shortCode: 'TN', lat: 11.1, lon: 78.3, labelDx: 12, labelDy: 6 },
};

// Simplified clean cartographic boundary polygon of India in lat/lon space
const INDIA_OUTLINE_GEO: [number, number][] = [
  [35.5, 74.5], [35.2, 77.8], [32.8, 79.0], [30.8, 79.8], [29.4, 80.9],
  [27.9, 83.8], [26.8, 88.1], [27.9, 89.2], [27.5, 92.5], [28.4, 95.8],
  [27.0, 97.1], [24.5, 94.8], [22.2, 92.8], [22.4, 89.1], [21.5, 87.2],
  [19.3, 85.0], [16.5, 82.2], [13.1, 80.3], [10.2, 79.8], [8.1, 77.5],
  [9.9, 76.2], [12.9, 74.8], [16.0, 73.5], [19.1, 72.8], [21.1, 72.6],
  [20.7, 70.4], [22.4, 68.9], [23.8, 68.4], [24.6, 71.0], [27.0, 69.8],
  [29.8, 73.2], [32.2, 74.9], [34.2, 74.0], [35.5, 74.5],
];

function project(lat: number, lon: number): { x: number; y: number } {
  const minLon = 67.5;
  const maxLon = 98.0;
  const minLat = 7.2;
  const maxLat = 36.5;
  const width = 540;
  const height = 580;
  const padX = 24;
  const padY = 20;

  const x = padX + ((lon - minLon) / (maxLon - minLon)) * (width - padX * 2);
  const y = padY + ((maxLat - lat) / (maxLat - minLat)) * (height - padY * 2);
  return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
}

interface IndiaMigrationMapProps {
  surveillanceReport: PrivacyPreservingSurveillanceReport;
  selectedCorridor: string;
  onSelectCorridor: (corridor: string) => void;
}

export const IndiaMigrationMap: React.FC<IndiaMigrationMapProps> = ({
  surveillanceReport,
  selectedCorridor,
  onSelectCorridor,
}) => {
  const [hoveredCorridor, setHoveredCorridor] = useState<string | null>(null);

  const outlinePath = useMemo(() => {
    return (
      INDIA_OUTLINE_GEO.map(([lat, lon], idx) => {
        const pt = project(lat, lon);
        return `${idx === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`;
      }).join(' ') + ' Z'
    );
  }, []);

  // Only corridors meeting k >= minimumCohortSize AND with explicit interStateSharing consent
  // may render identifiable origin -> destination arcs on the surveillance map.
  const publishableCorridors = useMemo(() => {
    return surveillanceReport.corridors.filter(
      (c) => !c.suppressed && Boolean(c.originState) && (c.totalCount ?? 0) >= surveillanceReport.minimumCohortSize,
    );
  }, [surveillanceReport]);

  const activeStates = useMemo(() => {
    const counts = new Map<string, { origin: number; destination: number }>();
    for (const c of publishableCorridors) {
      if (c.originState) {
        const o = counts.get(c.originState) ?? { origin: 0, destination: 0 };
        o.origin += c.totalCount ?? 0;
        counts.set(c.originState, o);
      }
      const d = counts.get(c.destinationState) ?? { origin: 0, destination: 0 };
      d.destination += c.totalCount ?? 0;
      counts.set(c.destinationState, d);
    }
    for (const s of surveillanceReport.destinationStates) {
      if (!s.suppressed && (s.destinationCount ?? 0) >= surveillanceReport.minimumCohortSize) {
        const d = counts.get(s.state) ?? { origin: 0, destination: 0 };
        d.destination = Math.max(d.destination, s.destinationCount ?? 0);
        counts.set(s.state, d);
      }
    }
    return counts;
  }, [publishableCorridors, surveillanceReport]);

  const activeCorridorDetail = useMemo(() => {
    const target = hoveredCorridor || (selectedCorridor !== 'ALL' ? selectedCorridor : null);
    if (!target) return null;
    return surveillanceReport.corridors.find((c) => c.corridorKey === target) ?? null;
  }, [surveillanceReport.corridors, hoveredCorridor, selectedCorridor]);

  return (
    <div className="flex flex-col h-full">
      <div className="relative bg-[#0D172B]/85 border border-[#F4EDE0]/14 rounded-xl overflow-hidden">
        <svg
          viewBox="0 0 540 580"
          className="w-full h-auto max-h-[470px] block"
          role="img"
          aria-label="Privacy-preserving geographic surveillance map showing anonymized cohort trajectories meeting minimum k-anonymity"
        >
          <defs>
            <marker
              id="arrow-cream"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#F4EDE0" />
            </marker>
            <marker
              id="arrow-coral"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#FF6B5B" />
            </marker>
          </defs>

          {[100, 200, 300, 400].map((x) => (
            <line
              key={`gx-${x}`}
              x1={x}
              y1={0}
              x2={x}
              y2={580}
              stroke="rgba(244, 237, 224, 0.08)"
              strokeWidth="0.75"
              strokeDasharray="3 4"
            />
          ))}
          {[120, 240, 360, 480].map((y) => (
            <line
              key={`gy-${y}`}
              x1={0}
              y1={y}
              x2={540}
              y2={y}
              stroke="rgba(244, 237, 224, 0.08)"
              strokeWidth="0.75"
              strokeDasharray="3 4"
            />
          ))}

          <path
            d={outlinePath}
            fill="#192949"
            stroke="rgba(244, 237, 224, 0.28)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />

          {/* Publishable (k >= minCohortSize, consent-verified) Corridors */}
          {publishableCorridors.map((c) => {
            const from = c.originState ? STATE_COORDS[c.originState] : undefined;
            const to = STATE_COORDS[c.destinationState];
            if (!from || !to) return null;
            const p1 = project(from.lat, from.lon);
            const p2 = project(to.lat, to.lon);
            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2;
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const cx = mx - dy * 0.16;
            const cy = my + dx * 0.12;
            const isSelected = selectedCorridor === c.corridorKey;
            const isHovered = hoveredCorridor === c.corridorKey;
            const hasHighRisk = (c.highRiskCount ?? 0) > 0;
            const dimmed =
              selectedCorridor !== 'ALL' && !isSelected && !isHovered;

            return (
              <g
                key={c.corridorKey}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredCorridor(c.corridorKey)}
                onMouseLeave={() => setHoveredCorridor(null)}
                onClick={() =>
                  onSelectCorridor(isSelected ? 'ALL' : c.corridorKey)
                }
              >
                <path
                  d={`M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="14"
                />
                <path
                  d={`M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`}
                  fill="none"
                  stroke={hasHighRisk ? '#FF6B5B' : '#F4EDE0'}
                  strokeWidth={isSelected || isHovered ? 2.75 : 1.75}
                  strokeOpacity={dimmed ? 0.24 : 0.92}
                  strokeDasharray={(c.unlinkedCount ?? 0) > 0 ? '5 3' : undefined}
                  markerEnd={hasHighRisk ? 'url(#arrow-coral)' : 'url(#arrow-cream)'}
                />
              </g>
            );
          })}

          {Object.values(STATE_COORDS).map((coord) => {
            const stats = activeStates.get(coord.state);
            const pt = project(coord.lat, coord.lon);
            const isOrigin = (stats?.origin ?? 0) > 0;
            const isDest = (stats?.destination ?? 0) > 0;
            const active = isOrigin || isDest;

            return (
              <g key={coord.state}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={active ? 5.5 : 3.5}
                  fill={isDest ? '#FF6B5B' : isOrigin ? '#0D172B' : '#26395E'}
                  stroke={active ? '#F4EDE0' : 'rgba(244, 237, 224, 0.35)'}
                  strokeWidth={isOrigin && !isDest ? 2 : 1.5}
                />
                <text
                  x={pt.x + (coord.labelDx ?? 8)}
                  y={pt.y + (coord.labelDy ?? 4)}
                  fontSize="10.5"
                  fontFamily="IBM Plex Sans, sans-serif"
                  fontWeight={active ? '600' : '400'}
                  fill={active ? '#F4EDE0' : 'rgba(244, 237, 224, 0.56)'}
                  textAnchor={(coord.labelDx ?? 0) < 0 ? 'end' : 'start'}
                >
                  {coord.state}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="bg-[#0D172B]/90 border-t border-[#F4EDE0]/12 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#F4EDE0]/72">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-[#F4EDE0] bg-[#0D172B] inline-block" />
              Consented Origin Cohort (k ≥ {surveillanceReport.minimumCohortSize})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF6B5B] border border-[#F4EDE0]/80 inline-block" />
              Destination Cohort (k ≥ {surveillanceReport.minimumCohortSize})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-[#F4EDE0] inline-block" />
              Publishable Trajectory
            </span>
          </div>
          {selectedCorridor !== 'ALL' && (
            <button
              type="button"
              onClick={() => onSelectCorridor('ALL')}
              className="text-[#FF6B5B] font-medium hover:underline cursor-pointer"
            >
              Reset Map Selection
            </button>
          )}
        </div>
      </div>

      {/* Privacy-Preserving Surveillance Summary Inspector (Zero Individual PII) */}
      <div className="mt-3 glass-card rounded-xl p-3.5 text-xs space-y-1">
        {activeCorridorDetail ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-[#F4EDE0]">
                Aggregate Corridor: {activeCorridorDetail.corridorKey}
              </span>
              <span className="text-[#F4EDE0]/72 ml-2">
                {activeCorridorDetail.displayCount}
                {activeCorridorDetail.highRiskCount !== null
                  ? ` · ${activeCorridorDetail.highRiskCount} high-risk`
                  : ''}
              </span>
            </div>
            <span className="font-mono text-[11px] text-[#FF6B5B]">
              De-identified Cohort (k ≥ {surveillanceReport.minimumCohortSize})
            </span>
          </div>
        ) : (
          <p className="text-[#F4EDE0]/72 leading-relaxed">
            Surveillance Policy ({surveillanceReport.policyVersion}): Only anonymized cohorts with explicit
            opt-in ({surveillanceReport.optedInCount} opted-in, {surveillanceReport.excludedOptOutCount}{' '}
            opted-out excluded) and size k ≥ {surveillanceReport.minimumCohortSize} are plotted.{' '}
            {surveillanceReport.suppressedCorridorCount} small corridor(s) suppressed to prevent
            re-identification.
          </p>
        )}
      </div>
    </div>
  );
};

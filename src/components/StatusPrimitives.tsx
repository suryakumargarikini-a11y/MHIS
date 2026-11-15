import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { AlertTriangle, CheckCircle2, Clock, Info, Link2, ShieldAlert } from 'lucide-react';
import type { LinkageStatus, RiskTier } from '../types/health.ts';
import { SYNTHETIC_DATA_NOTICE } from '../data/syntheticPatients.ts';

export const RiskTierLabel: React.FC<{ tier: RiskTier; score?: number }> = ({ tier, score }) => {
  const config =
    tier === 'HIGH'
      ? {
          icon: AlertTriangle,
          text: 'High Continuity Risk',
          classes: 'text-[#FF6B5B] bg-[#FF6B5B]/12 border-[#FF6B5B]/35',
        }
      : tier === 'MODERATE'
        ? {
            icon: Clock,
            text: 'Moderate Risk',
            classes: 'text-[#F4EDE0] bg-[#F4EDE0]/10 border-[#F4EDE0]/25',
          }
        : {
            icon: CheckCircle2,
            text: 'Low Risk',
            classes: 'text-[#F4EDE0]/85 bg-[#0D172B]/70 border-[#F4EDE0]/16',
          };

  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-lg whitespace-nowrap shrink-0 ${config.classes}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{config.text}</span>
      {typeof score === 'number' && (
        <span className="font-mono tabular-nums opacity-85">({score}/100)</span>
      )}
    </span>
  );
};

export const LinkageStatusLabel: React.FC<{ status: LinkageStatus }> = ({ status }) => {
  if (status === 'LINKED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#F4EDE0] whitespace-nowrap">
        <Link2 className="w-3.5 h-3.5 shrink-0 text-[#F4EDE0]/75" aria-hidden="true" />
        <span>Linked</span>
      </span>
    );
  }
  if (status === 'PENDING_REVIEW') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#F4EDE0]/80 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0 text-[#FF6B5B]" aria-hidden="true" />
        <span>Pending Review</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#FF6B5B] whitespace-nowrap">
      <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>Unlinked</span>
    </span>
  );
};

export const SyntheticNoticeBanner: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <div
    className={`flex items-start gap-2.5 glass-card rounded-xl text-[#F4EDE0]/85 ${
      compact ? 'px-3.5 py-2 text-xs' : 'px-4 py-2.5 text-xs sm:text-sm'
    }`}
    role="note"
  >
    <Info className="w-4 h-4 text-[#FF6B5B] shrink-0 mt-0.5" aria-hidden="true" />
    <span>{SYNTHETIC_DATA_NOTICE}</span>
  </div>
);

export const QrCodeGraphic: React.FC<{ value: string; size?: number; label?: string }> = ({
  value,
  size = 176,
  label = 'Portable Migrant Health Pass QR Code',
}) => {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#14213D',
        light: '#F4EDE0',
      },
    })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
          setError('');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Unable to encode QR payload.');
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <div
        className="flex items-center justify-center bg-[#0D172B] border border-[#FF6B5B]/40 rounded-xl text-xs text-[#FF6B5B] p-4 text-center"
        style={{ width: size, height: size }}
      >
        {error}
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        className="bg-[#F4EDE0]/15 border border-[#F4EDE0]/20 rounded-xl"
        style={{ width: size, height: size }}
        aria-label="Generating QR code"
      />
    );
  }

  return (
    <img
      src={dataUrl}
      alt={label}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className="block rounded-xl border border-[#F4EDE0]/35 bg-[#F4EDE0] p-1.5 shadow-lg"
    />
  );
};

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <div
    className="divide-y divide-[#F4EDE0]/10 border border-[#F4EDE0]/14 rounded-xl bg-[#0D172B]/60"
    aria-busy="true"
    aria-label="Loading records"
  >
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="grid grid-cols-12 gap-4 px-4 py-3.5 items-center">
        <div className="col-span-3 h-4 bg-[#F4EDE0]/10 rounded" />
        <div className="col-span-3 h-4 bg-[#F4EDE0]/10 rounded" />
        <div className="col-span-2 h-4 bg-[#F4EDE0]/10 rounded" />
        <div className="col-span-2 h-4 bg-[#F4EDE0]/10 rounded" />
        <div className="col-span-2 h-4 bg-[#F4EDE0]/10 rounded" />
      </div>
    ))}
  </div>
);

function renderInlineBold(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-[#F4EDE0]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part.replace(/\*/g, '')}</React.Fragment>;
  });
}

export const FormattedClinicalProse: React.FC<{ text: string; className?: string }> = ({
  text,
  className = 'text-xs sm:text-sm leading-relaxed text-[#F4EDE0]/88',
}) => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className={`space-y-1.5 ${className}`}>
      {lines.map((line, i) => {
        const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
        if (bulletMatch) {
          return (
            <div key={i} className="flex items-start gap-2 pl-1">
              <span className="text-[#FF6B5B] font-semibold leading-5" aria-hidden="true">
                •
              </span>
              <span className="flex-1">{renderInlineBold(bulletMatch[1])}</span>
            </div>
          );
        }
        return <p key={i}>{renderInlineBold(line)}</p>;
      })}
    </div>
  );
};

import React from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  iconOnly?: boolean;
  className?: string;
}

/**
 * Brand Logo component for KILO·G.
 * Symbolizes:
 * - 1 kg filament spool geometry
 * - The letter "G" (G-code, grams, gear of precision calculation)
 * - Layered additive extrusion line with calibration point
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showTagline = false,
  iconOnly = false,
  className = '',
}) => {
  const iconDimensions = {
    sm: 'w-7 h-7',
    md: 'w-8 h-8',
    lg: 'w-10 h-10',
  };

  const textSizes = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-xl',
  };

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* KILO·G Spool & Precision Balance Mark */}
      <div
        className={`${iconDimensions[size]} relative rounded-lg bg-neutral-900 dark:bg-neutral-800 text-emerald-400 p-1.5 flex items-center justify-center shadow-xs border border-neutral-800 dark:border-neutral-700 overflow-hidden shrink-0 group`}
      >
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full transform transition-transform group-hover:scale-105"
        >
          {/* Spool Outer Flange Circle (The "Kilo" Coil) */}
          <circle
            cx="16"
            cy="16"
            r="12.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeDasharray="3 2"
            strokeOpacity="0.45"
          />

          {/* Letter 'G' contour formed by winding filament thread */}
          <path
            d="M23 11.5C21.2 8.5 17.8 7 14 7.5C9.5 8.1 6 12 6 16.5C6 21.2 9.8 25 14.5 25C19.2 25 23 21.5 23 17.5H15.5"
            stroke="#10b981"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Spool Inner Hub / Precision Calibrated Core */}
          <circle cx="15.5" cy="16.5" r="3.2" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.7" />

          {/* Extrusion Calibration Dot / Filament Tip */}
          <circle cx="15.5" cy="16.5" r="1.4" fill="#34d399" />

          {/* Vertical Gram/Weight Tick Mark */}
          <line x1="23" y1="14" x2="23" y2="18" stroke="#34d399" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      {!iconOnly && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 leading-none">
            <span
              className={`font-extrabold tracking-tight text-neutral-900 dark:text-white ${textSizes[size]}`}
            >
              KILO<span className="text-emerald-600 dark:text-emerald-400">·G</span>
            </span>
            <span className="text-[10px] font-mono uppercase px-1 py-0.2 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500 font-semibold border border-neutral-200 dark:border-neutral-700">
              FDM
            </span>
          </div>

          {showTagline && (
            <span className="text-[10px] text-neutral-500 dark:text-neutral-400 tracking-normal font-medium mt-0.5">
              Кожен грам на своєму місці
            </span>
          )}
        </div>
      )}
    </div>
  );
};

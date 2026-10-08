import React from 'react';
import type { ColorType } from '../../domain/filamentsDirectory.ts';

export interface FilamentColorVisualProps {
  colorHex?: string;
  colorHexList?: string[];
  colorType?: ColorType;
  colorName: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showTooltip?: boolean;
}

const SIZE_CLASSES = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-7 h-7',
  xl: 'w-9 h-9',
};

/**
 * Helper to determine CSS style for a filament color swatch,
 * supporting solid, dual-color co-extruded, tri-color, rainbow/gradient, glow, marble, etc.
 */
export function getFilamentColorStyle(options: {
  colorHex?: string;
  colorHexList?: string[];
  colorType?: ColorType;
  colorName?: string;
}): React.CSSProperties {
  const { colorHex = '#111827', colorHexList, colorType, colorName = '' } = options;
  const nameLower = colorName.toLowerCase();

  // If explicit type is rainbow or name indicates rainbow / multitone
  if (
    colorType === 'rainbow' ||
    nameLower.includes('rainbow') ||
    nameLower.includes('веселка') ||
    nameLower.includes('мультикол')
  ) {
    if (colorHexList && colorHexList.length >= 3) {
      return {
        backgroundImage: `linear-gradient(135deg, ${colorHexList.join(', ')})`,
      };
    }
    return {
      backgroundImage:
        'linear-gradient(135deg, #ef4444, #f97316, #eab308, #10b981, #06b6d4, #3b82f6, #a855f7)',
    };
  }

  // Dual color (Co-extrusion / Silk Dual / 2-Color)
  if (
    colorType === 'dual' ||
    (colorHexList && colorHexList.length === 2) ||
    nameLower.includes('dual') ||
    nameLower.includes('двокол')
  ) {
    const c1 = colorHexList?.[0] || colorHex;
    const c2 = colorHexList?.[1] || '#ffffff';
    return {
      backgroundImage: `linear-gradient(135deg, ${c1} 0%, ${c1} 50%, ${c2} 50%, ${c2} 100%)`,
    };
  }

  // Tri color (Tri-extrusion)
  if (
    colorType === 'tri' ||
    (colorHexList && colorHexList.length === 3) ||
    nameLower.includes('tri') ||
    nameLower.includes('трикол')
  ) {
    const c1 = colorHexList?.[0] || colorHex;
    const c2 = colorHexList?.[1] || '#ffffff';
    const c3 = colorHexList?.[2] || '#3b82f6';
    return {
      backgroundImage: `conic-gradient(from 0deg, ${c1} 0deg 120deg, ${c2} 120deg 240deg, ${c3} 240deg 360deg)`,
    };
  }

  // Gradient (e.g. Ombre, sunset, transition)
  if (colorType === 'gradient' || (colorHexList && colorHexList.length > 1)) {
    const list = colorHexList && colorHexList.length > 1 ? colorHexList : [colorHex, '#3b82f6'];
    return {
      backgroundImage: `linear-gradient(135deg, ${list.join(', ')})`,
    };
  }

  // Glow in the dark
  if (colorType === 'glow' || nameLower.includes('glow') || nameLower.includes('люмінесцент')) {
    return {
      backgroundColor: colorHex || '#bbf7d0',
      boxShadow: '0 0 8px 1px #86efac',
    };
  }

  // Marble (flecks)
  if (colorType === 'marble' || nameLower.includes('marble') || nameLower.includes('мармур')) {
    return {
      backgroundColor: colorHex || '#f8fafc',
      backgroundImage: `radial-gradient(#1e293b 15%, transparent 16%), radial-gradient(#334155 12%, transparent 13%)`,
      backgroundSize: '6px 6px, 8px 8px',
      backgroundPosition: '0 0, 3px 3px',
    };
  }

  // Glitter / Sparkle
  if (colorType === 'glitter' || nameLower.includes('glitter') || nameLower.includes('іскри')) {
    return {
      backgroundColor: colorHex,
      backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.85) 10%, transparent 12%)`,
      backgroundSize: '5px 5px',
    };
  }

  // Transparent / Clear
  if (colorType === 'transparent' || nameLower.includes('transparent') || nameLower.includes('прозорий')) {
    return {
      backgroundColor: `${colorHex}80`,
      backgroundImage: `repeating-linear-gradient(45deg, rgba(255,255,255,0.4), rgba(255,255,255,0.4) 2px, transparent 2px, transparent 6px)`,
    };
  }

  // Default solid color
  return {
    backgroundColor: colorHex,
  };
}

export const FilamentColorVisual: React.FC<FilamentColorVisualProps> = ({
  colorHex = '#111827',
  colorHexList,
  colorType = 'solid',
  colorName,
  size = 'md',
  className = '',
  showTooltip = true,
}) => {
  const style = getFilamentColorStyle({
    colorHex,
    colorHexList,
    colorType,
    colorName,
  });

  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const isMulti =
    colorType === 'rainbow' ||
    colorType === 'dual' ||
    colorType === 'tri' ||
    colorType === 'gradient' ||
    (colorHexList && colorHexList.length > 1);

  return (
    <span
      className={`relative inline-block rounded-full border-2 border-white dark:border-neutral-800 shadow-xs ring-1 ring-neutral-300 dark:ring-neutral-700 shrink-0 overflow-hidden ${sizeClass} ${className}`}
      style={style}
      title={showTooltip ? `Колір: ${colorName}${isMulti ? ' (Мультиколір)' : ''}` : undefined}
    >
      {/* Subtle shine highlight for silk/gloss look */}
      <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-black/10 via-transparent to-white/30 pointer-events-none" />
    </span>
  );
};

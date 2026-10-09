import React, { useState } from 'react';

interface CompanyLogoProps {
  name: string;
  imageDataUrl?: string | null;
  className?: string;
}

export const CompanyLogo: React.FC<CompanyLogoProps> = ({ name, imageDataUrl, className = 'h-10 w-10' }) => {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = imageDataUrl?.startsWith('data:image/png;base64,') && failedImage !== imageDataUrl ? imageDataUrl : null;
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || '').join('').toLocaleUpperCase('uk') || 'К';
  return <span role="img" aria-label={`Логотип компанії ${name}`} className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 text-xs font-semibold ${className}`}>
    {image ? <img src={image} alt="" width={128} height={128} className="h-full w-full object-contain" onError={() => setFailedImage(image)} /> : <span aria-hidden="true">{initials}</span>}
  </span>;
};

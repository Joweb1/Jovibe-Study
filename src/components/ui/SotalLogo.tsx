import React from 'react';

export const SOTAL_LOGO_SRC =
  '/assets/aistudio/file_00000000b1f48210bb9a78562c8f17ad_529c6c55.png';

interface SotalLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<SotalLogoProps['size']>, string> = {
  xs: 'h-5 w-5',
  sm: 'h-6 w-6',
  md: 'h-7 w-7',
  lg: 'h-11 w-11',
};

export const SotalLogo: React.FC<SotalLogoProps> = ({ size = 'md', className = '' }) => {
  return (
    <img
      src={SOTAL_LOGO_SRC}
      alt="Jovibe Study logo"
      draggable={false}
      className={`${SIZE_CLASSES[size]} shrink-0 object-contain select-none drop-shadow-[0_1px_4px_rgba(14,165,233,0.22)] ${className}`}
    />
  );
};

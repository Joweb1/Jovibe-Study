import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-zinc-950 text-white border border-zinc-950 hover:bg-zinc-800 active:bg-zinc-900 disabled:bg-zinc-300 disabled:border-zinc-300 disabled:text-zinc-500',
  secondary:
    'bg-white text-zinc-900 border border-zinc-300 hover:bg-zinc-50 hover:border-zinc-400 active:bg-zinc-100 disabled:text-zinc-400 disabled:border-zinc-200',
  ghost:
    'bg-transparent text-zinc-700 border border-transparent hover:bg-zinc-100 hover:text-zinc-950 active:bg-zinc-200 disabled:text-zinc-400',
  danger:
    'bg-white text-red-700 border border-red-200 hover:bg-red-50 hover:border-red-300 active:bg-red-100 disabled:text-red-300 disabled:border-red-100',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3.5 py-1.5 text-xs',
  md: 'min-h-10 px-4 py-2 text-sm',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...props
}) => {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed transition-colors ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
};

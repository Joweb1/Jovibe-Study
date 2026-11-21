import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

interface HomepageBackgroundProps {
  /** 0..1 hero scroll convergence progress to gently intensify ambient orb light */
  energyProgress?: number;
}

/**
 * Fluid, monochrome-first animated ambient backdrop for the SOTAL public homepage.
 * Adapts naturally across dark and light modes with soft flowing curves, orbital rings,
 * and an atmospheric radial light field influenced by the central liquid-glass orb.
 */
export const HomepageBackground: React.FC<HomepageBackgroundProps> = ({
  energyProgress = 0,
}) => {
  const reducedMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, energyProgress));

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
    >
      {/* Unified atmospheric light field beneath the hero centerpiece */}
      <div
        className="absolute left-1/2 top-[18%] h-[540px] w-[760px] -translate-x-1/2 -translate-y-1/4 rounded-full blur-[110px] transition-opacity duration-500 dark:hidden"
        style={{
          opacity: 0.42 + clamped * 0.22,
          background:
            'radial-gradient(ellipse at 50% 45%, rgba(56,189,248,0.18) 0%, rgba(139,92,246,0.12) 38%, rgba(244,244,245,0.04) 72%, transparent 100%)',
        }}
      />
      <div
        className="hidden dark:block absolute left-1/2 top-[18%] h-[580px] w-[820px] -translate-x-1/2 -translate-y-1/4 rounded-full blur-[125px] transition-opacity duration-500"
        style={{
          opacity: 0.46 + clamped * 0.28,
          background:
            'radial-gradient(ellipse at 50% 45%, rgba(14,165,233,0.22) 0%, rgba(124,58,237,0.16) 40%, rgba(9,9,11,0) 76%)',
        }}
      />

      {/* Subtle secondary off-axis ambient glow for depth */}
      <motion.div
        animate={
          reducedMotion
            ? undefined
            : { x: [0, 26, -14, 0], y: [0, -18, 14, 0] }
        }
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -right-24 top-[42%] h-[360px] w-[360px] rounded-full blur-[110px] opacity-[0.14] dark:opacity-[0.16]"
        style={{
          background:
            'radial-gradient(circle, rgba(99,102,241,0.38) 0%, rgba(56,189,248,0.12) 55%, transparent 75%)',
        }}
      />
      <motion.div
        animate={
          reducedMotion
            ? undefined
            : { x: [0, -22, 16, 0], y: [0, 20, -12, 0] }
        }
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -left-24 top-[62%] h-[340px] w-[340px] rounded-full blur-[110px] opacity-[0.1] dark:opacity-[0.13]"
        style={{
          background:
            'radial-gradient(circle, rgba(249,115,22,0.24) 0%, rgba(16,185,129,0.12) 55%, transparent 75%)',
        }}
      />

      {/* Abstract fluid vector curves & faint architectural orbital paths */}
      <svg
        viewBox="0 0 1440 960"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full text-zinc-900 dark:text-zinc-100"
      >
        <defs>
          <linearGradient id="sotal-bg-curve-a" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="28%" stopColor="currentColor" stopOpacity="0.08" />
            <stop offset="55%" stopColor="#38bdf8" stopOpacity="0.14" />
            <stop offset="78%" stopColor="currentColor" stopOpacity="0.07" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sotal-bg-curve-b" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="35%" stopColor="#8b5cf6" stopOpacity="0.11" />
            <stop offset="68%" stopColor="currentColor" stopOpacity="0.07" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Faint concentric orbital contours radiating from hero center */}
        <g opacity="0.065" className="dark:opacity-[0.09]">
          <ellipse
            cx="720"
            cy="275"
            rx="340"
            ry="195"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
          <ellipse
            cx="720"
            cy="275"
            rx="510"
            ry="290"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="4 8"
          />
          <ellipse
            cx="720"
            cy="275"
            rx="700"
            ry="400"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.8"
          />
        </g>

        {/* Gently breathing fluid wave ribbons */}
        <motion.g
          animate={reducedMotion ? undefined : { y: [0, -14, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        >
          <path
            d="M -120 260 C 210 155, 440 365, 730 275 C 1020 185, 1210 340, 1560 220"
            fill="none"
            stroke="url(#sotal-bg-curve-a)"
            strokeWidth="1.25"
          />
          <path
            d="M -100 325 C 240 220, 490 420, 760 325 C 1030 230, 1240 390, 1560 285"
            fill="none"
            stroke="url(#sotal-bg-curve-b)"
            strokeWidth="1"
          />
        </motion.g>

        <motion.g
          animate={reducedMotion ? undefined : { y: [0, 16, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        >
          <path
            d="M -120 650 C 260 560, 520 760, 820 640 C 1100 525, 1280 710, 1560 610"
            fill="none"
            stroke="url(#sotal-bg-curve-b)"
            strokeWidth="1.1"
          />
          <path
            d="M -80 820 C 310 730, 610 890, 920 790 C 1180 705, 1340 830, 1560 760"
            fill="none"
            stroke="url(#sotal-bg-curve-a)"
            strokeWidth="1"
          />
        </motion.g>
      </svg>

      {/* Hairline dot-grid whisper texture (subtle academic graph paper feel) */}
      <div
        className="absolute inset-0 opacity-[0.22] dark:opacity-[0.14]"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(113,113,122,0.22) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
          maskImage:
            'radial-gradient(ellipse 75% 65% at 50% 24%, black 25%, transparent 80%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 75% 65% at 50% 24%, black 25%, transparent 80%)',
        }}
      />
    </div>
  );
};

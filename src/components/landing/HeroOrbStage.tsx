import React, { useRef, useState } from 'react';
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { LiquidGlassOrb } from '../live/LiquidGlassOrb';
import type { LiveVoiceState } from '../live/types';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/StateViews';

interface HeroOrbStageProps {
  isDark: boolean;
  signingIn: boolean;
  authError: string | null;
  onSignIn: () => void;
  onClearAuthError: () => void;
  onExploreClick: () => void;
  onEnergyProgressChange?: (progress: number) => void;
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Minimal, immersive Hero section centered around SOTAL's real 3D WebGL LiquidGlassOrb.
 */
export const HeroOrbStage: React.FC<HeroOrbStageProps> = ({
  isDark,
  signingIn,
  authError,
  onSignIn,
  onClearAuthError,
  onExploreClick,
  onEnergyProgressChange,
}) => {
  const reducedMotion = useReducedMotion();
  const heroSectionRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: heroSectionRef,
    offset: ['start start', 'end start'],
  });

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 26,
    mass: 0.35,
  });

  const orbScale = useTransform(smoothProgress, [0, 0.5, 1], [1, 1.06, 1.02]);
  const scrollHintOpacity = useTransform(smoothProgress, [0, 0.18], [1, 0]);

  // Drive LiquidGlassOrb reactive intensity smoothly on scroll
  const [orbVoiceState, setOrbVoiceState] = useState<LiveVoiceState>('idle');
  const [orbAudioLevel, setOrbAudioLevel] = useState(0.18);
  const lastReportedEnergyRef = useRef(0.18);
  const lastReportedProgressRef = useRef(0);

  useMotionValueEvent(smoothProgress, 'change', (latest) => {
    const energy = smoothstep(latest / 0.75);
    const targetAudio = 0.18 + energy * 0.58;

    const nextVoice: LiveVoiceState =
      energy > 0.55 ? 'speaking' : energy > 0.14 ? 'listening' : 'idle';
    setOrbVoiceState((prev) => (prev === nextVoice ? prev : nextVoice));

    if (Math.abs(targetAudio - lastReportedEnergyRef.current) > 0.025) {
      lastReportedEnergyRef.current = targetAudio;
      setOrbAudioLevel(targetAudio);
    }

    if (
      onEnergyProgressChange &&
      Math.abs(energy - lastReportedProgressRef.current) > 0.03
    ) {
      lastReportedProgressRef.current = energy;
      onEnergyProgressChange(energy);
    }
  });

  return (
    <section
      ref={heroSectionRef}
      aria-label="SOTAL Tutor introduction"
      className="relative z-10 flex min-h-[100dvh] w-full flex-col items-center justify-center px-5 sm:px-6 pt-20 pb-14"
    >
      <div className="mx-auto flex w-full max-w-[980px] flex-col items-center text-center">
        {/* Central 3D Liquid-Glass AI Orb */}
        <motion.div
          style={reducedMotion ? undefined : { scale: orbScale }}
          className="relative z-10 flex h-[268px] w-[268px] sm:h-[324px] sm:w-[324px] lg:h-[364px] lg:w-[364px] items-center justify-center will-change-transform"
        >
          <LiquidGlassOrb
            voiceState={orbVoiceState}
            audioLevel={orbAudioLevel}
            isDark={isDark}
            className="h-full w-full"
          />
        </motion.div>

        {/* Hero Typography — SOTAL Tutor */}
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="mt-4 sm:mt-6 max-w-2xl"
        >
          <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.75rem] font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-50 leading-[1.06]">
            SOTAL Tutor
          </h1>
          <p className="mx-auto mt-3.5 sm:mt-4 max-w-lg text-sm sm:text-base lg:text-[1.0625rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
            Your personal academic workspace. Learn, practice, explore, and grow with AI — grounded in your own courses and notes.
          </p>
        </motion.div>

        {/* Authentication Error */}
        {authError && (
          <div className="mt-5 w-full max-w-md text-left">
            <ErrorBanner message={authError} onDismiss={onClearAuthError} />
          </div>
        )}

        {/* Hero Actions */}
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mt-6 sm:mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Button
            size="md"
            onClick={onSignIn}
            loading={signingIn}
            className="h-11 rounded-full px-6 shadow-sm"
          >
            Continue with Google
            <ArrowRight className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={onExploreClick}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-5 text-sm font-medium text-zinc-700 dark:text-zinc-300 backdrop-blur-sm hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Explore workspace
          </button>
          <PWAInstallButton variant="hero" />
        </motion.div>
      </div>

      {/* Quiet scroll indicator */}
      <motion.div
        style={reducedMotion ? undefined : { opacity: scrollHintOpacity }}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 text-zinc-400 dark:text-zinc-500"
      >
        <span className="text-[11px] font-medium tracking-tight">Scroll to explore</span>
        <ArrowDown className="h-3.5 w-3.5" />
      </motion.div>
    </section>
  );
};

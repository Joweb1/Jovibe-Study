import React, { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Button } from '../components/ui/Button';
import { SotalLogo } from '../components/ui/SotalLogo';
import { PWAInstallButton } from '../components/pwa/PWAInstallButton';
import { HomepageBackground } from '../components/landing/HomepageBackground';
import { HeroOrbStage } from '../components/landing/HeroOrbStage';
import { FeatureShowcaseSections } from '../components/landing/FeatureShowcaseSections';

const HEADER_ANCHORS = [
  { id: 'tutor', label: 'Tutor' },
  { id: 'practice', label: 'Practice' },
  { id: 'library', label: 'Library' },
  { id: 'consistency', label: 'Consistency' },
] as const;

export const AuthPage: React.FC = () => {
  const { signInWithGoogle, signingIn, authError, clearAuthError } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [heroEnergy, setHeroEnergy] = useState(0);
  const [headerScrolled, setHeaderScrolled] = useState(false);

  const isDark = theme === 'dark';

  // Lightly blur the floating transparent header only after the page scrolls beneath it
  useEffect(() => {
    const onScroll = () => {
      const scrolledNow = window.scrollY > 24;
      setHeaderScrolled((prev) => (prev === scrolledNow ? prev : scrolledNow));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToSection = useCallback((sectionId: string) => {
    const target = document.getElementById(sectionId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleSignIn = useCallback(() => {
    void signInWithGoogle();
  }, [signInWithGoogle]);

  return (
    <div className="relative min-h-screen bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-200 flex flex-col transition-colors">
      {/* Subtle fluid ambient background influenced by the hero centerpiece */}
      <HomepageBackground energyProgress={heroEnergy} />

      {/* Minimal Floating Transparent Header (no solid full-width navbar box) */}
      <header
        className={`fixed inset-x-0 top-0 z-30 transition-[background-color,backdrop-filter] duration-300 ${
          headerScrolled
            ? 'bg-white/65 dark:bg-zinc-950/55 backdrop-blur-md'
            : 'bg-transparent'
        }`}
      >
        <div className="mx-auto flex min-h-16 max-w-[1120px] items-center justify-between gap-2 sm:gap-6 px-4 py-2 sm:px-6">
          {/* Left: Jovibe Study logo & wordmark */}
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="inline-flex min-w-0 shrink items-center gap-2 font-display text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-100 cursor-pointer"
          >
            <SotalLogo size="md" />
            <span className="truncate">Jovibe Study</span>
          </button>

          {/* Center: Clean single-line section links on desktop */}
          <nav
            aria-label="Homepage sections"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            {HEADER_ANCHORS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                className="relative py-1 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right: Theme toggle, PWA install & existing Google Sign-in action */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton variant="header" />
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200/80 dark:border-zinc-800/80 bg-white/55 dark:bg-zinc-900/55 text-zinc-700 dark:text-zinc-300 backdrop-blur-sm hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors cursor-pointer shrink-0"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Button
              size="sm"
              onClick={handleSignIn}
              loading={signingIn}
              className="rounded-full px-3.5 sm:px-4"
            >
              <span className="sm:hidden">Sign in</span>
              <span className="hidden sm:inline">Sign in with Google</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Journey */}
      <main className="relative z-10 flex-1">
        <HeroOrbStage
          isDark={isDark}
          signingIn={signingIn}
          authError={authError}
          onSignIn={handleSignIn}
          onClearAuthError={clearAuthError}
          onExploreClick={() => scrollToSection('workspace')}
          onEnergyProgressChange={setHeroEnergy}
        />

        <FeatureShowcaseSections signingIn={signingIn} onSignIn={handleSignIn} />

        {/* Personal About Section */}
        <section
          id="about"
          aria-labelledby="about-heading"
          className="border-t border-zinc-200/80 dark:border-zinc-800/80"
        >
          <div className="mx-auto max-w-[1120px] px-5 sm:px-6 py-14 sm:py-16">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 items-start">
              <div className="md:col-span-4 space-y-1.5">
                <p className="text-xs font-medium tracking-wide uppercase text-zinc-500 dark:text-zinc-400">
                  About the creator
                </p>
                <h2
                  id="about-heading"
                  className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-100"
                >
                  Uroh Jonadab
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Student, Logistics and Supply Chain Management
                </p>
              </div>

              <div className="md:col-span-8 max-w-2xl space-y-3.5 text-sm sm:text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                <p>
                  Hi, I&apos;m{' '}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    Uroh Jonadab
                  </span>
                  , a student currently studying Logistics and Supply Chain Management with a growing passion for technology, software engineering, AI, and building meaningful products.
                </p>
                <p>
                  Jovibe Study started from my interest in learning and technology — and the idea of making studying smarter, more accessible, and more personalized for students. I&apos;m building it as part of my own journey of learning, experimenting with AI, writing software, and turning ideas into real products. More than just an application, it&apos;s part of my path as a student, developer, and aspiring technology builder.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="relative z-10 border-t border-zinc-200/80 dark:border-zinc-800/80 py-7">
        <div className="mx-auto flex flex-col sm:flex-row max-w-[1120px] items-center justify-between gap-3 px-5 sm:px-6 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-2.5 gap-y-1">
            <span className="inline-flex items-center gap-2 font-display font-medium text-zinc-800 dark:text-zinc-300">
              <SotalLogo size="xs" />
              <span>Jovibe Study</span>
            </span>
            <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
              ·
            </span>
            <span>Personal Academic Learning Workspace</span>
          </div>
          <p className="text-zinc-500 dark:text-zinc-400">
            Created by{' '}
            <span className="font-medium text-zinc-900 dark:text-zinc-200">
              Uroh Jonadab
            </span>
            .
          </p>
        </div>
      </footer>
    </div>
  );
};

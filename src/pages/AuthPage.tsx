import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { ErrorBanner } from '../components/ui/StateViews';

const CAPABILITIES = [
  {
    index: '01',
    title: 'Personal Library',
    detail:
      'Organize courses, optional topics, and extracted study materials in a single cloud-synced knowledge base.',
  },
  {
    index: '02',
    title: 'Course-Aware AI Tutor',
    detail:
      'Ask academic questions grounded in your uploaded materials with clear source traceability and selectable source modes.',
  },
  {
    index: '03',
    title: 'Structured Practice',
    detail:
      'Reinforce concepts through flashcards, CBT tests, fill-in-the-gap exercises, and interactive AI oral examinations.',
  },
  {
    index: '04',
    title: 'Automatic Study',
    detail:
      'Learn progressively through structured lesson units, adaptive evaluation, and persistent checkpoints that resume exactly where you stopped.',
  },
];

export const AuthPage: React.FC = () => {
  const { signInWithGoogle, signingIn, authError, clearAuthError } = useAuth();

  return (
    <div className="min-h-screen bg-white text-zinc-950 flex flex-col">
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between px-6">
          <span className="font-display text-base font-semibold tracking-tight text-zinc-950">
            SOTAL Study
          </span>
          <Button size="sm" onClick={() => void signInWithGoogle()} loading={signingIn}>
            Sign in with Google
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col justify-center px-6 py-16 lg:py-24">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-12 lg:items-start">
          {/* Primary focal column */}
          <div className="lg:col-span-6">
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-zinc-950 leading-[1.15]">
              A focused academic workspace built for real understanding.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-zinc-600">
              Bring your lecture slides, textbooks, and notes into one persistent learning environment. Organize by course, study with a grounded tutor, practise deliberately, and resume long study sessions across devices.
            </p>

            {authError && (
              <div className="mt-6 max-w-md">
                <ErrorBanner message={authError} onDismiss={clearAuthError} />
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button onClick={() => void signInWithGoogle()} loading={signingIn}>
                Continue with Google
                <ArrowRight className="h-4 w-4" />
              </Button>
              <span className="text-xs text-zinc-500">
                Cloud-synced with Firebase Authentication and Firestore
              </span>
            </div>
          </div>

          {/* Structured architectural index */}
          <div className="lg:col-span-6 border-t border-zinc-200 pt-2">
            {CAPABILITIES.map((item) => (
              <div
                key={item.index}
                className="grid grid-cols-12 gap-4 border-b border-zinc-200 py-5"
              >
                <div className="col-span-2 font-mono text-xs text-zinc-400 tabular-nums pt-0.5">
                  {item.index}
                </div>
                <div className="col-span-10">
                  <h2 className="text-sm font-semibold text-zinc-950">{item.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-600">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-100 py-6">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6 text-xs text-zinc-500">
          <span>SOTAL Study</span>
          <span>Personal Academic Learning Workspace</span>
        </div>
      </footer>
    </div>
  );
};

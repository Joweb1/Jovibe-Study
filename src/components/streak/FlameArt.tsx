import React, { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';

export type FlameVisualMode = 'active' | 'frozen' | 'cracking' | 'shattering' | 'dormant';

interface FlameArtProps {
  mode?: FlameVisualMode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  bursting?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<FlameArtProps['size']>, string> = {
  sm: 'h-12 w-12',
  md: 'h-20 w-20',
  lg: 'h-28 w-28',
  xl: 'h-36 w-36',
};

const EMBER_SPECS = [
  { id: 'e1', cx: 36, cy: 52, r: 2.3, dx: -10, dy: -36, delay: 0 },
  { id: 'e2', cx: 64, cy: 48, r: 1.9, dx: 12, dy: -40, delay: 0.35 },
  { id: 'e3', cx: 50, cy: 36, r: 2.1, dx: -3, dy: -32, delay: 0.7 },
  { id: 'e4', cx: 42, cy: 62, r: 1.6, dx: -14, dy: -30, delay: 1.05 },
  { id: 'e5', cx: 60, cy: 58, r: 1.8, dx: 15, dy: -34, delay: 1.4 },
];

const ICE_SHARDS = [
  { id: 's1', points: '50,14 34,36 52,42', tx: -28, ty: -32, rot: -26 },
  { id: 's2', points: '50,14 68,38 52,42', tx: 30, ty: -28, rot: 24 },
  { id: 's3', points: '34,36 22,68 46,66 52,42', tx: -36, ty: 8, rot: -32 },
  { id: 's4', points: '68,38 78,68 54,66 52,42', tx: 36, ty: 10, rot: 30 },
  { id: 's5', points: '22,68 38,88 54,66 46,66', tx: -20, ty: 30, rot: -18 },
  { id: 's6', points: '78,68 62,88 54,66', tx: 24, ty: 28, rot: 22 },
];

/**
 * Multi-layered 3D-style flame emblem with volumetric gradients, specular highlight,
 * rising embers, and optional ice-block / crack / shatter states for the streak reveal.
 */
export const FlameArt: React.FC<FlameArtProps> = ({
  mode = 'active',
  size = 'lg',
  bursting = false,
  className = '',
}) => {
  const uid = useId().replace(/:/g, '');
  const reducedMotion = useReducedMotion();

  const isDormant = mode === 'dormant';
  const isFrozen = mode === 'frozen';
  const isCracking = mode === 'cracking';
  const isShattering = mode === 'shattering';
  const showFlame = mode === 'active' || mode === 'shattering' || mode === 'cracking' || isDormant;
  const showEmbers = (mode === 'active' || mode === 'shattering') && !reducedMotion;

  return (
    <div
      className={`relative inline-flex items-center justify-center select-none ${SIZE_CLASSES[size]} ${className}`}
      aria-hidden="true"
    >
      {/* Atmospheric Radial Glow */}
      <motion.div
        animate={
          reducedMotion
            ? { opacity: isDormant ? 0.15 : 0.45 }
            : bursting
            ? { scale: [1, 1.42, 1.1], opacity: [0.65, 1, 0.55] }
            : isFrozen
            ? { scale: [0.96, 1.04, 0.96], opacity: [0.38, 0.52, 0.38] }
            : isDormant
            ? { scale: 1, opacity: 0.16 }
            : { scale: [0.95, 1.08, 0.95], opacity: [0.42, 0.68, 0.42] }
        }
        transition={
          bursting
            ? { duration: 0.55, ease: [0.16, 1, 0.3, 1] }
            : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }
        }
        className="pointer-events-none absolute inset-0 rounded-full blur-xl"
        style={{
          background: isFrozen
            ? 'radial-gradient(circle, rgba(56,189,248,0.48) 0%, rgba(125,211,252,0.16) 55%, transparent 75%)'
            : isDormant
            ? 'radial-gradient(circle, rgba(161,161,170,0.35) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(251,146,60,0.62) 0%, rgba(239,68,68,0.28) 48%, transparent 74%)',
        }}
      />

      <svg viewBox="0 0 100 100" className="relative z-10 h-full w-full overflow-visible">
        <defs>
          {/* Outer 3D Fire Shell */}
          <linearGradient id={`${uid}-outer`} x1="50%" y1="6%" x2="50%" y2="96%">
            <stop offset="0%" stopColor={isDormant ? '#a1a1aa' : '#fde047'} />
            <stop offset="28%" stopColor={isDormant ? '#71717a' : '#fb923c'} />
            <stop offset="68%" stopColor={isDormant ? '#52525b' : '#f97316'} />
            <stop offset="100%" stopColor={isDormant ? '#3f3f46' : '#dc2626'} />
          </linearGradient>

          {/* Mid Volumetric Amber Body */}
          <linearGradient id={`${uid}-mid`} x1="45%" y1="15%" x2="55%" y2="95%">
            <stop offset="0%" stopColor={isDormant ? '#d4d4d8' : '#fef08a'} />
            <stop offset="50%" stopColor={isDormant ? '#a1a1aa' : '#f59e0b'} />
            <stop offset="100%" stopColor={isDormant ? '#52525b' : '#ea580c'} />
          </linearGradient>

          {/* Incandescent Inner Core */}
          <linearGradient id={`${uid}-core`} x1="50%" y1="10%" x2="50%" y2="100%">
            <stop offset="0%" stopColor={isDormant ? '#f4f4f5' : '#fffbeb'} />
            <stop offset="55%" stopColor={isDormant ? '#d4d4d8' : '#fde047'} />
            <stop offset="100%" stopColor={isDormant ? '#71717a' : '#fb923c'} />
          </linearGradient>

          {/* Ice Crystal Gradient */}
          <linearGradient id={`${uid}-ice`} x1="20%" y1="10%" x2="85%" y2="92%">
            <stop offset="0%" stopColor="#f0f9ff" stopOpacity="0.96" />
            <stop offset="38%" stopColor="#bae6fd" stopOpacity="0.88" />
            <stop offset="75%" stopColor="#38bdf8" stopOpacity="0.84" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.92" />
          </linearGradient>

          {/* Glossy Highlight */}
          <linearGradient id={`${uid}-gloss`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grounded 3D Contact Shadow */}
        <ellipse
          cx="50"
          cy="93"
          rx={isFrozen ? '22' : '24'}
          ry="4.5"
          fill={isFrozen ? 'rgba(14,165,233,0.22)' : isDormant ? 'rgba(63,63,70,0.2)' : 'rgba(234,88,12,0.28)'}
        />

        {/* Rising Glowing Embers */}
        {showEmbers &&
          EMBER_SPECS.map((ember) => (
            <motion.circle
              key={ember.id}
              cx={ember.cx}
              cy={ember.cy}
              r={ember.r}
              fill="#fde047"
              initial={{ opacity: 0, x: 0, y: 0, scale: 0.7 }}
              animate={{
                opacity: [0, 0.95, 0],
                x: [0, ember.dx * 0.5, ember.dx],
                y: [0, ember.dy * 0.55, ember.dy],
                scale: [0.6, 1.15, 0.3],
              }}
              transition={{
                duration: bursting ? 0.75 : 1.9,
                delay: bursting ? ember.delay * 0.15 : ember.delay,
                repeat: Infinity,
                ease: 'easeOut',
              }}
            />
          ))}

        {/* Layered 3D Flame Body */}
        {showFlame && (
          <motion.g
            style={{ originX: '50px', originY: '84px' }}
            animate={
              reducedMotion
                ? { scale: 1, opacity: isCracking ? 0.65 : 1 }
                : bursting
                ? { scale: [1, 1.24, 0.97, 1.05, 1], rotate: [0, -2, 2, 0] }
                : isCracking
                ? { scale: [0.86, 0.94, 0.88], opacity: [0.5, 0.85, 0.6] }
                : isDormant
                ? { scale: 1, opacity: 0.72 }
                : {
                    scaleX: [1, 0.97, 1.03, 1],
                    scaleY: [1, 1.05, 0.98, 1],
                    rotate: [0, -1.2, 1.2, 0],
                  }
            }
            transition={
              bursting
                ? { duration: 0.55, ease: [0.16, 1, 0.3, 1] }
                : { duration: 2.1, repeat: Infinity, ease: 'easeInOut' }
            }
          >
            {/* Outer Volumetric Flame */}
            <path
              d="M50 8 C54 20 69 30 75 46 C81 62 74 87 50 89 C26 87 19 62 25 46 C29 36 36 31 37 22 C41 27 44 28 45 22 C46 16 48 11 50 8 Z"
              fill={`url(#${uid}-outer)`}
            />

            {/* Secondary Tongue Accent for 3D Depth */}
            <path
              d="M52 24 C62 34 70 46 69 62 C68 78 59 87 49 87 C36 87 30 75 31 60 C32 48 40 39 45 31 C47 35 49 34 52 24 Z"
              fill={`url(#${uid}-mid)`}
            />

            {/* Bright Inner Core */}
            <path
              d="M50 43 C57 51 62 60 60 72 C59 81 55 86 50 86 C44 86 40 80 39 71 C38 61 43 52 50 43 Z"
              fill={`url(#${uid}-core)`}
            />

            {/* 3D Specular Rim Highlight */}
            <path
              d="M36 46 C31 55 30 68 35 76 C33 67 35 56 41 48 C39 47 37 46 36 46 Z"
              fill={`url(#${uid}-gloss)`}
            />
          </motion.g>
        )}

        {/* Frozen / Cracking Ice Crystal Shell */}
        {(isFrozen || isCracking) && (
          <motion.g
            animate={
              isCracking && !reducedMotion
                ? { x: [0, -2.5, 2.5, -1.8, 1.8, 0], rotate: [0, -1.2, 1.2, 0] }
                : { x: 0, rotate: 0 }
            }
            transition={{ duration: 0.36, repeat: isCracking ? Infinity : 0 }}
            style={{ originX: '50px', originY: '54px' }}
          >
            {/* Outer Ice Block */}
            <polygon
              points="50,12 72,36 78,68 62,89 38,89 22,68 28,36"
              fill={`url(#${uid}-ice)`}
              stroke="#e0f2fe"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {/* Internal Crystalline Facets */}
            <polyline
              points="50,12 52,44 78,68"
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.65"
              strokeWidth="1.5"
            />
            <polyline
              points="28,36 52,44 38,89"
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.45"
              strokeWidth="1.3"
            />
            <polygon
              points="36,34 48,22 50,42 32,46"
              fill="#ffffff"
              fillOpacity="0.32"
            />

            {/* Glowing Crack Fractures during cracking phase */}
            {isCracking && (
              <motion.g
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
              >
                <polyline
                  points="50,18 46,36 54,48 44,64 52,82"
                  fill="none"
                  stroke="#fef08a"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points="46,36 30,44"
                  fill="none"
                  stroke="#fb923c"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <polyline
                  points="54,48 72,56"
                  fill="none"
                  stroke="#fb923c"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <polyline
                  points="44,64 28,70"
                  fill="none"
                  stroke="#fde047"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </motion.g>
            )}
          </motion.g>
        )}

        {/* Shattering Ice Shards Flying Outward */}
        {isShattering && !reducedMotion && (
          <g>
            {ICE_SHARDS.map((shard) => (
              <motion.polygon
                key={shard.id}
                points={shard.points}
                fill="#bae6fd"
                stroke="#f0f9ff"
                strokeWidth="1.2"
                initial={{ x: 0, y: 0, opacity: 0.95, scale: 1, rotate: 0 }}
                animate={{
                  x: shard.tx,
                  y: shard.ty,
                  opacity: 0,
                  scale: 0.45,
                  rotate: shard.rot,
                }}
                transition={{ duration: 0.58, ease: [0.16, 1, 0.3, 1] }}
                style={{ originX: '50px', originY: '52px' }}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
};

/**
 * Compact crisp flame icon for headers and calendar cells (no emoji clutter).
 */
export const MiniFlameIcon: React.FC<{
  active?: boolean;
  className?: string;
}> = ({ active = true, className = 'h-4 w-4' }) => {
  const uid = useId().replace(/:/g, '');
  const reducedMotion = useReducedMotion();

  return (
    <motion.svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      animate={
        active && !reducedMotion
          ? { scaleY: [1, 1.07, 0.98, 1], scaleX: [1, 0.97, 1.02, 1] }
          : undefined
      }
      transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      style={{ originX: '50%', originY: '85%' }}
    >
      <defs>
        <linearGradient id={`${uid}-mf-outer`} x1="50%" y1="5%" x2="50%" y2="100%">
          <stop offset="0%" stopColor={active ? '#fde047' : '#a1a1aa'} />
          <stop offset="45%" stopColor={active ? '#f97316' : '#71717a'} />
          <stop offset="100%" stopColor={active ? '#dc2626' : '#52525b'} />
        </linearGradient>
        <linearGradient id={`${uid}-mf-core`} x1="50%" y1="15%" x2="50%" y2="100%">
          <stop offset="0%" stopColor={active ? '#fffbeb' : '#e4e4e7'} />
          <stop offset="100%" stopColor={active ? '#facc15' : '#a1a1aa'} />
        </linearGradient>
      </defs>
      <path
        d="M12.3 2.2C13.5 5.4 17.2 7.8 18.6 11.7C19.8 15.4 17.8 21.4 12 21.8C6.2 21.4 4.2 15.4 5.5 11.6C6.4 9.2 8.1 7.8 8.6 5.6C9.7 7 10.6 7.1 10.9 5.5C11.2 4.1 11.7 3 12.3 2.2Z"
        fill={`url(#${uid}-mf-outer)`}
      />
      <path
        d="M12 10.6C13.8 12.6 14.9 14.7 14.5 17.4C14.2 19.4 13.2 20.6 12 20.6C10.7 20.6 9.8 19.3 9.5 17.2C9.2 14.8 10.4 12.7 12 10.6Z"
        fill={`url(#${uid}-mf-core)`}
      />
    </motion.svg>
  );
};

import type { StudySection } from '../../types/models';

export type LiveVoiceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupting'
  | 'disconnected';

export type LiveNetworkQuality = 'good' | 'slow' | 'poor' | 'offline';

export interface LiveNetworkStatus {
  quality: LiveNetworkQuality;
  rttMs: number | null;
  reason?: string;
}

export type LiveViewportPreview = 'responsive' | 'tablet' | 'mobile';

export interface LiveLessonContext {
  courseCode: string;
  courseName: string;
  topicName: string;
  lessonTitle: string;
  sourceId?: string;
  summary: string;
  sections: StudySection[];
  keyPrompts: string[];
}

export interface LiveScriptStep {
  state: LiveVoiceState;
  subtitle: string;
  speaker: 'companion' | 'student' | 'system';
  durationMs: number;
  simulatedLevel: number;
}

export const LIVE_STATE_LABELS: Record<LiveVoiceState, string> = {
  idle: 'Your turn',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  interrupting: 'Listening',
  disconnected: 'Connection paused',
};

export const FALLBACK_LIVE_LESSON: LiveLessonContext = {
  courseCode: 'BIO 201',
  courseName: 'Cell Biology & Metabolism',
  topicName: 'Cellular Energetics',
  lessonTitle: 'Cellular Respiration & ATP Synthesis',
  summary:
    'How cells convert glucose into usable ATP across glycolysis, the citric acid cycle, and oxidative phosphorylation.',
  sections: [
    {
      id: 'sec_1',
      heading: '1. Glycolysis in the Cytosol',
      level: 2,
      content:
        'A 6-carbon glucose molecule splits into two 3-carbon pyruvate molecules, yielding a net gain of 2 ATP and 2 NADH without requiring oxygen.',
    },
    {
      id: 'sec_2',
      heading: '2. Pyruvate Oxidation & Citric Acid Cycle',
      level: 2,
      content:
        'Inside the mitochondrial matrix, pyruvate converts to Acetyl-CoA and drives the Krebs cycle, loading electron carriers NADH and FADH2.',
    },
    {
      id: 'sec_3',
      heading: '3. Electron Transport Chain & Chemiosmosis',
      level: 2,
      content:
        'Electrons flow down protein complexes, pumping protons into the intermembrane space. ATP synthase spins like a turbine as protons flow back, producing ~28–32 ATP.',
    },
  ],
  keyPrompts: [
    'Explain this like we are grabbing coffee',
    'Quiz me with one quick scenario',
    'What is the easiest way to remember the steps?',
  ],
};

export function buildSampleSubtitleForState(
  state: LiveVoiceState,
  lessonTitle: string
): { speaker: 'companion' | 'student' | 'system'; text: string } {
  switch (state) {
    case 'idle':
      return {
        speaker: 'companion',
        text: `Whenever you're ready — want to unpack "${lessonTitle}" together, no pressure?`,
      };
    case 'listening':
      return {
        speaker: 'student',
        text: '"Wait, why does this step even matter? Every time I read it my brain just blurs out..."',
      };
    case 'thinking':
      return {
        speaker: 'companion',
        text: 'Finding a simpler angle for you...',
      };
    case 'speaking':
      return {
        speaker: 'companion',
        text: 'Haha, totally fair — the textbook makes it sound way scarier than it is. Think of it like passing a baton in a relay race where every handoff unlocks a little burst of energy. Want to try picturing the next step?',
      };
    case 'interrupting':
      return {
        speaker: 'student',
        text: '"Oh wait—hold on, so that means if the first part slows down..."',
      };
    case 'disconnected':
      return {
        speaker: 'system',
        text: 'Lost touch for a moment. Your lesson context is still right here whenever you reconnect.',
      };
  }
}

export function buildSampleConversationScript(lessonTitle: string): LiveScriptStep[] {
  return [
    {
      state: 'idle',
      speaker: 'companion',
      subtitle: `Come in — let's kick back and talk through "${lessonTitle}". Where do you want to start?`,
      durationMs: 2800,
      simulatedLevel: 0.1,
    },
    {
      state: 'listening',
      speaker: 'student',
      subtitle: '"Honestly I keep mixing up the main stages. Can you give me the chill, zero-jargon version?"',
      durationMs: 3600,
      simulatedLevel: 0.62,
    },
    {
      state: 'thinking',
      speaker: 'companion',
      subtitle: 'Piecing together a clean mental picture...',
      durationMs: 2200,
      simulatedLevel: 0.25,
    },
    {
      state: 'speaking',
      speaker: 'companion',
      subtitle:
        'Love that — zero jargon, coming right up. Imagine you are breaking a big bill into smaller coins you can actually spend at a vending machine. First you split it in half, then you trade the rest for quick energy tokens...',
      durationMs: 5200,
      simulatedLevel: 0.74,
    },
    {
      state: 'interrupting',
      speaker: 'student',
      subtitle: '"Wait haha—so the vending machine tokens are basically the final output?"',
      durationMs: 1100,
      simulatedLevel: 0.72,
    },
    {
      state: 'listening',
      speaker: 'student',
      subtitle: '"Wait haha—so the vending machine tokens are basically the final output?"',
      durationMs: 2600,
      simulatedLevel: 0.58,
    },
    {
      state: 'thinking',
      speaker: 'companion',
      subtitle: '',
      durationMs: 1400,
      simulatedLevel: 0.22,
    },
    {
      state: 'speaking',
      speaker: 'companion',
      subtitle:
        'Spot on! You nailed it on the first try. Now here is a fun one — what do you think happens if that last step suddenly runs out of fuel?',
      durationMs: 4800,
      simulatedLevel: 0.68,
    },
    {
      state: 'idle',
      speaker: 'companion',
      subtitle: 'Take a guess — no wrong answers here.',
      durationMs: 3200,
      simulatedLevel: 0.12,
    },
  ];
}

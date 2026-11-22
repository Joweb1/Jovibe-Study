import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { EndSensitivity, Modality, StartSensitivity, type LiveServerMessage } from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';
import {
  classifyAiError,
  createGeminiClient,
  resolveApiKey,
  resolveTtsVoice,
} from './geminiService.ts';

export const LIVE_VOICE_MODEL = 'gemini-3.8-live';

interface LessonSectionPayload {
  heading?: string;
  content?: string;
}

interface LiveLessonPayload {
  courseCode?: string;
  courseName?: string;
  topicName?: string;
  lessonTitle?: string;
  summary?: string;
  sections?: LessonSectionPayload[];
}

interface ClientInitMessage {
  type: 'init';
  apiKey?: string;
  byokOnly?: boolean;
  voiceName?: string;
  sendGreeting?: boolean;
  lesson?: LiveLessonPayload;
}

interface ClientAudioMessage {
  type: 'audio';
  data: string;
}

interface ClientTextMessage {
  type: 'text';
  text: string;
}

interface ClientAudioStreamEndMessage {
  type: 'audioStreamEnd';
}

interface ClientPingMessage {
  type: 'ping';
  ts?: number;
}

type ClientLiveMessage =
  | ClientInitMessage
  | ClientAudioMessage
  | ClientTextMessage
  | ClientAudioStreamEndMessage
  | ClientPingMessage;

function buildLiveSystemInstruction(lesson?: LiveLessonPayload): string {
  const courseCode = (lesson?.courseCode || '').trim().slice(0, 40);
  const courseName = (lesson?.courseName || '').trim().slice(0, 140);
  const topicName = (lesson?.topicName || '').trim().slice(0, 140);
  const lessonTitle = (lesson?.lessonTitle || 'Current Study Topic').trim().slice(0, 180);
  const summary = (lesson?.summary || '').trim().slice(0, 800);

  const sectionBlocks: string[] = [];
  let charBudget = 9000;
  if (Array.isArray(lesson?.sections)) {
    for (const sec of lesson.sections.slice(0, 14)) {
      const heading = typeof sec?.heading === 'string' ? sec.heading.trim() : '';
      const content = typeof sec?.content === 'string' ? sec.content.trim() : '';
      if (!heading && !content) continue;
      const chunk = `${heading ? `${heading}\n` : ''}${content}`.slice(0, 1800);
      if (chunk.length > charBudget) break;
      sectionBlocks.push(chunk);
      charBudget -= chunk.length;
    }
  }

  const contextLines = [
    courseCode || courseName ? `Course: ${[courseCode, courseName].filter(Boolean).join(' — ')}` : '',
    topicName ? `Topic: ${topicName}` : '',
    `Lesson: ${lessonTitle}`,
    summary ? `Overview: ${summary}` : '',
    sectionBlocks.length > 0 ? `Lesson Notes:\n${sectionBlocks.join('\n\n')}` : '',
  ].filter(Boolean);

  return [
    'You are SOTAL Live, a warm, relaxed, intelligent study companion speaking aloud in real time with a student.',
    'Vibe & personality:',
    '- Speak naturally like a friendly, encouraging study partner hanging out over coffee — never like a stiff lecturer, chatbot, or formal voice assistant.',
    '- Keep explanations super clear and simple. Use relatable everyday analogies, occasional light humor, and genuine warmth.',
    '- Keep most spoken replies concise and conversational (about 2 to 4 natural sentences) unless the student asks for a deeper walkthrough.',
    '- Naturally ask short, low-pressure follow-up questions to keep the conversation flowing and help the student check their understanding.',
    '- Because this is live spoken audio, NEVER output markdown syntax, asterisks, bullet lists, or code formatting — speak in smooth natural sentences.',
    '- If the student interrupts you or jumps in mid-thought, immediately roll with their new question smoothly and warmly.',
    '- Ground your explanations in the student’s current lesson notes below when relevant, and help them connect ideas without making it feel like an exam.',
    '',
    'CURRENT LESSON CONTEXT:',
    contextLines.join('\n'),
  ].join('\n');
}

function safeSend(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function attachLiveWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

  httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const rawUrl = request.url || '';
    const pathname = rawUrl.split('?')[0];
    if (pathname !== '/api/live') {
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (clientWs: WebSocket) => {
    type LiveSession = Awaited<ReturnType<ReturnType<typeof createGeminiClient>['live']['connect']>>;
    let liveSession: LiveSession | null = null;
    let connecting = false;
    let closedByClient = false;

    const closeLiveSession = () => {
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // Ignore close errors
        }
        liveSession = null;
      }
    };

    clientWs.on('close', () => {
      closedByClient = true;
      closeLiveSession();
    });

    clientWs.on('error', () => {
      closedByClient = true;
      closeLiveSession();
    });

    clientWs.on('message', async (rawData) => {
      let msg: ClientLiveMessage;
      try {
        msg = JSON.parse(rawData.toString()) as ClientLiveMessage;
      } catch {
        safeSend(clientWs, {
          type: 'error',
          code: 'INVALID_REQUEST',
          message: 'Invalid message payload.',
          shouldRotateKey: false,
          cooldownMs: 0,
        });
        return;
      }

      if (msg.type === 'ping') {
        safeSend(clientWs, {
          type: 'pong',
          ts: typeof msg.ts === 'number' ? msg.ts : undefined,
        });
        return;
      }

      if (msg.type === 'init') {
        if (connecting || liveSession) {
          closeLiveSession();
        }
        connecting = true;

        let keySource: 'byok' | 'server_fallback' = 'server_fallback';
        try {
          const resolved = resolveApiKey(
            typeof msg.apiKey === 'string' ? msg.apiKey : undefined,
            Boolean(msg.byokOnly)
          );
          keySource = resolved.keySource;
          const voiceName = resolveTtsVoice(msg.voiceName || 'Zephyr');
          const systemInstruction = buildLiveSystemInstruction(msg.lesson);
          const ai = createGeminiClient(resolved.apiKey, 'v1beta');

          const session = await ai.live.connect({
            model: LIVE_VOICE_MODEL,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              realtimeInputConfig: {
                automaticActivityDetection: {
                  startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
                  endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
                  prefixPaddingMs: 180,
                  silenceDurationMs: 650,
                },
              },
              systemInstruction,
            },
            callbacks: {
              onopen: () => {
                // Connected to Gemini Live upstream
              },
              onmessage: (message: LiveServerMessage) => {
                if (closedByClient || clientWs.readyState !== WebSocket.OPEN) return;

                const serverContent = message.serverContent;
                if (!serverContent) return;

                if (serverContent.interrupted) {
                  safeSend(clientWs, { type: 'interrupted' });
                }

                if (serverContent.interimInputTranscription?.text) {
                  safeSend(clientWs, {
                    type: 'interimInputTranscript',
                    text: serverContent.interimInputTranscription.text,
                  });
                }

                if (serverContent.inputTranscription?.text) {
                  safeSend(clientWs, {
                    type: 'inputTranscript',
                    text: serverContent.inputTranscription.text,
                  });
                }

                if (serverContent.outputTranscription?.text) {
                  safeSend(clientWs, {
                    type: 'outputTranscript',
                    text: serverContent.outputTranscription.text,
                  });
                }

                const parts = serverContent.modelTurn?.parts ?? [];
                for (const part of parts) {
                  if (part.inlineData?.data) {
                    safeSend(clientWs, {
                      type: 'audio',
                      data: part.inlineData.data,
                      mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                    });
                  }
                }

                if (serverContent.turnComplete) {
                  safeSend(clientWs, { type: 'turnComplete' });
                }
              },
              onerror: (event: unknown) => {
                if (closedByClient) return;
                const errObj =
                  event && typeof event === 'object' && 'error' in event
                    ? (event as { error?: unknown }).error
                    : event;
                const classified = classifyAiError(errObj, keySource);
                safeSend(clientWs, {
                  type: 'error',
                  code: classified.code,
                  message: classified.message,
                  shouldRotateKey: classified.shouldRotateKey,
                  cooldownMs: classified.cooldownMs,
                });
              },
              onclose: (event: unknown) => {
                liveSession = null;
                if (closedByClient) return;
                const reason =
                  event && typeof event === 'object' && 'reason' in event
                    ? String((event as { reason?: unknown }).reason || '')
                    : '';
                const code =
                  event && typeof event === 'object' && 'code' in event
                    ? Number((event as { code?: unknown }).code || 0)
                    : 0;

                if (reason && /quota|rate|api key|permission|invalid|403|429|1008/i.test(reason)) {
                  const classified = classifyAiError(new Error(reason), keySource);
                  safeSend(clientWs, {
                    type: 'error',
                    code: classified.code,
                    message: classified.message,
                    shouldRotateKey: classified.shouldRotateKey,
                    cooldownMs: classified.cooldownMs,
                  });
                }
                safeSend(clientWs, { type: 'closed', code, reason });
              },
            },
          });

          if (closedByClient || clientWs.readyState !== WebSocket.OPEN) {
            try {
              session.close();
            } catch {
              // Ignore
            }
            return;
          }

          liveSession = session;
          connecting = false;

          safeSend(clientWs, {
            type: 'ready',
            model: LIVE_VOICE_MODEL,
            voiceName,
            keySource,
          });

          if (msg.sendGreeting) {
            const title = (msg.lesson?.lessonTitle || 'this lesson').trim().slice(0, 140);
            try {
              session.sendRealtimeInput({
                text: `The student just joined SOTAL Live to talk about "${title}". Greet them warmly in 1 to 2 relaxed spoken sentences and invite them to jump in whenever they're ready.`,
              });
            } catch (greetErr) {
              console.warn('[SOTAL Live] Greeting send failed:', greetErr);
            }
          }
        } catch (err) {
          connecting = false;
          const classified = classifyAiError(err, keySource);
          safeSend(clientWs, {
            type: 'error',
            code: classified.code,
            message: classified.message,
            shouldRotateKey: classified.shouldRotateKey,
            cooldownMs: classified.cooldownMs,
          });
        }
        return;
      }

      if (!liveSession) return;

      if (msg.type === 'audio' && typeof msg.data === 'string' && msg.data.length > 0) {
        try {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } catch (audioErr) {
          console.warn('[SOTAL Live] Audio chunk forward failed:', audioErr);
        }
        return;
      }

      if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim().length > 0) {
        try {
          liveSession.sendRealtimeInput({
            text: msg.text.trim().slice(0, 2000),
          });
        } catch (textErr) {
          console.warn('[SOTAL Live] Text message forward failed:', textErr);
        }
        return;
      }

      if (msg.type === 'audioStreamEnd') {
        try {
          liveSession.sendRealtimeInput({ audioStreamEnd: true });
        } catch (endErr) {
          console.warn('[SOTAL Live] audioStreamEnd forward failed:', endErr);
        }
      }
    });
  });

  return wss;
}

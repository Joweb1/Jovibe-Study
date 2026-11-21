# SOTAL Study — Agent Handoff

**Last Updated:** 2026-11-21  
**Branch:** `main`  
**Latest Commit:** `5543e31` (`feat: add multi-provider AI fallback (NIM, Cerebras, OpenRouter, Groq TTS) and dark theme`)  
**Build Health:** `npx tsc --noEmit` passes (0 errors); `npm run build` (`vite build`) passes cleanly.

---

## 1. Project Overview & Core Requirements

SOTAL Study is a React 19 + Vite 8 + Tailwind CSS v4 + Express (`tsx server.ts`) study application using Firebase Auth/Firestore for user data and **device-local BYOK (Bring Your Own Key)** storage for AI providers.

### User-Specified AI Fallback Policy
- **Google Gemini** is always the primary provider across all features, rotating across the user's saved Gemini keys.
- Provider switching happens **only when all usable keys for a provider are exhausted** (rate limits/quota cooldown, invalid, or no keys configured) — never on a single transient network error.
- **Cerebras** is a **single-key** (no rotation) fallback for **AI Tutor chat only**, tried after Gemini and before NVIDIA NIM.
- **NVIDIA NIM** is a multi-key rotating fallback for chat, structured JSON (Practice & Automatic Study), OCR/vision, and voice-note transcription.
- **OpenRouter** is a multi-key rotating final fallback (configured and documented, remains idle until the user adds a key in Settings).
- **Groq** is a multi-key rotating fast audio fallback for **Gemini audio playback (TTS)** and **voice-note transcription** (and final chat fallback).
- **Theme:** Full Light / Dark theme toggle with zero visual misalignment.
- **Future work requested later by the user:** Home page improvements + an onboarding guide/tutorial for adding API keys and studying with the app.

---

## 2. What Has Been Completed

### A. Multi-Provider AI Architecture & Fallback Routing
- **`src/services/ai/providers.ts`** — Single source of truth for providers (`gemini`, `cerebras`, `nvidia_nim`, `openrouter`, `groq`), capabilities, model hints, and ordered fallback chains:
  - `chat`: `gemini → cerebras → nvidia_nim → openrouter → groq`
  - `structured_json`: `gemini → nvidia_nim → openrouter`
  - `vision`: `gemini → nvidia_nim → openrouter`
  - `transcription`: `gemini → groq → nvidia_nim → openrouter`
  - `tts`: `gemini → groq`
- **`src/services/ai/keyManager.ts`** — Multi-provider device-local key storage (`localStorage`), key rotation, preferred key pinning, cooldown tracking, and validation (including `groq` min length 20, `cerebras` max 1 key).
- **`src/services/ai/aiRouter.ts`**, **`src/services/ai/errors.ts`**, **`src/services/ai/http.ts`**, **`src/services/ai/geminiTransport.ts`**, **`src/services/ai/providerTransport.ts`**, **`src/services/ai/audioTranscode.ts`** — Unified routing, error classification, cooldown/rotation handling, and provider HTTP transport.
- **`src/services/ai/geminiClient.ts`** — Updated all AI entry points to route through `aiRouter`, including `generateSpeechWithClient()` falling back to Groq via `providerTransport` when Gemini TTS keys are exhausted.
- **`server/openaiProvider.ts`** & **`server/prompts.ts`** — Server-side OpenAI-compatible provider handlers for `nvidia_nim`, `openrouter`, `cerebras`, and `groq` (including `synthesizeProviderSpeech()` via `POST https://api.groq.com/openai/v1/audio/speech` with `canopylabs/orpheus-v1-english`, Whisper transcription via `whisper-large-v3-turbo`, and `testProviderConnection()`).
- **`server.ts`** — Wired `/api/providers/:provider/*` endpoints including live `/api/providers/:provider/tts` using `synthesizeProviderSpeech()`.
- **`src/components/settings/AiKeySettingsSection.tsx`** — Rewritten multi-provider Settings UI supporting all 5 providers (`gemini`, `cerebras`, `nvidia_nim`, `openrouter`, `groq`), fallback chain status summary, inline key testing/editing/removal (no `window.confirm`), and full dark theme support.

### B. Light / Dark Theme Infrastructure & Initial Pass
- **`src/index.css`** — Fixed Tailwind v4 class-based dark mode using `@custom-variant dark (&:where(.dark, .dark *));` (do **not** revert to `@variant dark (&:is(.dark *))`, which fails to match the root element itself).
- **`index.html`** — Added anti-FOUC inline script before `<meta charset>` to apply `.dark` on `<html>` before first paint.
- **`src/context/ThemeContext.tsx`** — Theme context (`light` / `dark` persisted in `localStorage`, synced to `document.documentElement.classList`).
- **`src/App.tsx`** — Wrapped app in `<ThemeProvider>`.
- **Dark-mode completed components/pages:**
  - `src/components/ui/Button.tsx`
  - `src/components/ui/Modal.tsx`
  - `src/components/ui/StateViews.tsx`
  - `src/components/layout/AppShell.tsx` (includes header/nav theme toggle)
  - `src/components/courses/CourseSelector.tsx`
  - `src/components/courses/CourseModal.tsx`
  - `src/components/settings/AiKeySettingsSection.tsx`
  - `src/pages/AuthPage.tsx` (verified in Playwright Chromium screenshots; includes theme toggle)
  - `src/pages/CoursesPage.tsx`
  - `src/pages/SettingsPage.tsx` (includes Appearance section)

---

## 3. What Is Remaining (Priority Order)

### Priority 1 — Complete Dark Mode Styling Across Remaining Pages & Components
The following files still contain hardcoded light Tailwind classes (`bg-white`, `bg-zinc-50`, `text-zinc-950`, `border-zinc-200`, etc.) without `dark:` counterparts. Counts below are unthemed `bg-white` / `bg-zinc-50` hits as of commit `5543e31`:

| File | Unthemed `bg-white` | Unthemed `bg-zinc-50` | Notes |
|---|---:|---:|---|
| `src/pages/TutorPage.tsx` | 13 | 8 | Chat shell, bubbles, composer, toolbars |
| `src/components/library/ImportMaterialModal.tsx` | 12 | 5 | Large import modal (tabs, dropzones, forms) |
| `src/pages/AutomaticStudyPage.tsx` | 9 | 10 | Study plan cards, audio/session controls |
| `src/components/practice/PracticeConfigForm.tsx` | 7 | 2 | Form inputs, selects, toggle buttons |
| `src/pages/LibraryPage.tsx` | 6 | 5 | Material list, headers, filter controls |
| `src/pages/HistoryPage.tsx` | 3 | 2 | History cards, filters |
| `src/components/tutor/SaveResponseModal.tsx` | 3 | 0 | Modal inputs/selects |
| `src/components/practice/ExamPrepSession.tsx` | 3 | 1 | Card containers, answer inputs |
| `src/components/library/SourceViewer.tsx` | 3 | 1 | Viewer container, text inputs/textareas |
| `src/components/practice/FillGapSession.tsx` | 2 | 1 | Card containers, inputs |
| `src/components/practice/CbtSession.tsx` | 2 | 1 | Option buttons, feedback banners |
| `src/components/library/SavedMaterialsView.tsx` | 2 | 0 | Search input, filter selects |
| `src/components/courses/TopicPickerField.tsx` | 2 | 0 | Inputs, dropdowns |
| `src/components/courses/TopicModal.tsx` | 2 | 0 | Form inputs |
| `src/pages/PracticePage.tsx` | 1 | 0 | Page container / tabs |
| `src/components/tutor/ConversationSidebar.tsx` | 1 | 1 | Sidebar container, active items |
| `src/components/practice/FlashcardsSession.tsx` | 1 | 1 | Flashcard surfaces |
| `src/components/tutor/MarkdownMessage.tsx` | 0 | 2 | Code blocks, tables, prose contrast |
| `src/components/pwa/PWAInstallButton.tsx` | 0 | 1 | Install banner/button |
| `src/App.tsx` | 1 | 0 | Loading spinner container (`bg-white` → add `dark:bg-zinc-950`) |

**Also audit for:**
- Hardcoded `text-zinc-950` / `text-zinc-900` / `text-zinc-800` missing `dark:text-zinc-50` or `dark:text-zinc-100`
- Hardcoded `border-zinc-200` / `border-zinc-300` missing `dark:border-zinc-800` or `dark:border-zinc-700`
- Hardcoded `bg-zinc-100` / `hover:bg-zinc-100` / `hover:bg-zinc-50` missing `dark:bg-zinc-800` / `dark:hover:bg-zinc-800`
- Inverted primary badges/cards (`bg-zinc-950 text-white` → `dark:bg-zinc-100 dark:text-zinc-950` for contrast)

Useful audit command:
```bash
grep -rnE "bg-white|bg-zinc-50|border-zinc-200|text-zinc-950" src/ | grep -v "dark:"
```

### Priority 2 — Playwright / Chromium Visual Verification (All Pages)
After finishing Priority 1:
1. Start the dev server: `npm run dev` (serves on `http://localhost:3000`; verify via `curl http://localhost:3000/api/health`).
2. Start headless Chromium if using Playwright MCP over CDP:
   ```bash
   chromium-browser --headless --no-sandbox --disable-gpu --remote-debugging-port=9222 --disable-dev-shm-usage
   ```
3. Inspect **both light and dark themes** across every route and modal (Auth, Courses, Library + Import/SourceViewer modals, Practice + all 4 session modes, Automatic Study, Tutor + Sidebar/SaveResponseModal, History, Settings).
4. Verify zero white/bright panels, readable text contrast, clean borders, and working theme toggle persistence across reloads.
5. Delete any temporary screenshots before committing (`.playwright-mcp/` is already gitignored).

### Priority 3 — Minor Backend, Config & TTS Verification Items
1. **`server.ts` (`/api/health`):** Line 110 currently returns `supportedProviders: ['gemini', 'cerebras', 'nvidia_nim', 'openrouter']` — add `'groq'`.
2. **`.env.example`:** Document optional server env vars (`GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_TTS_MODEL`, `NVIDIA_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, `ALLOW_SERVER_PROVIDER_KEYS`) while clearly noting that production uses device-local BYOK keys in Settings.
3. **Groq TTS playback verification:** Confirm `generateSpeechWithClient()` in `src/services/ai/geminiClient.ts` properly handles the WAV payload returned by `/api/providers/groq/tts` (`synthesizeProviderSpeech()` in `server/openaiProvider.ts`) in the browser audio player (check MIME type / base64 decoding vs PCM handling used by Gemini TTS).

### Priority 4 — Upcoming Features Requested by User (Confirm Before Starting)
Once dark theme and provider fallback polish are done, the user noted they next want to work on:
1. Improving the **Home page** of the application.
2. Adding an in-app **guide/tutorial** for obtaining/adding API keys and using SOTAL Study effectively.

---

## 4. Key Conventions & Constraints

- **Design Palette (Zinc):**
  - Page background: `bg-white dark:bg-zinc-950`
  - Card / elevated surface: `bg-white dark:bg-zinc-900` or `bg-zinc-50 dark:bg-zinc-900`
  - Inputs / controls: `bg-white dark:bg-zinc-900` (or `dark:bg-zinc-800`) with `border-zinc-300 dark:border-zinc-700`
  - Borders / dividers: `border-zinc-200 dark:border-zinc-800`
  - Primary text: `text-zinc-950 dark:text-zinc-50`
  - Secondary text: `text-zinc-600 dark:text-zinc-400` / `text-zinc-500 dark:text-zinc-400`
- **No `window.confirm` / `window.alert`:** Always use inline React confirmation state.
- **No unnecessary external dependencies:** Stick to React, Tailwind, `lucide-react`, and existing UI primitives.
- **Key Privacy:** API keys are stored only in browser `localStorage`, forwarded per-request via headers to the Express server, and never written to Firestore or logged.
- **Verification before every push:**
  ```bash
  npx tsc --noEmit && npm run build
  ```

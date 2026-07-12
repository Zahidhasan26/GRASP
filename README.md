# G.R.A.S.P.

Professional project scaffold for the G.R.A.S.P. (Grip Rehabilitation Assisted Stimulation Platform) interface.

## What This Upgrade Adds

- Keeps your existing `grasp.html` visual design intact.
- Adds modern frontend tooling (`Vite`, `TypeScript`, `ESLint`, `Prettier`, `Vitest`).
- Adds modular, testable TypeScript code for:
  - threshold/profile domain logic,
  - safety state handling,
  - voice command parsing,
  - permanent floating controls (STOP + Voice).
- Adds a production build pipeline and consistent developer workflow.

## Project Structure

- `grasp.html` — original design and core UI flow.
- `src/main.ts` — runtime enhancement layer (voice and emergency controls).
- `src/domain/*` — pure domain logic and tests.
- `src/voice/*` — speech transcript intent parsing.
- `src/device/*` — safety/runtime state model.
- `src/ui/*` — reusable UI runtime utilities.

## Getting Started

```bash
npm install
npm run dev
```

Open the local URL shown in terminal and navigate to `/grasp.html`.

### Gemini Voice Setup (Recommended)

Do not hardcode API keys in frontend code.

1. Copy `.env.example` to `.env`
2. Set `GEMINI_API_KEY` in `.env`
3. Run `npm run dev` (starts web app + Gemini proxy)

Voice flow:
- deterministic local commands run instantly (stop, plus/minus, connect/disconnect, EMG on/off, navigation)
- free-form questions or commands are resolved by Gemini via `/api/voice/gemini`
- Gemini key stays on the backend proxy only

## Commands

- `npm run dev` — local development server.
- `npm run dev:web` — web only (no Gemini proxy).
- `npm run dev:api` — Gemini proxy only.
- `npm run build` — production build.
- `npm run preview` — preview built bundle.
- `npm run typecheck` — TypeScript checks.
- `npm run lint` — lint TypeScript code.
- `npm run test` — run unit tests.
- `npm run format` / `npm run format:write` — formatting.

## Hardware/Runtime Integration Notes

- This codebase currently enhances the existing in-browser simulation flow.
- The next step is wiring runtime events from Pi/ESP32 into a typed transport layer.
- Use the `grasp:safety-stop` custom event to bridge STOP actions into your backend/device command pipeline.

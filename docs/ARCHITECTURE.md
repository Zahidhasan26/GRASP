# Architecture

## Product Flow (from project chat context)

1. Home intro panel.
2. Arm/Palm pathway and mode selection behavior.
3. Placement guidance panel.
4. Calibration panel with sensory, motor, tolerance thresholds.
5. Grip aid panel with hold/release control.
6. Voice access to all selectable actions.
7. Persistent emergency cancellation control.

## Professionalization Strategy

The project now follows a layered structure while preserving the existing design:

- **Presentation layer**: existing `grasp.html` remains source of UI truth.
- **Interaction layer**: `src/main.ts` wires runtime controls and browser APIs.
- **Domain layer**: pure threshold logic (`src/domain/thresholds.ts`) for predictable behavior and testability.
- **Safety layer**: local emergency state model (`src/device/safety-state.ts`) with explicit stop hooks.
- **Input interpretation layer**: deterministic voice intent parsing (`src/voice/command-parser.ts`).

## Safety Principles Encoded

- Emergency stop is always available in the UI.
- Emergency stop is keyboard-accessible (`Esc`) and voice-accessible (`stop`, `cancel`, etc.).
- Stop behavior is modeled as a first-class state transition, not an ad-hoc DOM mutation.
- Clinical thresholds are validated via ordered normalization.

## Tooling Baseline

- Build/dev: Vite
- Type safety: TypeScript strict mode
- Linting: ESLint
- Formatting: Prettier
- Tests: Vitest

## Next Engineering Steps

1. Replace local `window.alert` and browser-only behavior with structured status notifications.
2. Add a typed WebSocket transport (`Pi <-> Browser`) for stimulation control and telemetry.
3. Move inline logic from `grasp.html` into modular TypeScript feature modules progressively.
4. Add end-to-end tests for critical safety interactions (STOP, threshold ordering, grip toggle).

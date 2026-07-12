export type VoiceIntent =
  | { type: "emergency_stop" }
  | { type: "toggle_grip"; on: boolean }
  | { type: "navigate"; panelId: "home" | "stimulation" | "diagnostic" | "gripaid" }
  | { type: "unknown" };

const STOP_PATTERN = /\b(stop|cancel|off|too much|emergency)\b/i;
const GRIP_ON_PATTERN = /\b(grab|hold|close|grip on)\b/i;
const GRIP_OFF_PATTERN = /\b(release|open|let go|grip off)\b/i;

export function parseVoiceCommand(rawTranscript: string): VoiceIntent {
  const text = rawTranscript.trim().toLowerCase();
  if (STOP_PATTERN.test(text)) {
    return { type: "emergency_stop" };
  }

  if (GRIP_ON_PATTERN.test(text)) {
    return { type: "toggle_grip", on: true };
  }

  if (GRIP_OFF_PATTERN.test(text)) {
    return { type: "toggle_grip", on: false };
  }

  if (text.includes("home")) {
    return { type: "navigate", panelId: "home" };
  }
  if (text.includes("electrode") || text.includes("placement") || text.includes("stimulation")) {
    return { type: "navigate", panelId: "stimulation" };
  }
  if (text.includes("diagnostic") || text.includes("calibration")) {
    return { type: "navigate", panelId: "diagnostic" };
  }
  if (text.includes("grip")) {
    return { type: "navigate", panelId: "gripaid" };
  }

  return { type: "unknown" };
}

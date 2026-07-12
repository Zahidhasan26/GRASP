export type VoiceIntent =
  | { type: "emergency_stop" }
  | { type: "toggle_grip"; on: boolean }
  | { type: "step_level"; direction: "up" | "down" }
  | { type: "toggle_emg"; enabled: boolean }
  | { type: "toggle_connection"; connect: boolean }
  | { type: "navigate"; panelId: "home" | "stimulation" | "diagnostic" | "gripaid" }
  | { type: "unknown" };

const STOP_PATTERN = /\b(stop|cancel|off|too much|emergency)\b/i;
const GRIP_ON_PATTERN = /\b(grab|hold|close|grip on)\b/i;
const GRIP_OFF_PATTERN = /\b(release|open|let go|grip off)\b/i;
const LEVEL_UP_PATTERN =
  /\b(power up|increase|level up|plus|\+|raise power|up one|higher)\b/i;
const LEVEL_DOWN_PATTERN =
  /\b(power down|decrease|level down|minus|-|lower power|down one|reduce)\b/i;
const EMG_ON_PATTERN =
  /\b(emg on|enable emg|turn on emg|start emg|switch on emg|activate emg)\b/i;
const EMG_OFF_PATTERN =
  /\b(emg off|disable emg|turn off emg|stop emg|switch off emg|deactivate emg)\b/i;
const CONNECT_PATTERN = /\b(connect|connect device|connect esp32|pair device)\b/i;
const DISCONNECT_PATTERN =
  /\b(disconnect|disconnect device|disconnect esp32|unpair device)\b/i;

export function parseVoiceCommand(rawTranscript: string): VoiceIntent {
  const text = rawTranscript.trim().toLowerCase();
  if (isEmgOnPhrase(text)) {
    return { type: "toggle_emg", enabled: true };
  }
  if (isEmgOffPhrase(text)) {
    return { type: "toggle_emg", enabled: false };
  }

  if (STOP_PATTERN.test(text)) {
    return { type: "emergency_stop" };
  }

  if (GRIP_ON_PATTERN.test(text)) {
    return { type: "toggle_grip", on: true };
  }

  if (GRIP_OFF_PATTERN.test(text)) {
    return { type: "toggle_grip", on: false };
  }

  if (EMG_ON_PATTERN.test(text)) {
    return { type: "toggle_emg", enabled: true };
  }

  if (EMG_OFF_PATTERN.test(text)) {
    return { type: "toggle_emg", enabled: false };
  }

  if (LEVEL_UP_PATTERN.test(text)) {
    return { type: "step_level", direction: "up" };
  }

  if (LEVEL_DOWN_PATTERN.test(text)) {
    return { type: "step_level", direction: "down" };
  }

  if (CONNECT_PATTERN.test(text)) {
    return { type: "toggle_connection", connect: true };
  }

  if (DISCONNECT_PATTERN.test(text)) {
    return { type: "toggle_connection", connect: false };
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

function isEmgOnPhrase(text: string): boolean {
  const hasEmg = text.includes("emg");
  const hasOnVerb =
    text.includes("on") ||
    text.includes("enable") ||
    text.includes("start") ||
    text.includes("activate");
  return hasEmg && hasOnVerb;
}

function isEmgOffPhrase(text: string): boolean {
  const hasEmg = text.includes("emg");
  const hasOffVerb =
    text.includes("off") ||
    text.includes("disable") ||
    text.includes("stop") ||
    text.includes("deactivate");
  return hasEmg && hasOffVerb;
}

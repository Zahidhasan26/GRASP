import { safetyState } from "./device/safety-state";
import { Esp32SerialTransport } from "./device/serial-transport";
import { recommendedGripLevel } from "./domain/thresholds";
import { mountFloatingControls } from "./ui/floating-controls";
import { getBasicChatAnswer } from "./voice/basic-chatbot";
import { resolveVoiceWithGemini, type GeminiVoiceAction } from "./voice/gemini-assistant";
import { parseVoiceCommand } from "./voice/command-parser";

const controls = mountFloatingControls();
const speechRecognition = createSpeechRecognition();
let suppressHardwareStepCommands = false;
let commandQueueToken = 0;
let stepCommandQueue: Promise<void> = Promise.resolve();
let pendingStepCommands = 0;
let emgPollTimer: number | null = null;
let emgTriggerEnabled = false;
const emgHistory: number[] = [];

const emgConnStateEl = document.getElementById("emgConnState");
const emgRawValueEl = document.getElementById("emgRawValue");
const emgThresholdsEl = document.getElementById("emgThresholds");
const emgQueueEl = document.getElementById("emgQueueValue");
const emgPercentEl = document.getElementById("emgPercent");
const emgToggleButton = document.getElementById("emgTriggerToggle");
const emgChartCanvas = document.getElementById("emgChart");

let lastEmgRaw = 0;
let lastEmgEngage = 0;
let lastEmgRelease = 0;

const transport = new Esp32SerialTransport({
  onLine: (line) => {
    handleDeviceLine(line);
  },
  onDisconnect: () => {
    controls.setConnectionState("disconnected");
    setEmgConnectionState("disconnected");
    safetyState.setIdle();
    clearStepCommandQueue();
    stopEmgPolling();
  },
});
controls.setConnectionState("disconnected");
setEmgConnectionState("disconnected");
setEmgQueueDepth(0);
setEmgTriggerEnabled(false);

if (emgToggleButton instanceof HTMLButtonElement) {
  emgToggleButton.addEventListener("click", () => {
    if (!transport.isConnected()) {
      return;
    }
    const nextEnabled = !emgTriggerEnabled;
    setEmgTriggerEnabled(nextEnabled);
    void sendCommandSafe(nextEnabled ? "EMG ON" : "EMG OFF");
  });
}

controls.stopButton.addEventListener("click", () => {
  void runEmergencyStop();
});

controls.voiceButton.addEventListener("click", () => {
  if (!speechRecognition) {
    window.alert("Voice recognition is not available in this browser.");
    return;
  }

  controls.setListening(true);
  speechRecognition.start();
});

controls.connectButton.addEventListener("click", () => {
  if (transport.isConnected()) {
    void disconnectEsp32();
    return;
  }
  void connectEsp32();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    void runEmergencyStop();
  }
});

safetyState.onStop(() => {
  const gripLevel = getGripLevel();
  const minusButton = document.getElementById("gripMinus");
  if (minusButton instanceof HTMLButtonElement) {
    suppressHardwareStepCommands = true;
    try {
      for (let step = 0; step < gripLevel; step += 1) {
        minusButton.click();
      }
    } finally {
      suppressHardwareStepCommands = false;
    }
  }
});

safetyState.onStop(() => {
  clearStepCommandQueue();
  void sendCommandSafe("STOP");
});

const plusButton = document.getElementById("gripPlus");
const minusButton = document.getElementById("gripMinus");

if (plusButton instanceof HTMLButtonElement) {
  plusButton.addEventListener("click", () => {
    safetyState.setActive();
    if (!suppressHardwareStepCommands) {
      queueLevelStepCommand("PLUS");
    }
  });
}

if (minusButton instanceof HTMLButtonElement) {
  minusButton.addEventListener("click", () => {
    window.setTimeout(() => {
      const gripLevel = getGripLevel();
      if (gripLevel <= 0) {
        safetyState.setIdle();
      }
    }, 0);
    if (!suppressHardwareStepCommands) {
      queueLevelStepCommand("MINUS");
    }
  });
}

async function runEmergencyStop(): Promise<void> {
  safetyState.emergencyStop();
  window.dispatchEvent(
    new CustomEvent("grasp:safety-stop", {
      detail: { reason: "manual-stop" },
    }),
  );
}

async function connectEsp32(): Promise<void> {
  controls.setConnectionState("connecting");
  setEmgConnectionState("connecting");
  try {
    clearStepCommandQueue();
    await transport.connect(115200);
    controls.setConnectionState("connected");
    setEmgConnectionState("connected");
    setEmgTriggerEnabled(false);
    await sendCommandSafe("EMG OFF");
    startEmgPolling();
    await sendCommandSafe("STATUS");
    await sendCommandSafe("EMG_STATUS");
  } catch (error) {
    controls.setConnectionState("disconnected");
    setEmgConnectionState("disconnected");
    const message = error instanceof Error ? error.message : "Unknown connection error.";
    window.alert(`ESP32 connection failed: ${message}`);
  }
}

async function disconnectEsp32(): Promise<void> {
  clearStepCommandQueue();
  stopEmgPolling();
  await transport.disconnect();
  controls.setConnectionState("disconnected");
  setEmgConnectionState("disconnected");
}

function handleDeviceLine(line: string): void {
  parseStatusLine(line);

  if (line.startsWith("ERR")) {
    window.dispatchEvent(
      new CustomEvent("grasp:device-error", {
        detail: { line },
      }),
    );
    return;
  }

  if (line.includes("PRESS_START PLUS")) {
    safetyState.setActive();
    return;
  }
  if (line.includes("PRESS_START MINUS")) {
    safetyState.setIdle();
  }
}

async function sendCommandSafe(command: string): Promise<void> {
  if (!transport.isConnected()) {
    return;
  }

  try {
    await transport.send(command);
  } catch {
    controls.setConnectionState("disconnected");
  }
}

function startEmgPolling(): void {
  stopEmgPolling();
  emgPollTimer = window.setInterval(() => {
    void sendCommandSafe("EMG_STATUS");
  }, 600);
}

function stopEmgPolling(): void {
  if (emgPollTimer !== null) {
    window.clearInterval(emgPollTimer);
    emgPollTimer = null;
  }
}

function queueLevelStepCommand(command: "PLUS" | "MINUS"): void {
  if (!transport.isConnected()) {
    return;
  }

  const token = commandQueueToken;
  pendingStepCommands += 1;
  setEmgQueueDepth(pendingStepCommands);
  stepCommandQueue = stepCommandQueue.then(async () => {
    try {
      if (token !== commandQueueToken) {
        return;
      }
      await sendCommandSafe(command);
      await waitMs(3200);
    } finally {
      pendingStepCommands = Math.max(0, pendingStepCommands - 1);
      setEmgQueueDepth(pendingStepCommands);
    }
  });
}

function clearStepCommandQueue(): void {
  commandQueueToken += 1;
  stepCommandQueue = Promise.resolve();
  pendingStepCommands = 0;
  setEmgQueueDepth(0);
}

function waitMs(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function parseStatusLine(line: string): void {
  if (!line.startsWith("STATUS ")) {
    return;
  }

  const raw = extractField(line, "emgRaw");
  const engage = extractField(line, "emgEngage");
  const release = extractField(line, "emgRelease");
  const enabled = extractField(line, "emgEnabled");
  const latched = extractField(line, "emgLatched");

  if (raw !== undefined && emgRawValueEl) {
    emgRawValueEl.textContent = raw;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      lastEmgRaw = parsed;
      emgHistory.push(lastEmgRaw);
      if (emgHistory.length > 140) {
        emgHistory.shift();
      }
      renderEmgChart();
    }
  }
  if (engage !== undefined) {
    const parsed = Number(engage);
    if (Number.isFinite(parsed)) {
      lastEmgEngage = parsed;
    }
  }
  if (release !== undefined) {
    const parsed = Number(release);
    if (Number.isFinite(parsed)) {
      lastEmgRelease = parsed;
    }
  }
  if (emgThresholdsEl) {
    const engageTxt = engage ?? String(lastEmgEngage || "-");
    const releaseTxt = release ?? String(lastEmgRelease || "-");
    emgThresholdsEl.textContent = `${engageTxt} / ${releaseTxt}`;
  }
  if (enabled !== undefined) {
    setEmgTriggerEnabled(enabled === "1");
  }
  if (latched !== undefined && emgConnStateEl) {
    emgConnStateEl.dataset.latch = latched;
  }
  if (emgPercentEl) {
    emgPercentEl.textContent = `${toPercent(lastEmgRaw).toFixed(1)}%`;
  }
  renderEmgChart();
}

function extractField(line: string, fieldName: string): string | undefined {
  const match = new RegExp(`${fieldName}=([^\\s]+)`).exec(line);
  return match?.[1];
}

type TranscriptEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type RecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: TranscriptEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
};

type RecognitionConstructor = new () => RecognitionInstance;

function createSpeechRecognition(): RecognitionInstance | null {
  const RecognitionCtor =
    window.SpeechRecognition ??
    window.webkitSpeechRecognition;

  if (!RecognitionCtor) {
    return null;
  }

  const recognition = new RecognitionCtor();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (event: TranscriptEvent) => {
    const transcript = event.results[0]?.[0]?.transcript ?? "";
    handleVoice(transcript);
  };

  recognition.onend = () => controls.setListening(false);
  recognition.onerror = () => controls.setListening(false);

  return recognition;
}

async function handleVoice(transcript: string): Promise<void> {
  const intent = parseVoiceCommand(transcript);

  switch (intent.type) {
    case "emergency_stop":
      await runEmergencyStop();
      speak("Emergency stop activated.");
      return;

    case "toggle_grip": {
      const button = document.getElementById(intent.on ? "gripPlus" : "gripMinus");
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      button.click();
      speak(intent.on ? "Powering up one level." : "Powering down one level.");
      return;
    }

    case "step_level": {
      const button = document.getElementById(intent.direction === "up" ? "gripPlus" : "gripMinus");
      if (button instanceof HTMLButtonElement) {
        button.click();
        speak(intent.direction === "up" ? "Powering up one level." : "Powering down one level.");
      }
      return;
    }

    case "toggle_emg": {
      if (!transport.isConnected()) {
        speak("Please connect device first.");
        return;
      }
      setEmgTriggerEnabled(intent.enabled);
      await sendCommandSafe(intent.enabled ? "EMG ON" : "EMG OFF");
      speak(intent.enabled ? "EMG trigger enabled." : "EMG trigger disabled.");
      return;
    }

    case "toggle_connection": {
      if (intent.connect) {
        if (transport.isConnected()) {
          speak("Device is already connected.");
        } else {
          await connectEsp32();
          speak("Connection flow opened.");
        }
      } else if (transport.isConnected()) {
        await disconnectEsp32();
        speak("Device disconnected.");
      } else {
        speak("Device is already disconnected.");
      }
      return;
    }

    case "navigate": {
      document.getElementById(intent.panelId)?.scrollIntoView({ behavior: "smooth" });
      speak(`Navigating to ${intent.panelId}.`);
      return;
    }

    case "unknown": {
      const basicAnswer = getBasicChatAnswer(transcript, {
        connected: transport.isConnected(),
        emgEnabled: emgTriggerEnabled,
        level: getGripLevel(),
      });

      if (basicAnswer) {
        speak(basicAnswer);
        return;
      }

      const resolved = await resolveVoiceWithGemini({
        transcript,
        context: {
          connected: transport.isConnected(),
          emgEnabled: emgTriggerEnabled,
          level: getGripLevel(),
        },
      });

      if (!resolved) {
        speak("I could not process that request yet. Please try again or ask a simpler command.");
        return;
      }

      await applyGeminiVoiceAction(resolved.action);
      speak(resolved.response);
      return;
    }
  }
}

async function applyGeminiVoiceAction(action: GeminiVoiceAction): Promise<void> {
  switch (action) {
    case "NONE":
      return;
    case "STOP":
      await runEmergencyStop();
      return;
    case "PLUS":
      (document.getElementById("gripPlus") as HTMLButtonElement | null)?.click();
      return;
    case "MINUS":
      (document.getElementById("gripMinus") as HTMLButtonElement | null)?.click();
      return;
    case "EMG_ON":
      if (transport.isConnected()) {
        setEmgTriggerEnabled(true);
        await sendCommandSafe("EMG ON");
      }
      return;
    case "EMG_OFF":
      if (transport.isConnected()) {
        setEmgTriggerEnabled(false);
        await sendCommandSafe("EMG OFF");
      }
      return;
    case "CONNECT":
      if (!transport.isConnected()) {
        await connectEsp32();
      }
      return;
    case "DISCONNECT":
      if (transport.isConnected()) {
        await disconnectEsp32();
      }
      return;
    case "NAVIGATE_HOME":
      document.getElementById("home")?.scrollIntoView({ behavior: "smooth" });
      return;
    case "NAVIGATE_STIMULATION":
      document.getElementById("stimulation")?.scrollIntoView({ behavior: "smooth" });
      return;
    case "NAVIGATE_DIAGNOSTIC":
      document.getElementById("diagnostic")?.scrollIntoView({ behavior: "smooth" });
      return;
    case "NAVIGATE_GRIPAID":
      document.getElementById("gripaid")?.scrollIntoView({ behavior: "smooth" });
      return;
  }
}

function speak(text: string): void {
  const message = text.trim();
  if (!message || !("speechSynthesis" in window)) {
    return;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
}

export function getLiveSummary(): string {
  const sensory = Number(getSelectedThreshold("sensory"));
  const motor = Number(getSelectedThreshold("motor"));
  const tolerance = Number(getSelectedThreshold("tolerance"));
  const gripLevel = recommendedGripLevel({ sensory, motor, tolerance });

  return `Thresholds s:${sensory} m:${motor} t:${tolerance}; target grip level ${gripLevel}.`;
}

function getSelectedThreshold(name: "sensory" | "motor" | "tolerance"): string {
  const row = document.querySelector(`.threshold[data-key="${name}"]`);
  const selected = row?.querySelector<HTMLElement>('.seg[aria-selected="true"]');
  return selected?.textContent ?? "0";
}

function getGripLevel(): number {
  const levelText = document.getElementById("gripLevel")?.textContent ?? "0";
  const parsed = Number(levelText);
  return Number.isFinite(parsed) ? parsed : 0;
}

function setEmgConnectionState(state: "disconnected" | "connecting" | "connected"): void {
  if (!emgConnStateEl) {
    return;
  }
  emgConnStateEl.textContent = state;
}

function setEmgQueueDepth(depth: number): void {
  if (!emgQueueEl) {
    return;
  }
  emgQueueEl.textContent = String(depth);
}

function setEmgTriggerEnabled(enabled: boolean): void {
  emgTriggerEnabled = enabled;
  if (!(emgToggleButton instanceof HTMLButtonElement)) {
    return;
  }
  emgToggleButton.classList.toggle("on", enabled);
  emgToggleButton.classList.toggle("off", !enabled);
  emgToggleButton.textContent = enabled ? "Disable EMG Trigger" : "Enable EMG Trigger";
}

function toPercent(value: number): number {
  const clamped = Math.max(0, Math.min(4095, value));
  return (clamped / 4095) * 100;
}

function renderEmgChart(): void {
  if (!(emgChartCanvas instanceof HTMLCanvasElement)) {
    return;
  }

  const ctx = emgChartCanvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const width = emgChartCanvas.width;
  const height = emgChartCanvas.height;
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(120,120,120,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.5);
  ctx.lineTo(width, height * 0.5);
  ctx.stroke();

  const engageY = height - (Math.max(0, Math.min(4095, lastEmgEngage)) / 4095) * height;
  const releaseY = height - (Math.max(0, Math.min(4095, lastEmgRelease)) / 4095) * height;
  ctx.strokeStyle = "rgba(245,158,11,0.9)";
  ctx.beginPath();
  ctx.moveTo(0, engageY);
  ctx.lineTo(width, engageY);
  ctx.stroke();
  ctx.strokeStyle = "rgba(59,130,246,0.9)";
  ctx.beginPath();
  ctx.moveTo(0, releaseY);
  ctx.lineTo(width, releaseY);
  ctx.stroke();

  if (emgHistory.length < 2) {
    return;
  }
  const stepX = width / Math.max(1, emgHistory.length - 1);
  ctx.strokeStyle = "rgba(16,185,129,0.95)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let i = 0; i < emgHistory.length; i += 1) {
    const x = i * stepX;
    const y = height - (Math.max(0, Math.min(4095, emgHistory[i] ?? 0)) / 4095) * height;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

declare global {
  interface Window {
    webkitSpeechRecognition?: RecognitionConstructor;
    SpeechRecognition?: RecognitionConstructor;
  }
}

import { safetyState } from "./device/safety-state";
import { Esp32SerialTransport } from "./device/serial-transport";
import { recommendedGripLevel } from "./domain/thresholds";
import { mountFloatingControls } from "./ui/floating-controls";
import { mountStatusPanel } from "./ui/status-panel";
import { parseVoiceCommand } from "./voice/command-parser";

const controls = mountFloatingControls();
const statusPanel = mountStatusPanel();
const speechRecognition = createSpeechRecognition();
let suppressHardwareStepCommands = false;
let commandQueueToken = 0;
let stepCommandQueue: Promise<void> = Promise.resolve();
let pendingStepCommands = 0;
let emgPollTimer: number | null = null;
const transport = new Esp32SerialTransport({
  onLine: (line) => {
    handleDeviceLine(line);
  },
  onDisconnect: () => {
    controls.setConnectionState("disconnected");
    statusPanel.setConnectionState("disconnected");
    safetyState.setIdle();
    clearStepCommandQueue();
    stopEmgPolling();
  },
});
controls.setConnectionState("disconnected");
statusPanel.setConnectionState("disconnected");
statusPanel.setQueueDepth(0);

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
  statusPanel.setConnectionState("connecting");
  try {
    clearStepCommandQueue();
    await transport.connect(115200);
    controls.setConnectionState("connected");
    statusPanel.setConnectionState("connected");
    statusPanel.appendLine("EVT WEB_CONNECTED");
    startEmgPolling();
    await sendCommandSafe("STATUS");
    await sendCommandSafe("EMG_STATUS");
  } catch (error) {
    controls.setConnectionState("disconnected");
    statusPanel.setConnectionState("disconnected");
    const message = error instanceof Error ? error.message : "Unknown connection error.";
    window.alert(`ESP32 connection failed: ${message}`);
  }
}

async function disconnectEsp32(): Promise<void> {
  clearStepCommandQueue();
  stopEmgPolling();
  await transport.disconnect();
  controls.setConnectionState("disconnected");
  statusPanel.setConnectionState("disconnected");
}

function handleDeviceLine(line: string): void {
  statusPanel.appendLine(line);
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
  statusPanel.setLastCommand(command);
  if (!transport.isConnected()) {
    statusPanel.appendLine(`WARN not connected: ${command}`);
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
  statusPanel.setQueueDepth(pendingStepCommands);
  stepCommandQueue = stepCommandQueue.then(async () => {
    try {
      if (token !== commandQueueToken) {
        return;
      }
      await sendCommandSafe(command);
      await waitMs(3200);
    } finally {
      pendingStepCommands = Math.max(0, pendingStepCommands - 1);
      statusPanel.setQueueDepth(pendingStepCommands);
    }
  });
}

function clearStepCommandQueue(): void {
  commandQueueToken += 1;
  stepCommandQueue = Promise.resolve();
  pendingStepCommands = 0;
  statusPanel.setQueueDepth(0);
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

  statusPanel.setEmg({ raw, engage, release, enabled, latched });
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

function handleVoice(transcript: string): void {
  const intent = parseVoiceCommand(transcript);

  switch (intent.type) {
    case "emergency_stop":
      runEmergencyStop();
      return;

    case "toggle_grip": {
      const button = document.getElementById(intent.on ? "gripPlus" : "gripMinus");
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      button.click();
      return;
    }

    case "navigate": {
      document.getElementById(intent.panelId)?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    case "unknown":
      return;
  }
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

declare global {
  interface Window {
    webkitSpeechRecognition?: RecognitionConstructor;
    SpeechRecognition?: RecognitionConstructor;
  }
}

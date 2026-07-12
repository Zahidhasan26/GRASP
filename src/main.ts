import { safetyState } from "./device/safety-state";
import { recommendedGripLevel } from "./domain/thresholds";
import { mountFloatingControls } from "./ui/floating-controls";
import { parseVoiceCommand } from "./voice/command-parser";

const controls = mountFloatingControls();
const speechRecognition = createSpeechRecognition();

controls.stopButton.addEventListener("click", () => {
  runEmergencyStop();
});

controls.voiceButton.addEventListener("click", () => {
  if (!speechRecognition) {
    window.alert("Voice recognition is not available in this browser.");
    return;
  }

  controls.setListening(true);
  speechRecognition.start();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    runEmergencyStop();
  }
});

safetyState.onStop(() => {
  const switchEl = document.getElementById("switch");
  const isOn = switchEl?.getAttribute("aria-checked") === "true";
  if (isOn) {
    switchEl?.dispatchEvent(new Event("click"));
  }
});

function runEmergencyStop(): void {
  safetyState.emergencyStop();
  window.dispatchEvent(
    new CustomEvent("grasp:safety-stop", {
      detail: { reason: "manual-stop" },
    }),
  );
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
      const switchEl = document.getElementById("switch");
      if (!(switchEl instanceof HTMLButtonElement)) {
        return;
      }

      const checked = switchEl.getAttribute("aria-checked") === "true";
      if (checked !== intent.on) {
        switchEl.click();
      }
      if (intent.on) {
        safetyState.setActive();
      } else {
        safetyState.setIdle();
      }
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

declare global {
  interface Window {
    webkitSpeechRecognition?: RecognitionConstructor;
    SpeechRecognition?: RecognitionConstructor;
  }
}

type ChatContext = {
  connected: boolean;
  emgEnabled: boolean;
  level: number;
};

export function getBasicChatAnswer(input: string, context: ChatContext): string | null {
  const text = input.trim().toLowerCase();

  if (matchesAny(text, ["who are you", "what are you", "who r u"])) {
    return "I am your G R A S P voice assistant. I can help with control commands and answer basic questions about this setup.";
  }

  if (matchesAny(text, ["what can you do", "help", "commands"])) {
    return "I can connect the device, power up or down, enable or disable EMG trigger, navigate pages, and answer basic questions.";
  }

  if (matchesAny(text, ["status", "current status", "how are we doing"])) {
    return `Device is ${context.connected ? "connected" : "disconnected"}, EMG trigger is ${context.emgEnabled ? "enabled" : "disabled"}, and level is ${context.level}.`;
  }

  if (matchesAny(text, ["what is emg", "what does emg do"])) {
    return "EMG trigger uses muscle activity to automatically send power up and power down actions based on your thresholds.";
  }

  if (matchesAny(text, ["threshold", "emg threshold"])) {
    return "EMG engage happens above the engage threshold and release happens below the release threshold.";
  }

  if (matchesAny(text, ["who made you", "who built you"])) {
    return "I am built into this G R A S P project as your on-device voice control and assistant layer.";
  }

  return null;
}

function matchesAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

export type GeminiVoiceAction =
  | "NONE"
  | "STOP"
  | "PLUS"
  | "MINUS"
  | "EMG_ON"
  | "EMG_OFF"
  | "CONNECT"
  | "DISCONNECT"
  | "NAVIGATE_HOME"
  | "NAVIGATE_STIMULATION"
  | "NAVIGATE_DIAGNOSTIC"
  | "NAVIGATE_GRIPAID";

export type GeminiVoiceResult = {
  action: GeminiVoiceAction;
  response: string;
};

type GeminiVoiceRequest = {
  transcript: string;
  context: {
    connected: boolean;
    emgEnabled: boolean;
    level: number;
  };
};

export async function resolveVoiceWithGemini(
  payload: GeminiVoiceRequest,
): Promise<GeminiVoiceResult | null> {
  const response = await fetch("/api/voice/gemini", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as Partial<GeminiVoiceResult>;
  if (!data.action || !data.response) {
    return null;
  }

  return {
    action: data.action as GeminiVoiceAction,
    response: data.response,
  };
}

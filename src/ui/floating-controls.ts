type FloatingControls = {
  stopButton: HTMLButtonElement;
  voiceButton: HTMLButtonElement;
  setListening: (listening: boolean) => void;
};

export function mountFloatingControls(): FloatingControls {
  injectStyles();

  const stopButton = document.createElement("button");
  stopButton.id = "grasp-stop-btn";
  stopButton.type = "button";
  stopButton.textContent = "STOP";
  stopButton.setAttribute("aria-label", "Emergency stop");

  const voiceButton = document.createElement("button");
  voiceButton.id = "grasp-voice-btn";
  voiceButton.type = "button";
  voiceButton.textContent = "Voice";
  voiceButton.setAttribute("aria-label", "Voice command");

  document.body.append(stopButton, voiceButton);

  return {
    stopButton,
    voiceButton,
    setListening: (listening) => {
      voiceButton.classList.toggle("listening", listening);
      voiceButton.textContent = listening ? "Listening…" : "Voice";
    },
  };
}

function injectStyles(): void {
  if (document.getElementById("grasp-floating-controls-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "grasp-floating-controls-style";
  style.textContent = `
    #grasp-stop-btn,
    #grasp-voice-btn {
      position: fixed;
      right: 24px;
      z-index: 999;
      border: 0;
      border-radius: 999px;
      padding: 12px 18px;
      font-family: "Poppins", system-ui, sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
      cursor: pointer;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
    }

    #grasp-stop-btn {
      bottom: 86px;
      color: white;
      background: linear-gradient(135deg, #ef4444, #b91c1c);
    }

    #grasp-voice-btn {
      bottom: 24px;
      color: #151312;
      background: linear-gradient(135deg, #fff, #f3f3f3);
    }

    #grasp-voice-btn.listening {
      color: white;
      background: linear-gradient(135deg, #f97316, #c2410c);
    }
  `;

  document.head.appendChild(style);
}

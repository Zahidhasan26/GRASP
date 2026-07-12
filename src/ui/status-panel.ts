type ConnectionState = "disconnected" | "connecting" | "connected";

type EmgSnapshot = {
  enabled?: string;
  latched?: string;
  raw?: string;
  engage?: string;
  release?: string;
};

export type StatusPanel = {
  setConnectionState: (state: ConnectionState) => void;
  setQueueDepth: (depth: number) => void;
  setLastCommand: (command: string) => void;
  setEmgTriggerEnabled: (enabled: boolean) => void;
  setEmg: (snapshot: EmgSnapshot) => void;
  appendLine: (line: string) => void;
};

type StatusPanelOptions = {
  onToggleEmgTrigger?: (nextEnabled: boolean) => void;
};

export function mountStatusPanel(options: StatusPanelOptions = {}): StatusPanel {
  injectStyles();

  const panel = document.createElement("aside");
  panel.id = "grasp-status-panel";
  panel.innerHTML = `
    <div class="gsp-head">Live Device Debug</div>
    <div class="gsp-grid">
      <span>Conn</span><span id="gsp-conn">disconnected</span>
      <span>Queue</span><span id="gsp-queue">0</span>
      <span>Last Cmd</span><span id="gsp-cmd">-</span>
      <span>EMG Raw</span><span id="gsp-emg-raw">-</span>
      <span>EMG Thresh</span><span id="gsp-emg-thresh">- / -</span>
      <span>EMG Mode</span><span id="gsp-emg-mode">-</span>
    </div>
    <div class="gsp-emg-wrap">
      <div class="gsp-emg-head">
        <span>EMG Signal</span>
        <span id="gsp-emg-pct">-</span>
      </div>
      <div class="gsp-emg-track">
        <div id="gsp-emg-fill"></div>
        <div id="gsp-emg-engage" class="gsp-emg-mark engage"></div>
        <div id="gsp-emg-release" class="gsp-emg-mark release"></div>
      </div>
      <div class="gsp-emg-legend">
        <span>0</span><span>2048</span><span>4095</span>
      </div>
      <canvas id="gsp-emg-chart" width="336" height="86" aria-label="Live EMG chart"></canvas>
      <button id="gsp-emg-toggle" type="button" class="gsp-emg-toggle off">Enable EMG Trigger</button>
    </div>
    <div class="gsp-log-title">Serial Log</div>
    <pre id="gsp-log"></pre>
  `;
  document.body.appendChild(panel);

  const connEl = panel.querySelector<HTMLElement>("#gsp-conn");
  const queueEl = panel.querySelector<HTMLElement>("#gsp-queue");
  const cmdEl = panel.querySelector<HTMLElement>("#gsp-cmd");
  const emgRawEl = panel.querySelector<HTMLElement>("#gsp-emg-raw");
  const emgThreshEl = panel.querySelector<HTMLElement>("#gsp-emg-thresh");
  const emgModeEl = panel.querySelector<HTMLElement>("#gsp-emg-mode");
  const emgPctEl = panel.querySelector<HTMLElement>("#gsp-emg-pct");
  const emgFillEl = panel.querySelector<HTMLElement>("#gsp-emg-fill");
  const emgEngageEl = panel.querySelector<HTMLElement>("#gsp-emg-engage");
  const emgReleaseEl = panel.querySelector<HTMLElement>("#gsp-emg-release");
  const emgChartEl = panel.querySelector<HTMLCanvasElement>("#gsp-emg-chart");
  const emgToggleEl = panel.querySelector<HTMLButtonElement>("#gsp-emg-toggle");
  const logEl = panel.querySelector<HTMLElement>("#gsp-log");
  const lines: string[] = [];
  const emgHistory: number[] = [];
  let lastRaw = 0;
  let lastEngage = 0;
  let lastRelease = 0;
  let emgTriggerEnabled = false;

  emgToggleEl?.addEventListener("click", () => {
    const next = !emgTriggerEnabled;
    options.onToggleEmgTrigger?.(next);
  });

  return {
    setConnectionState: (state) => {
      if (!connEl) return;
      connEl.textContent = state;
      connEl.dataset.state = state;
    },
    setQueueDepth: (depth) => {
      if (!queueEl) return;
      queueEl.textContent = String(depth);
    },
    setLastCommand: (command) => {
      if (!cmdEl) return;
      cmdEl.textContent = command;
    },
    setEmgTriggerEnabled: (enabled) => {
      emgTriggerEnabled = enabled;
      if (!emgToggleEl) {
        return;
      }
      emgToggleEl.classList.toggle("on", enabled);
      emgToggleEl.classList.toggle("off", !enabled);
      emgToggleEl.textContent = enabled ? "Disable EMG Trigger" : "Enable EMG Trigger";
    },
    setEmg: (snapshot) => {
      if (emgRawEl && snapshot.raw !== undefined) {
        emgRawEl.textContent = snapshot.raw;
        const parsedRaw = parseNumber(snapshot.raw);
        if (parsedRaw !== null) {
          lastRaw = parsedRaw;
        }
      }
      if (emgThreshEl && (snapshot.engage !== undefined || snapshot.release !== undefined)) {
        const engage = snapshot.engage ?? emgThreshEl.textContent?.split("/")[0]?.trim() ?? "-";
        const release = snapshot.release ?? emgThreshEl.textContent?.split("/")[1]?.trim() ?? "-";
        emgThreshEl.textContent = `${engage} / ${release}`;
        const parsedEngage = parseNumber(snapshot.engage);
        const parsedRelease = parseNumber(snapshot.release);
        if (parsedEngage !== null) {
          lastEngage = parsedEngage;
        }
        if (parsedRelease !== null) {
          lastRelease = parsedRelease;
        }
      }
      if (emgModeEl && (snapshot.enabled !== undefined || snapshot.latched !== undefined)) {
        const enabled = snapshot.enabled === "1" ? "on" : snapshot.enabled === "0" ? "off" : "?";
        const latched = snapshot.latched === "1" ? "latched" : snapshot.latched === "0" ? "released" : "?";
        emgModeEl.textContent = `${enabled}, ${latched}`;
      }
      if (snapshot.enabled !== undefined) {
        emgTriggerEnabled = snapshot.enabled === "1";
      }
      const rawPct = asPercent(lastRaw);
      if (emgFillEl) {
        emgFillEl.style.width = `${rawPct}%`;
      }
      if (emgPctEl) {
        emgPctEl.textContent = `${rawPct.toFixed(1)}%`;
      }
      if (emgEngageEl) {
        emgEngageEl.style.left = `${asPercent(lastEngage)}%`;
      }
      if (emgReleaseEl) {
        emgReleaseEl.style.left = `${asPercent(lastRelease)}%`;
      }
      if (emgToggleEl) {
        emgToggleEl.classList.toggle("on", emgTriggerEnabled);
        emgToggleEl.classList.toggle("off", !emgTriggerEnabled);
        emgToggleEl.textContent = emgTriggerEnabled ? "Disable EMG Trigger" : "Enable EMG Trigger";
      }

      emgHistory.push(lastRaw);
      if (emgHistory.length > 120) {
        emgHistory.shift();
      }
      drawEmgChart(emgChartEl, emgHistory, lastEngage, lastRelease);
    },
    appendLine: (line) => {
      if (!logEl) return;
      lines.push(`${new Date().toLocaleTimeString()}  ${line}`);
      if (lines.length > 14) {
        lines.shift();
      }
      logEl.textContent = lines.join("\n");
    },
  };
}

function injectStyles(): void {
  if (document.getElementById("grasp-status-panel-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "grasp-status-panel-style";
  style.textContent = `
    #grasp-status-panel {
      position: fixed;
      left: 20px;
      bottom: 24px;
      width: min(380px, 88vw);
      z-index: 980;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(11,11,12,0.86);
      color: #f0f0f0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      padding: 10px 12px;
      backdrop-filter: blur(8px);
      box-shadow: 0 10px 28px rgba(0,0,0,0.35);
    }
    .gsp-head {
      font-size: 11px;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: #f97316;
      margin-bottom: 8px;
    }
    .gsp-grid {
      display: grid;
      grid-template-columns: 86px 1fr;
      gap: 4px 8px;
      font-size: 11px;
      margin-bottom: 8px;
    }
    .gsp-grid > span:nth-child(odd) { color: #c7c7c7; }
    .gsp-grid > span:nth-child(even) { color: #ffffff; }
    #gsp-conn[data-state="connected"] { color: #4ade80; }
    #gsp-conn[data-state="connecting"] { color: #fbbf24; }
    #gsp-conn[data-state="disconnected"] { color: #f87171; }
    .gsp-log-title {
      font-size: 10px;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: #c7c7c7;
      margin-bottom: 4px;
      margin-top: 8px;
    }
    .gsp-emg-wrap { margin-bottom: 2px; }
    .gsp-emg-head {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #d4d4d4;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: .06em;
    }
    .gsp-emg-track {
      position: relative;
      width: 100%;
      height: 12px;
      border-radius: 999px;
      background: rgba(255,255,255,0.12);
      overflow: hidden;
    }
    #gsp-emg-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #22c55e, #f97316);
      transition: width .15s linear;
    }
    .gsp-emg-mark {
      position: absolute;
      top: -2px;
      width: 2px;
      height: 16px;
      transform: translateX(-50%);
      opacity: .95;
      pointer-events: none;
    }
    .gsp-emg-mark.engage { background: #f59e0b; }
    .gsp-emg-mark.release { background: #38bdf8; }
    .gsp-emg-legend {
      margin-top: 3px;
      font-size: 9px;
      color: #b8b8b8;
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    #gsp-emg-chart {
      width: 100%;
      height: 86px;
      border-radius: 8px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.09);
      display: block;
      margin-bottom: 6px;
    }
    .gsp-emg-toggle {
      width: 100%;
      border: 0;
      border-radius: 8px;
      padding: 8px 10px;
      cursor: pointer;
      font-size: 11px;
      font-family: inherit;
      font-weight: 700;
      letter-spacing: .03em;
      margin-bottom: 2px;
    }
    .gsp-emg-toggle.on {
      color: #fefefe;
      background: linear-gradient(135deg, #b91c1c, #7f1d1d);
    }
    .gsp-emg-toggle.off {
      color: #111827;
      background: linear-gradient(135deg, #34d399, #10b981);
    }
    #gsp-log {
      margin: 0;
      max-height: 180px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 10px;
      line-height: 1.35;
      color: #eaeaea;
    }
    @media (max-width: 780px) {
      #grasp-status-panel {
        bottom: 88px;
      }
    }
  `;
  document.head.appendChild(style);
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asPercent(value: number): number {
  const clamped = Math.max(0, Math.min(4095, value));
  return (clamped / 4095) * 100;
}

function drawEmgChart(
  canvas: HTMLCanvasElement | null,
  values: number[],
  engage: number,
  release: number,
): void {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  // Baseline grid.
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.5);
  ctx.lineTo(width, height * 0.5);
  ctx.stroke();

  // Threshold lines.
  const engageY = height - (Math.max(0, Math.min(4095, engage)) / 4095) * height;
  const releaseY = height - (Math.max(0, Math.min(4095, release)) / 4095) * height;
  ctx.strokeStyle = "rgba(245, 158, 11, 0.85)";
  ctx.beginPath();
  ctx.moveTo(0, engageY);
  ctx.lineTo(width, engageY);
  ctx.stroke();

  ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
  ctx.beginPath();
  ctx.moveTo(0, releaseY);
  ctx.lineTo(width, releaseY);
  ctx.stroke();

  if (values.length < 2) {
    return;
  }

  ctx.strokeStyle = "rgba(34, 197, 94, 0.95)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  const stepX = width / Math.max(1, values.length - 1);
  for (let i = 0; i < values.length; i += 1) {
    const raw = Math.max(0, Math.min(4095, values[i] ?? 0));
    const x = i * stepX;
    const y = height - (raw / 4095) * height;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

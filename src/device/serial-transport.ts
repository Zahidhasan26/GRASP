type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
};

type SerialLike = {
  requestPort: () => Promise<SerialPortLike>;
};

type SerialTransportOptions = {
  onLine?: (line: string) => void;
  onDisconnect?: () => void;
};

export class Esp32SerialTransport {
  private readonly options: SerialTransportOptions;
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private closedByApp = false;

  constructor(options: SerialTransportOptions = {}) {
    this.options = options;
  }

  async connect(baudRate = 115200): Promise<void> {
    if (!navigator.serial) {
      throw new Error("Web Serial is not supported in this browser.");
    }
    if (this.port) {
      return;
    }

    this.closedByApp = false;
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate });

    if (!this.port.readable || !this.port.writable) {
      throw new Error("Serial port did not expose readable/writable streams.");
    }

    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    void this.readLoop();
  }

  async disconnect(): Promise<void> {
    this.closedByApp = true;

    if (this.reader) {
      await this.reader.cancel();
      this.reader.releaseLock();
      this.reader = null;
    }

    if (this.writer) {
      this.writer.releaseLock();
      this.writer = null;
    }

    if (this.port) {
      await this.port.close();
      this.port = null;
    }
  }

  isConnected(): boolean {
    return this.port !== null && this.writer !== null && this.reader !== null;
  }

  async send(command: string): Promise<void> {
    if (!this.writer) {
      throw new Error("Not connected to ESP32.");
    }
    const payload = new TextEncoder().encode(`${command}\n`);
    await this.writer.write(payload);
  }

  private async readLoop(): Promise<void> {
    if (!this.reader) {
      return;
    }

    const decoder = new TextDecoder();
    let buffered = "";

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }
        if (!value) {
          continue;
        }

        buffered += decoder.decode(value, { stream: true });
        let newlineIndex = buffered.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffered.slice(0, newlineIndex).replace(/\r/g, "").trim();
          buffered = buffered.slice(newlineIndex + 1);
          if (line.length > 0) {
            this.options.onLine?.(line);
          }
          newlineIndex = buffered.indexOf("\n");
        }
      }
    } catch {
      // Reader is canceled during normal disconnect flow.
    } finally {
      if (!this.closedByApp) {
        this.options.onDisconnect?.();
      }
    }
  }
}

declare global {
  interface Navigator {
    serial?: SerialLike;
  }
}

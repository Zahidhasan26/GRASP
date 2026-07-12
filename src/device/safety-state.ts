type SafetyStatus = "idle" | "active" | "stopped";

class SafetyState {
  private status: SafetyStatus = "idle";
  private stopListeners: Array<() => void> = [];

  setActive(): void {
    if (this.status !== "stopped") {
      this.status = "active";
    }
  }

  setIdle(): void {
    if (this.status !== "stopped") {
      this.status = "idle";
    }
  }

  emergencyStop(): void {
    this.status = "stopped";
    this.stopListeners.forEach((listener) => listener());
  }

  onStop(listener: () => void): void {
    this.stopListeners.push(listener);
  }

  getStatus(): SafetyStatus {
    return this.status;
  }
}

export const safetyState = new SafetyState();

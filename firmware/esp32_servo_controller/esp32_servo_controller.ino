/*
  G.R.A.S.P. ESP32 Servo Controller (Professionalized)
  ----------------------------------------------------
  Board: ESP32 Dev Module / TTGO T-Display
  Library: ESP32Servo

  Purpose:
    - Single seesaw servo: press + or - on command.
    - Button A = + press, Button B = - press.
    - One logical level step = 2 physical presses with 1s interval.
    - Keep servo detached while idle (less jitter/heat).
    - Use non-blocking state machine (no long delay() locks).
    - Provide structured serial protocol for direct PC/web integration.

  Wiring:
    Servo red    -> 5V external rail (NOT ESP32 USB 5V for high load)
    Servo brown  -> GND (shared with ESP32 GND)
    Servo orange -> GPIO 27
    MyoWare ENV  -> GPIO 32 (ADC input, change if your board differs)
    MyoWare GND  -> GND
    MyoWare VCC  -> 3.3V

  Buttons:
    GPIO 0  -> onboard button A (INPUT_PULLUP, active LOW)
    GPIO 35 -> onboard button B (input-only, board pull-up, active LOW)

  Serial @ 115200 (newline terminated commands):
    PLUS   (or: A, PRESS A, +)
    MINUS  (or: B, PRESS B, -)
    STOP
    STATUS
    ANGLES <a> <neutral> <b>     e.g. ANGLES 15 30 45
    TIMING <moveMs> <holdMs>     e.g. TIMING 300 400
    EMG ON | EMG OFF
    EMG_THRESH <engage> <release>  e.g. EMG_THRESH 1850 1450
    EMG_STATUS
    PING

  Note:
    - Each PLUS/MINUS command performs a full level step:
      two physical presses separated by 1000ms.
    - EMG triggering starts disabled until EMG ON is sent.

  Responses:
    OK <message>
    ERR <reason>
    EVT PRESS_START <PLUS|MINUS>
    EVT PRESS_DONE <PLUS|MINUS>
    STATUS <state payload>
*/

#include <ESP32Servo.h>

// ---------------- Pins ----------------
static const int SERVO_PIN = 27;
static const int BTN_A_PIN = 0;
static const int BTN_B_PIN = 35;
// Use an exposed ADC-capable pin on your board.
// Good options: 32, 33, 36, 39 (input-only on some boards).
static const int EMG_ENV_PIN = 32;

// ---------------- Servo config ----------------
static const int SERVO_MIN_US = 500;
static const int SERVO_MAX_US = 2400;
static const int SAFE_MIN_ANGLE = 0;
static const int SAFE_MAX_ANGLE = 180;

// Startup defaults (can be changed at runtime via serial).
// plusAngle/minusAngle map to seesaw directions for + / - buttons.
int plusAngle = 15;
int neutralAngle = 30;
int minusAngle = 45;
unsigned long moveMs = 300;
unsigned long holdMs = 400;

// ---------------- Button debounce ----------------
static const unsigned long DEBOUNCE_MS = 35;
static const uint8_t PRESSES_PER_LEVEL = 2;
static const unsigned long INTER_PRESS_INTERVAL_MS = 1000;

// ---------------- EMG trigger ----------------
bool emgEnabled = false; // explicit opt-in from UI button.
bool emgLatched = false; // true = engaged/holding state
int emgEngageThreshold = 3000;   // engage when raw >= 3000
int emgReleaseThreshold = 2000;  // release when raw <= 2000
int emgRaw = 0;
unsigned long lastEmgSampleMs = 0;
unsigned long lastEmgEdgeMs = 0;
static const unsigned long EMG_SAMPLE_MS = 10;
static const unsigned long EMG_MIN_EDGE_GAP_MS = 220;
uint8_t emgAboveCount = 0;
uint8_t emgBelowCount = 0;
static const uint8_t EMG_CONSECUTIVE_REQUIRED = 3;

// ---------------- Motion state machine ----------------
enum MotionState {
  IDLE = 0,
  MOVING_TO_TARGET,
  HOLDING_TARGET,
  RETURNING_NEUTRAL,
  WAITING_NEXT_PRESS
};

Servo servo;
MotionState motionState = IDLE;
char activeAction = 'I'; // I=idle, P=plus, M=minus
int targetAngle = 0;
unsigned long phaseStartMs = 0;
bool servoAttached = false;
uint8_t pressesRemainingInStep = 0;
char stepAction = 'I';
int stepAngle = 0;

// ---------------- Serial command buffer ----------------
static const size_t CMD_BUF_SIZE = 80;
char cmdBuf[CMD_BUF_SIZE];
size_t cmdLen = 0;

// ---------------- Button edge tracking ----------------
struct ButtonDebounce {
  bool stablePressed;
  bool lastRawPressed;
  unsigned long lastChangeMs;
};

ButtonDebounce btnA = { false, false, 0 };
ButtonDebounce btnB = { false, false, 0 };

// ---------------- Helpers ----------------
int clampInt(int value, int minV, int maxV) {
  if (value < minV) return minV;
  if (value > maxV) return maxV;
  return value;
}

void attachServoIfNeeded() {
  if (!servoAttached) {
    servo.attach(SERVO_PIN, SERVO_MIN_US, SERVO_MAX_US);
    servoAttached = true;
  }
}

void detachServoIfNeeded() {
  if (servoAttached) {
    servo.detach();
    servoAttached = false;
  }
}

void writeServoSafe(int angle) {
  int safeAngle = clampInt(angle, SAFE_MIN_ANGLE, SAFE_MAX_ANGLE);
  servo.write(safeAngle);
}

void printStatus() {
  Serial.print("STATUS state=");
  Serial.print((int)motionState);
  Serial.print(" activeAction=");
  Serial.print(activeAction);
  Serial.print(" plusAngle=");
  Serial.print(plusAngle);
  Serial.print(" neutral=");
  Serial.print(neutralAngle);
  Serial.print(" minusAngle=");
  Serial.print(minusAngle);
  Serial.print(" moveMs=");
  Serial.print(moveMs);
  Serial.print(" holdMs=");
  Serial.print(holdMs);
  Serial.print(" pressesPerLevel=");
  Serial.print(PRESSES_PER_LEVEL);
  Serial.print(" interPressIntervalMs=");
  Serial.print(INTER_PRESS_INTERVAL_MS);
  Serial.print(" attached=");
  Serial.println(servoAttached ? "1" : "0");

  Serial.print("STATUS emgEnabled=");
  Serial.print(emgEnabled ? "1" : "0");
  Serial.print(" emgLatched=");
  Serial.print(emgLatched ? "1" : "0");
  Serial.print(" emgRaw=");
  Serial.print(emgRaw);
  Serial.print(" emgEngage=");
  Serial.print(emgEngageThreshold);
  Serial.print(" emgRelease=");
  Serial.println(emgReleaseThreshold);
}

const char *actionLabel(char actionCode) {
  if (actionCode == 'P') return "PLUS";
  if (actionCode == 'M') return "MINUS";
  return "UNKNOWN";
}

bool startPress(char actionCode, int angle) {
  if (motionState != IDLE || pressesRemainingInStep > 0) {
    Serial.println("ERR busy");
    return false;
  }

  stepAction = actionCode;
  stepAngle = clampInt(angle, SAFE_MIN_ANGLE, SAFE_MAX_ANGLE);
  pressesRemainingInStep = PRESSES_PER_LEVEL;
  Serial.print("EVT STEP_START ");
  Serial.println(actionLabel(stepAction));
  return true;
}

bool startPhysicalPress(char actionCode, int angle) {
  activeAction = actionCode;
  targetAngle = clampInt(angle, SAFE_MIN_ANGLE, SAFE_MAX_ANGLE);

  attachServoIfNeeded();
  writeServoSafe(targetAngle);
  phaseStartMs = millis();
  motionState = MOVING_TO_TARGET;

  Serial.print("EVT PRESS_START ");
  Serial.println(actionLabel(activeAction));
  return true;
}

void emergencyStop() {
  motionState = IDLE;
  activeAction = 'I';
  stepAction = 'I';
  pressesRemainingInStep = 0;
  targetAngle = neutralAngle;

  attachServoIfNeeded();
  writeServoSafe(neutralAngle);
  delay(20); // short settle pulse before detach
  detachServoIfNeeded();

  Serial.println("OK stopped");
}

void updateMotion() {
  unsigned long now = millis();

  switch (motionState) {
    case IDLE:
      if (pressesRemainingInStep > 0) {
        startPhysicalPress(stepAction, stepAngle);
        pressesRemainingInStep--;
        break;
      }
      stepAction = 'I';
      stepAngle = 0;
      // Keep detached while idle.
      detachServoIfNeeded();
      break;

    case MOVING_TO_TARGET:
      if (now - phaseStartMs >= moveMs) {
        motionState = HOLDING_TARGET;
        phaseStartMs = now;
      }
      break;

    case HOLDING_TARGET:
      if (now - phaseStartMs >= holdMs) {
        writeServoSafe(neutralAngle);
        motionState = RETURNING_NEUTRAL;
        phaseStartMs = now;
      }
      break;

    case RETURNING_NEUTRAL:
      if (now - phaseStartMs >= moveMs) {
        detachServoIfNeeded();
        Serial.print("EVT PRESS_DONE ");
        Serial.println(actionLabel(activeAction));
        activeAction = 'I';
        if (pressesRemainingInStep > 0) {
          motionState = WAITING_NEXT_PRESS;
          phaseStartMs = now;
        } else {
          Serial.print("EVT STEP_DONE ");
          Serial.println(actionLabel(stepAction));
          motionState = IDLE;
        }
      }
      break;

    case WAITING_NEXT_PRESS:
      if (now - phaseStartMs >= INTER_PRESS_INTERVAL_MS) {
        motionState = IDLE;
      }
      break;
  }
}

void updateEmgTrigger() {
  if (!emgEnabled) return;

  unsigned long now = millis();
  if (now - lastEmgSampleMs < EMG_SAMPLE_MS) return;
  lastEmgSampleMs = now;

  emgRaw = analogRead(EMG_ENV_PIN);
  bool above = emgRaw >= emgEngageThreshold;
  bool below = emgRaw <= emgReleaseThreshold;

  if (above) {
    if (emgAboveCount < 255) emgAboveCount++;
  } else {
    emgAboveCount = 0;
  }

  if (below) {
    if (emgBelowCount < 255) emgBelowCount++;
  } else {
    emgBelowCount = 0;
  }

  // Only edge-trigger plus/minus when servo is idle and cooldown elapsed.
  if (motionState != IDLE || pressesRemainingInStep > 0) return;
  if (now - lastEmgEdgeMs < EMG_MIN_EDGE_GAP_MS) return;

  if (!emgLatched && emgAboveCount >= EMG_CONSECUTIVE_REQUIRED) {
    if (startPress('P', plusAngle)) {
      emgLatched = true;
      lastEmgEdgeMs = now;
      emgAboveCount = 0;
      Serial.print("EVT EMG_ENGAGE raw=");
      Serial.println(emgRaw);
    }
    return;
  }

  if (emgLatched && emgBelowCount >= EMG_CONSECUTIVE_REQUIRED) {
    if (startPress('M', minusAngle)) {
      emgLatched = false;
      lastEmgEdgeMs = now;
      emgBelowCount = 0;
      Serial.print("EVT EMG_RELEASE raw=");
      Serial.println(emgRaw);
    }
  }
}

bool consumeButtonPress(int pin, ButtonDebounce &state) {
  bool rawPressed = (digitalRead(pin) == LOW);
  unsigned long now = millis();

  if (rawPressed != state.lastRawPressed) {
    state.lastRawPressed = rawPressed;
    state.lastChangeMs = now;
  }

  if ((now - state.lastChangeMs) >= DEBOUNCE_MS && rawPressed != state.stablePressed) {
    state.stablePressed = rawPressed;
    if (state.stablePressed) {
      return true; // rising press event
    }
  }

  return false;
}

void parseAndExecuteCommand(const char *line) {
  if (line == nullptr || line[0] == '\0') {
    return;
  }

  if (strcasecmp(line, "PING") == 0) {
    Serial.println("OK PONG");
    return;
  }

  if (strcasecmp(line, "STATUS") == 0) {
    printStatus();
    return;
  }

  if (strcasecmp(line, "EMG_STATUS") == 0) {
    Serial.print("STATUS emgEnabled=");
    Serial.print(emgEnabled ? "1" : "0");
    Serial.print(" emgLatched=");
    Serial.print(emgLatched ? "1" : "0");
    Serial.print(" emgRaw=");
    Serial.print(emgRaw);
    Serial.print(" emgEngage=");
    Serial.print(emgEngageThreshold);
    Serial.print(" emgRelease=");
    Serial.println(emgReleaseThreshold);
    return;
  }

  if (strcasecmp(line, "STOP") == 0) {
    emergencyStop();
    return;
  }

  if (strcasecmp(line, "EMG ON") == 0) {
    emgEnabled = true;
    Serial.println("OK emg-on");
    return;
  }

  if (strcasecmp(line, "EMG OFF") == 0) {
    emgEnabled = false;
    emgAboveCount = 0;
    emgBelowCount = 0;
    Serial.println("OK emg-off");
    return;
  }

  if (strcasecmp(line, "PLUS") == 0 || strcasecmp(line, "PRESS A") == 0 || strcasecmp(line, "A") == 0 || strcmp(line, "+") == 0) {
    if (startPress('P', plusAngle)) Serial.println("OK PLUS");
    return;
  }

  if (strcasecmp(line, "MINUS") == 0 || strcasecmp(line, "PRESS B") == 0 || strcasecmp(line, "B") == 0 || strcmp(line, "-") == 0) {
    if (startPress('M', minusAngle)) Serial.println("OK MINUS");
    return;
  }

  int a, n, b;
  if (sscanf(line, "ANGLES %d %d %d", &a, &n, &b) == 3) {
    plusAngle = clampInt(a, SAFE_MIN_ANGLE, SAFE_MAX_ANGLE);
    neutralAngle = clampInt(n, SAFE_MIN_ANGLE, SAFE_MAX_ANGLE);
    minusAngle = clampInt(b, SAFE_MIN_ANGLE, SAFE_MAX_ANGLE);
    Serial.println("OK angles-updated");
    return;
  }

  int m, h;
  if (sscanf(line, "TIMING %d %d", &m, &h) == 2) {
    moveMs = (unsigned long)clampInt(m, 50, 5000);
    holdMs = (unsigned long)clampInt(h, 50, 5000);
    Serial.println("OK timing-updated");
    return;
  }

  int engage, release;
  if (sscanf(line, "EMG_THRESH %d %d", &engage, &release) == 2) {
    emgEngageThreshold = clampInt(engage, 0, 4095);
    emgReleaseThreshold = clampInt(release, 0, 4095);
    if (emgReleaseThreshold > emgEngageThreshold) {
      emgReleaseThreshold = emgEngageThreshold;
    }
    Serial.println("OK emg-thresholds-updated");
    return;
  }

  Serial.println("ERR unknown-command");
}

void readSerialCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      cmdBuf[cmdLen] = '\0';
      parseAndExecuteCommand(cmdBuf);
      cmdLen = 0;
      continue;
    }

    if (cmdLen < (CMD_BUF_SIZE - 1)) {
      cmdBuf[cmdLen++] = c;
    } else {
      cmdLen = 0;
      Serial.println("ERR cmd-too-long");
    }
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(BTN_A_PIN, INPUT_PULLUP);
  pinMode(BTN_B_PIN, INPUT); // GPIO35 input-only; TTGO board pull-up in hardware
  pinMode(EMG_ENV_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(EMG_ENV_PIN, ADC_11db);

  attachServoIfNeeded();
  writeServoSafe(neutralAngle);
  delay(350);
  detachServoIfNeeded();

  Serial.println("OK boot");
  printStatus();
  Serial.println("OK ready");
}

void loop() {
  readSerialCommands();

  if (consumeButtonPress(BTN_A_PIN, btnA)) {
    startPress('P', plusAngle);
  }
  if (consumeButtonPress(BTN_B_PIN, btnB)) {
    startPress('M', minusAngle);
  }

  updateEmgTrigger();
  updateMotion();
}

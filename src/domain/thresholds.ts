export type ThresholdProfile = {
  sensory: number;
  motor: number;
  tolerance: number;
};

export function normalizeThresholds(profile: ThresholdProfile, max: number): ThresholdProfile {
  const sensory = clamp(profile.sensory, 0, max);
  const motor = clamp(profile.motor, sensory, max);
  const tolerance = clamp(profile.tolerance, motor, max);
  return { sensory, motor, tolerance };
}

export function inTherapeuticWindow(level: number, profile: ThresholdProfile): boolean {
  return level >= profile.sensory && level <= profile.motor;
}

export function recommendedGripLevel(profile: ThresholdProfile): number {
  return Math.round((profile.sensory + profile.motor) / 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

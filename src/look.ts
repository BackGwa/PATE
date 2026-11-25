export const HEAD_X_RATIO = 0.5;
export const HEAD_Y_RATIO = 0.35;
export const DIRECTIONS = 16;

export type PointerOffset = { x: number; y: number };

export function headDistance(pointer: PointerOffset, petWidth: number, petHeight: number): number {
  return Math.hypot(pointer.x - petWidth * HEAD_X_RATIO, pointer.y - petHeight * HEAD_Y_RATIO);
}

export function lookDirection(
  pointer: PointerOffset,
  petWidth: number,
  petHeight: number,
  radius: number,
): number | null {
  const dx = pointer.x - petWidth * HEAD_X_RATIO;
  const dy = pointer.y - petHeight * HEAD_Y_RATIO;
  if (headDistance(pointer, petWidth, petHeight) > radius) {
    return null;
  }
  const clockwiseFromUp = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const step = 360 / DIRECTIONS;
  return Math.round(((clockwiseFromUp + 360) % 360) / step) % DIRECTIONS;
}

export function stepToward(from: number, to: number, steps: number): number {
  let delta = (to - from + DIRECTIONS) % DIRECTIONS;
  if (delta > DIRECTIONS / 2) {
    delta -= DIRECTIONS;
  }
  const moved = Math.sign(delta) * Math.min(Math.abs(delta), steps);
  return (from + moved + DIRECTIONS) % DIRECTIONS;
}
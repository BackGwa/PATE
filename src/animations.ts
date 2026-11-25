import { COLUMNS } from "./sheet";

export type Clip = {
  frames: { sprite: number; ms: number }[];
  loop: boolean;
};

const sprite = (row: number, column: number) => row * COLUMNS + column;

const rowFrames = (row: number, count: number, ms: number) =>
  Array.from({ length: count }, (_, column) => ({ sprite: sprite(row, column), ms }));

const runRow = (row: number, ms: number): Clip => ({ frames: rowFrames(row, 8, ms), loop: true });

const ACTION_FRAME_MS = 150;
const WALK_FRAME_MS = 180;

const EYES_OPEN = sprite(0, 0);
const EYES_HALF = sprite(0, 1);
const EYES_CLOSED = sprite(0, 2);
const OPEN_MIN_MS = 1500;
const OPEN_MAX_MS = 4000;
const DOUBLE_BLINK_CHANCE = 0.2;
const DOUBLE_BLINK_GAP_MS = 220;

const blink = () => [
  { sprite: EYES_HALF, ms: 90 },
  { sprite: EYES_CLOSED, ms: 150 + Math.random() * 60 },
  { sprite: EYES_HALF, ms: 110 },
];

export function idleCycle(): Clip {
  const frames = [{ sprite: EYES_OPEN, ms: OPEN_MIN_MS + Math.random() * (OPEN_MAX_MS - OPEN_MIN_MS) }, ...blink()];
  if (Math.random() < DOUBLE_BLINK_CHANCE) {
    frames.push({ sprite: EYES_OPEN, ms: DOUBLE_BLINK_GAP_MS }, ...blink());
  }
  return { frames, loop: false };
}

export const RUN_RIGHT = runRow(1, 120);
export const RUN_LEFT = runRow(2, 120);
export const WALK_RIGHT = runRow(1, WALK_FRAME_MS);
export const WALK_LEFT = runRow(2, WALK_FRAME_MS);

export type ActionName = "failed";

const ACTION_ROWS: Record<ActionName, { row: number; count: number }> = {
  failed: { row: 5, count: 8 },
};

export function actionClip(name: ActionName): Clip {
  const { row, count } = ACTION_ROWS[name];
  return { frames: rowFrames(row, count, ACTION_FRAME_MS), loop: false };
}

export const FALL: Clip = {
  frames: [
    { sprite: sprite(4, 2), ms: 140 },
    { sprite: sprite(4, 3), ms: 140 },
  ],
  loop: false,
};

export const LAND: Clip = {
  frames: [
    { sprite: sprite(4, 4), ms: 120 },
    { sprite: sprite(4, 0), ms: 180 },
  ],
  loop: false,
};

export const IDLE_SPRITE = EYES_OPEN;
export const LOOK_FIRST_SPRITE = sprite(9, 0);
export const LOOK_STEP_MS = 10;
export const MORPH_MS = 100;
export const BLINK_PAIRS: [number, number][] = [
  [EYES_OPEN, EYES_HALF],
  [EYES_HALF, EYES_CLOSED],
  [EYES_CLOSED, EYES_HALF],
  [EYES_HALF, EYES_OPEN],
];
export const SQUASH_MS = 150;
const SQUASH_STRENGTH = 0.09;

export function squashAt(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= SQUASH_MS) {
    return 0;
  }
  const progress = elapsedMs / SQUASH_MS;
  return Math.sin(progress * Math.PI) * (1 - progress) * SQUASH_STRENGTH;
}

export type ClipFrame = {
  sprite: number;
  previous: number | null;
  elapsedInFrame: number;
  frameMs: number;
  finished: boolean;
};

export function frameAt(clip: Clip, elapsedMs: number): ClipFrame {
  const frames = clip.frames;
  const total = frames.reduce((sum, frame) => sum + frame.ms, 0);
  const last = frames.length - 1;
  if (!clip.loop && elapsedMs >= total) {
    return { sprite: frames[last].sprite, previous: null, elapsedInFrame: frames[last].ms, frameMs: frames[last].ms, finished: true };
  }
  let remaining = clip.loop ? elapsedMs % total : elapsedMs;
  let index = 0;
  while (index < last && remaining >= frames[index].ms) {
    remaining -= frames[index].ms;
    index++;
  }
  const previousIndex = index > 0 ? index - 1 : clip.loop ? last : null;
  return {
    sprite: frames[index].sprite,
    previous: previousIndex === null ? null : frames[previousIndex].sprite,
    elapsedInFrame: remaining,
    frameMs: frames[index].ms,
    finished: false,
  };
}
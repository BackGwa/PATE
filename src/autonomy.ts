import { invoke } from "@tauri-apps/api/core";
import { ActionName, actionClip } from "./animations";
import { AutonomyLevel } from "./autonomy-level";
import { Facing, PetView } from "./pet";
import { AutonomyDebug } from "./popup-protocol";

const INTERVALS: Record<Exclude<AutonomyLevel, "off">, { minMs: number; maxMs: number }> = {
  sometimes: { minMs: 30_000, maxMs: 60_000 },
  often: { minMs: 15_000, maxMs: 30_000 },
};
const TICK_MS = 250;
const CHAIN_CHANCE = 0.5;
const MAX_CHAIN_LENGTH = 3;
const CHAIN_PAUSE_MIN_MS = 500;
const CHAIN_PAUSE_MAX_MS = 3000;
const START_GRACE_MS = 1000;
const LEAP_CHANCE = 0.5;
const WALK_MIN_DISTANCE = 100;
const WALK_MAX_DISTANCE = 300;

type Behavior = "walk" | ActionName;

const BEHAVIOR_WEIGHTS: Record<Behavior, number> = {
  walk: 1,
  failed: 1,
};

type Performance = {
  behavior: Behavior;
  startedAt: number;
  seenBusy: boolean;
};

export class Autonomy {
  private nextActionAt = 0;
  private cursorNear = false;
  private performing: Performance | null = null;
  private lastBehavior: Behavior | null = null;
  private chainLength = 0;

  constructor(
    private readonly view: PetView,
    private level: AutonomyLevel,
    private readonly canAct: () => boolean,
  ) {
    this.scheduleInterval(performance.now());
  }

  start() {
    setInterval(() => this.tick(), TICK_MS);
  }

  setLevel(level: AutonomyLevel) {
    this.level = level;
    this.touch();
  }

  touch() {
    this.interrupt();
    this.scheduleInterval(performance.now());
  }

  setCursorNear(near: boolean) {
    this.cursorNear = near;
    if (near && this.performing !== null) {
      this.interrupt();
      this.scheduleInterval(performance.now());
    }
  }

  snapshot(): AutonomyDebug {
    const now = performance.now();
    return {
      level: this.level,
      current: this.performing?.behavior ?? null,
      chain: this.chainLength === 0 ? null : `${this.chainLength}/${MAX_CHAIN_LENGTH}`,
      nextActionInMs: this.level === "off" || this.performing !== null ? null : Math.max(0, this.nextActionAt - now),
      cursorNear: this.cursorNear,
    };
  }

  private tick() {
    if (this.level === "off" || !this.canAct()) {
      return;
    }
    const now = performance.now();
    if (this.performing !== null) {
      this.followPerformance(now);
      return;
    }
    if (!this.view.isStanding || this.cursorNear || now < this.nextActionAt) {
      return;
    }
    this.perform(now);
  }

  private followPerformance(now: number) {
    const performing = this.performing!;
    const busy = this.view.isWalking || this.view.isActing || !this.view.isStanding;
    if (busy) {
      performing.seenBusy = true;
      return;
    }
    if (!performing.seenBusy && now - performing.startedAt < START_GRACE_MS) {
      return;
    }
    this.performing = null;
    if (this.chainLength < MAX_CHAIN_LENGTH && Math.random() < CHAIN_CHANCE) {
      this.nextActionAt = now + randomBetween(CHAIN_PAUSE_MIN_MS, CHAIN_PAUSE_MAX_MS);
      return;
    }
    this.scheduleInterval(now);
  }

  private perform(now: number) {
    const behavior = this.pickBehavior();
    this.performing = { behavior, startedAt: now, seenBusy: false };
    this.lastBehavior = behavior;
    this.chainLength++;
    if (behavior === "walk") {
      const facing: Facing = Math.random() < 0.5 ? "left" : "right";
      void invoke("start_walk", {
        facing,
        distance: randomBetween(WALK_MIN_DISTANCE, WALK_MAX_DISTANCE),
        leap: Math.random() < LEAP_CHANCE,
      });
      return;
    }
    this.view.playAction(actionClip(behavior));
  }

  private pickBehavior(): Behavior {
    const candidates = (Object.keys(BEHAVIOR_WEIGHTS) as Behavior[]).filter(
      (behavior) => behavior === "walk" || behavior !== this.lastBehavior,
    );
    const total = candidates.reduce((sum, behavior) => sum + BEHAVIOR_WEIGHTS[behavior], 0);
    let roll = Math.random() * total;
    for (const behavior of candidates) {
      roll -= BEHAVIOR_WEIGHTS[behavior];
      if (roll < 0) {
        return behavior;
      }
    }
    return candidates[candidates.length - 1];
  }

  private interrupt() {
    this.performing = null;
    this.view.stopAction();
    if (this.view.isWalking) {
      void invoke("stop_walk");
    }
  }

  private scheduleInterval(now: number) {
    this.chainLength = 0;
    this.lastBehavior = null;
    if (this.level === "off") {
      return;
    }
    const { minMs, maxMs } = INTERVALS[this.level];
    this.nextActionAt = now + randomBetween(minMs, maxMs);
  }
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

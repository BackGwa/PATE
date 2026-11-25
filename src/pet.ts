import {
  BLINK_PAIRS,
  Clip,
  FALL,
  IDLE_SPRITE,
  LAND,
  LOOK_FIRST_SPRITE,
  LOOK_STEP_MS,
  MORPH_MS,
  RUN_LEFT,
  RUN_RIGHT,
  WALK_LEFT,
  WALK_RIGHT,
  frameAt,
  idleCycle,
  squashAt,
} from "./animations";
import { DIRECTIONS, stepToward } from "./look";
import { FlowMorph } from "./morph";
import { CELL_HEIGHT, CELL_WIDTH, COLUMNS, Sheet } from "./sheet";

export type Facing = "left" | "right";

export type MotionState =
  | { state: "dragging"; facing: Facing }
  | { state: "falling" }
  | { state: "flying"; facing: Facing }
  | { state: "walking"; facing: Facing }
  | { state: "standing"; x: number; y: number };

type Gaze = number | "idle";

type GazeSegment = {
  from: Gaze;
  to: Gaze;
  startedAt: number;
  length: number;
};

type Pose = {
  from: number;
  to: number;
  progress: number;
};

export class PetView {
  private readonly context: CanvasRenderingContext2D;
  private readonly stage = new OffscreenCanvas(CELL_WIDTH, CELL_HEIGHT);
  private readonly stageContext = this.stage.getContext("2d")!;
  private readonly morph: FlowMorph;
  private motion: MotionState | null = null;
  private landing = false;
  private action: Clip | null = null;
  private look: number | null = null;
  private gaze: Gaze = "idle";
  private gazeSegment: GazeSegment | null = null;
  private squashStartedAt = Number.NEGATIVE_INFINITY;
  private idle: Clip = idleCycle();
  private previousIdleSprite = IDLE_SPRITE;
  private clip: Clip = this.idle;
  private clipStartedAt = performance.now();
  private drawnKey = "";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private sheet: Sheet,
  ) {
    this.context = canvas.getContext("2d")!;
    this.morph = new FlowMorph(sheet);
    this.prepareMorphs();
  }

  get isStanding(): boolean {
    return this.motion?.state === "standing";
  }

  get isWalking(): boolean {
    return this.motion?.state === "walking";
  }

  get isActing(): boolean {
    return this.action !== null;
  }

  playAction(clip: Clip) {
    this.action = clip;
  }

  stopAction() {
    this.action = null;
  }

  setSheet(sheet: Sheet) {
    this.sheet = sheet;
    this.look = null;
    this.restartIdle();
    this.morph.setSheet(sheet);
    this.prepareMorphs();
    this.drawnKey = "";
  }

  setMotion(motion: MotionState) {
    const wasAirborne = isAirborne(this.motion);
    this.landing = isGrounded(motion) && wasAirborne;
    if (motion.state !== "standing") {
      this.action = null;
    }
    if (this.landing || (isAirborne(motion) && !wasAirborne)) {
      this.squashStartedAt = performance.now();
    }
    this.motion = motion;
  }

  setLook(direction: number | null) {
    this.look = this.sheet.hasLook ? direction : null;
  }

  start() {
    const render = (now: number) => {
      this.draw(now);
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  private prepareMorphs() {
    const pairs: [number, number][] = [...BLINK_PAIRS];
    if (this.sheet.hasLook) {
      for (let direction = 0; direction < DIRECTIONS; direction++) {
        const look = LOOK_FIRST_SPRITE + direction;
        const next = LOOK_FIRST_SPRITE + ((direction + 1) % DIRECTIONS);
        pairs.push([IDLE_SPRITE, look], [look, IDLE_SPRITE], [look, next], [next, look]);
      }
    }
    this.morph.prepare(pairs);
  }

  private draw(now: number) {
    const pose = this.currentPose(now);
    const squash = squashAt(now - this.squashStartedAt);
    const width = Math.round(this.canvas.clientWidth * devicePixelRatio);
    const height = Math.round(this.canvas.clientHeight * devicePixelRatio);
    const morphing = pose.progress < 1 && pose.from !== pose.to;
    const key = [pose.to, morphing ? pose.from : "", morphing ? pose.progress.toFixed(3) : "", squash, width, height].join(":");
    if (key === this.drawnKey) {
      return;
    }
    this.drawnKey = key;
    this.canvas.width = width;
    this.canvas.height = height;
    const scaleX = 1 + squash;
    const scaleY = 1 - squash;
    const footY = height * (1 - this.sheet.footInsetRatio);
    this.context.setTransform(scaleX, 0, 0, scaleY, (width / 2) * (1 - scaleX), footY * (1 - scaleY));
    this.context.imageSmoothingQuality = "high";
    this.context.clearRect(0, 0, width, height);
    const morphed = morphing ? this.morph.render(pose.from, pose.to, smooth(pose.progress)) : null;
    if (morphed !== null) {
      this.stageContext.putImageData(morphed, 0, 0);
      this.context.drawImage(this.stage, 0, 0, width, height);
      return;
    }
    this.context.drawImage(
      this.sheet.image,
      (pose.to % COLUMNS) * CELL_WIDTH,
      Math.floor(pose.to / COLUMNS) * CELL_HEIGHT,
      CELL_WIDTH,
      CELL_HEIGHT,
      0,
      0,
      width,
      height,
    );
  }

  private currentPose(now: number): Pose {
    const motionClip = this.motionClip();
    if (motionClip) {
      this.restartIdle();
      return still(this.play(motionClip, now).sprite);
    }
    if (this.landing) {
      const frame = this.play(LAND, now);
      if (!frame.finished) {
        this.restartIdle();
        return still(frame.sprite);
      }
      this.landing = false;
    }
    if (this.look !== null) {
      this.action = null;
    } else if (this.action !== null) {
      const frame = this.play(this.action, now);
      if (!frame.finished) {
        this.restartIdle();
        return still(frame.sprite);
      }
      this.action = null;
    }
    const idlePose = this.idlePose(now);
    this.advanceGaze(this.look ?? "idle", now);
    const segment = this.gazeSegment;
    if (segment !== null) {
      return {
        from: this.gazeSprite(segment.from, idlePose.to),
        to: this.gazeSprite(segment.to, idlePose.to),
        progress: (now - segment.startedAt) / segment.length,
      };
    }
    return this.gaze === "idle" ? idlePose : still(this.gazeSprite(this.gaze, idlePose.to));
  }

  private idlePose(now: number): Pose {
    let frame = this.play(this.idle, now);
    if (frame.finished) {
      this.previousIdleSprite = frame.sprite;
      this.idle = idleCycle();
      frame = this.play(this.idle, now);
    }
    const previous = frame.previous ?? this.previousIdleSprite;
    const length = Math.min(MORPH_MS, frame.frameMs);
    return {
      from: previous,
      to: frame.sprite,
      progress: previous === frame.sprite ? 1 : Math.min(1, frame.elapsedInFrame / length),
    };
  }

  private advanceGaze(target: Gaze, now: number) {
    for (;;) {
      const segment = this.gazeSegment;
      if (segment !== null) {
        const endsAt = segment.startedAt + segment.length;
        if (now < endsAt) {
          return;
        }
        this.gaze = segment.to;
        this.gazeSegment = null;
        if (this.gaze === target) {
          return;
        }
        this.startGazeSegment(target, endsAt);
      } else {
        if (this.gaze === target) {
          return;
        }
        this.startGazeSegment(target, now);
      }
    }
  }

  private startGazeSegment(target: Gaze, startedAt: number) {
    const from = this.gaze;
    const stepping = from !== "idle" && target !== "idle";
    this.gazeSegment = {
      from,
      to: stepping ? stepToward(from, target, 1) : target,
      startedAt,
      length: stepping ? LOOK_STEP_MS : MORPH_MS,
    };
  }

  private restartIdle() {
    this.gaze = "idle";
    this.gazeSegment = null;
    this.previousIdleSprite = IDLE_SPRITE;
  }

  private gazeSprite(gaze: Gaze, idleSprite: number): number {
    return gaze === "idle" ? idleSprite : LOOK_FIRST_SPRITE + gaze;
  }

  private motionClip(): Clip | null {
    switch (this.motion?.state) {
      case "dragging":
      case "flying":
        return this.motion.facing === "right" ? RUN_RIGHT : RUN_LEFT;
      case "walking":
        return this.motion.facing === "right" ? WALK_RIGHT : WALK_LEFT;
      case "falling":
        return FALL;
      default:
        return null;
    }
  }

  private play(clip: Clip, now: number) {
    if (clip !== this.clip) {
      this.clip = clip;
      this.clipStartedAt = now;
    }
    return frameAt(clip, now - this.clipStartedAt);
  }
}

function still(sprite: number): Pose {
  return { from: sprite, to: sprite, progress: 1 };
}

function smooth(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

function isGrounded(motion: MotionState): boolean {
  return motion.state === "standing" || motion.state === "walking";
}

function isAirborne(motion: MotionState | null): boolean {
  return motion?.state === "falling" || motion?.state === "flying";
}

import { AutonomyLevel } from "./autonomy-level";
import { Language } from "./i18n";

export const POPUP_WINDOW = "popup";
export const DEBUG_TOGGLE_EVENT = "debug-toggle";
export const VIEW_DEBUG_EVENT = "view-debug";
export const PET_DEBUG_EVENT = "pet-debug";

export type DebugToggle = { enabled: boolean; language: Language };

export type AutonomyDebug = {
  level: AutonomyLevel;
  current: string | null;
  chain: string | null;
  nextActionInMs: number | null;
  cursorNear: boolean;
};

export type ViewDebug = {
  distance: number;
  direction: number | null;
  radius: number;
  scale: number;
  autonomy: AutonomyDebug;
};

export type PetDebug = {
  state: "unplaced" | "dragging" | "falling" | "flying" | "walking" | "standing";
  facing: "left" | "right" | null;
  vx: number;
  vy: number;
  support: { kind: "floor" } | { kind: "window"; id: number } | null;
  walk: { remaining: number; leap: boolean } | null;
  frame: { x: number; y: number; width: number; height: number };
  foot: number;
  title: string | null;
  display_scale: number;
};

export type PopupSession = {
  onKey(event: KeyboardEvent): void;
  onPointerDown(event: PointerEvent): void;
  onBlur(): void;
};

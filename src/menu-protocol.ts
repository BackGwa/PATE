import { AutonomyLevel } from "./autonomy-level";
import { Language } from "./i18n";

export const MENU_OPEN_EVENT = "menu-open";
export const MENU_ACTION_EVENT = "menu-action";

export type MenuParams = {
  language: Language;
  lookAvailable: boolean;
  debug: boolean;
  autonomy: AutonomyLevel;
  anchorX: number;
  anchorY: number;
  workLeft: number;
  workTop: number;
  workRight: number;
  workBottom: number;
};

export type MenuAction =
  | { action: "resize" }
  | { action: "lookRange" }
  | { action: "changeSheet" }
  | { action: "debug" }
  | { action: "quit" }
  | { action: "language"; language: Language }
  | { action: "autonomy"; level: AutonomyLevel };

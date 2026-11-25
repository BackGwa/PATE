import { Language } from "./i18n";

export const OVERLAY_OPEN_EVENT = "overlay-open";
export const OVERLAY_PREVIEW_EVENT = "overlay-preview";
export const OVERLAY_END_EVENT = "overlay-end";
export const MIN_SCALE_PERCENT = 25;
export const MAX_SCALE_PERCENT = 200;
export const MIN_RADIUS = 20;
export const MAX_RADIUS_SLIDER = 2000;

export type OverlayMode = "size" | "radius";

export type OverlayParams = {
  mode: OverlayMode;
  language: Language;
  areaX: number;
  areaY: number;
  areaWidth: number;
  areaHeight: number;
  petCenterX: number;
  petBottom: number;
  scale: number;
  radius: number;
};

export type OverlayPreview = { value: number };
export type OverlayEnd = { commit: boolean };

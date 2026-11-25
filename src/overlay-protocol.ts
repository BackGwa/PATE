import { Language } from "./i18n";

export const OVERLAY_WINDOW = "overlay";
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
  petCenterX: number;
  petBottom: number;
  scale: number;
  radius: number;
};

export type OverlayPreview = { value: number };
export type OverlayEnd = { commit: boolean };

export function encodeOverlayParams(params: OverlayParams): string {
  return new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
}

export function decodeOverlayParams(search: string): OverlayParams {
  const query = new URLSearchParams(search);
  return {
    mode: query.get("mode") as OverlayMode,
    language: query.get("language") as Language,
    petCenterX: Number(query.get("petCenterX")),
    petBottom: Number(query.get("petBottom")),
    scale: Number(query.get("scale")),
    radius: Number(query.get("radius")),
  };
}

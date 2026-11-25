import { Language } from "./i18n";

export const MENU_WINDOW = "menu";
export const MENU_ACTION_EVENT = "menu-action";

export type MenuParams = {
  language: Language;
  lookAvailable: boolean;
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
  | { action: "quit" }
  | { action: "language"; language: Language };

export function encodeMenuParams(params: MenuParams): string {
  return new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
}

export function decodeMenuParams(search: string): MenuParams {
  const query = new URLSearchParams(search);
  const number = (key: string) => Number(query.get(key));
  return {
    language: query.get("language") as Language,
    lookAvailable: query.get("lookAvailable") === "true",
    anchorX: number("anchorX"),
    anchorY: number("anchorY"),
    workLeft: number("workLeft"),
    workTop: number("workTop"),
    workRight: number("workRight"),
    workBottom: number("workBottom"),
  };
}

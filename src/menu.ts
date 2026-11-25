import { emitTo } from "@tauri-apps/api/event";
import { cursorPosition, monitorFromPoint } from "@tauri-apps/api/window";
import { AutonomyLevel } from "./autonomy-level";
import { Language } from "./i18n";
import { MENU_OPEN_EVENT, MenuParams } from "./menu-protocol";
import { POPUP_WINDOW } from "./popup-protocol";

export async function openContextMenu(language: Language, lookAvailable: boolean, debug: boolean, autonomy: AutonomyLevel) {
  const cursor = await cursorPosition();
  const monitor = await monitorFromPoint(cursor.x, cursor.y);
  if (monitor === null) {
    return;
  }
  const scaleFactor = monitor.scaleFactor;
  const { position, size } = monitor.workArea;
  const params: MenuParams = {
    language,
    lookAvailable,
    debug,
    autonomy,
    anchorX: cursor.x / scaleFactor,
    anchorY: cursor.y / scaleFactor,
    workLeft: position.x / scaleFactor,
    workTop: position.y / scaleFactor,
    workRight: (position.x + size.width) / scaleFactor,
    workBottom: (position.y + size.height) / scaleFactor,
  };
  await emitTo(POPUP_WINDOW, MENU_OPEN_EVENT, params);
}

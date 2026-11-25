import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { cursorPosition, monitorFromPoint } from "@tauri-apps/api/window";
import { Language } from "./i18n";
import { MENU_WINDOW, encodeMenuParams } from "./menu-protocol";

const INITIAL_WIDTH = 252;
const INITIAL_HEIGHT = 320;

export async function openContextMenu(language: Language, lookAvailable: boolean) {
  const existing = await WebviewWindow.getByLabel(MENU_WINDOW);
  if (existing !== null) {
    await existing.close();
  }
  const cursor = await cursorPosition();
  const monitor = await monitorFromPoint(cursor.x, cursor.y);
  if (monitor === null) {
    return;
  }
  const scaleFactor = monitor.scaleFactor;
  const { position, size } = monitor.workArea;
  const query = encodeMenuParams({
    language,
    lookAvailable,
    anchorX: cursor.x / scaleFactor,
    anchorY: cursor.y / scaleFactor,
    workLeft: position.x / scaleFactor,
    workTop: position.y / scaleFactor,
    workRight: (position.x + size.width) / scaleFactor,
    workBottom: (position.y + size.height) / scaleFactor,
  });
  new WebviewWindow(MENU_WINDOW, {
    url: `menu.html?${query}`,
    x: cursor.x / scaleFactor,
    y: cursor.y / scaleFactor,
    width: INITIAL_WIDTH,
    height: INITIAL_HEIGHT,
    visible: false,
    focus: false,
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    shadow: false,
  });
}

import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { message, open } from "@tauri-apps/plugin-dialog";
import { Autonomy } from "./autonomy";
import { Language, systemLanguage, texts } from "./i18n";
import { PointerOffset, headDistance, lookDirection } from "./look";
import { openContextMenu } from "./menu";
import { MENU_ACTION_EVENT, MenuAction } from "./menu-protocol";
import {
  OVERLAY_END_EVENT,
  OVERLAY_OPEN_EVENT,
  OVERLAY_PREVIEW_EVENT,
  OverlayEnd,
  OverlayMode,
  OverlayParams,
  OverlayPreview,
} from "./overlay-protocol";
import { DEBUG_TOGGLE_EVENT, DebugToggle, POPUP_WINDOW, VIEW_DEBUG_EVENT, ViewDebug } from "./popup-protocol";
import { MotionState, PetView } from "./pet";
import { SettingsStore } from "./settings";
import { Sheet, SheetSizeError, loadDefaultSheet, loadSheetFile } from "./sheet";

const LOOK_INTERVAL_MS = 33;
const SHEET_EXTENSIONS = ["png", "webp"];

const petWindow = getCurrentWindow();
const canvas = document.getElementById("pet") as HTMLCanvasElement;

const settings = await SettingsStore.open();
let language: Language = settings.values.language ?? systemLanguage();
let sheet = await loadStartupSheet();
let lookRadius = settings.values.lookRadius;
let activeMode: { mode: OverlayMode; initialValue: number; value: number } | null = null;
let debugEnabled = false;

const view = new PetView(canvas, sheet);
const autonomy = new Autonomy(view, settings.values.autonomy, () => activeMode === null);

function sheetErrorReason(error: unknown): string {
  return error instanceof SheetSizeError
    ? texts(language).sheetSizeError(error.width, error.height)
    : texts(language).sheetReadError(String(error));
}

async function loadStartupSheet(): Promise<Sheet> {
  const path = settings.values.sheetPath;
  if (path === null) {
    return loadDefaultSheet();
  }
  try {
    return await loadSheetFile(path);
  } catch (error) {
    await settings.update({ sheetPath: null });
    await message(texts(language).savedSheetFallback(sheetErrorReason(error)), { kind: "warning" });
    return loadDefaultSheet();
  }
}

async function applySheet(next: Sheet) {
  sheet = next;
  view.setSheet(next);
  await invoke("set_foot_inset", { ratio: next.footInsetRatio });
}

async function changeSheet() {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: texts(language).sheetFilter, extensions: SHEET_EXTENSIONS }],
  });
  if (path === null) {
    return;
  }
  try {
    await applySheet(await loadSheetFile(path));
    await settings.update({ sheetPath: path });
  } catch (error) {
    await message(sheetErrorReason(error), { kind: "error" });
  }
}

async function openOverlay(mode: OverlayMode) {
  const monitor = await currentMonitor();
  if (monitor === null || activeMode !== null) {
    return;
  }
  const scaleFactor = monitor.scaleFactor;
  const position = await petWindow.outerPosition();
  const size = await petWindow.outerSize();
  const initialValue = mode === "size" ? settings.values.scale : lookRadius;
  activeMode = { mode, initialValue, value: initialValue };
  view.setLook(null);
  const params: OverlayParams = {
    mode,
    language,
    areaX: monitor.position.x / scaleFactor,
    areaY: monitor.position.y / scaleFactor,
    areaWidth: monitor.size.width / scaleFactor,
    areaHeight: monitor.size.height / scaleFactor,
    petCenterX: (position.x + size.width / 2 - monitor.position.x) / scaleFactor,
    petBottom: (position.y + size.height - monitor.position.y) / scaleFactor,
    scale: settings.values.scale,
    radius: lookRadius,
  };
  await emitTo(POPUP_WINDOW, OVERLAY_OPEN_EVENT, params);
}

async function toggleDebug() {
  debugEnabled = !debugEnabled;
  const toggle: DebugToggle = { enabled: debugEnabled, language };
  await emitTo(POPUP_WINDOW, DEBUG_TOGGLE_EVENT, toggle);
}

async function previewMode(value: number) {
  if (activeMode === null) {
    return;
  }
  activeMode.value = value;
  if (activeMode.mode === "size") {
    await invoke("resize_pet", { scale: value });
  }
}

async function endMode(commit: boolean) {
  if (activeMode === null) {
    return;
  }
  const { mode, initialValue, value } = activeMode;
  activeMode = null;
  const finalValue = commit ? value : initialValue;
  if (mode === "size") {
    await invoke("resize_pet", { scale: finalValue });
    await settings.update({ scale: finalValue });
  } else {
    lookRadius = finalValue;
    await settings.update({ lookRadius: finalValue });
  }
}

async function updateLook() {
  const grounded = activeMode === null && (view.isStanding || view.isWalking);
  if (!grounded && !debugEnabled) {
    view.setLook(null);
    autonomy.setCursorNear(false);
    return;
  }
  const pointer = await invoke<PointerOffset>("pointer_offset");
  const distance = headDistance(pointer, innerWidth, innerHeight);
  const near = grounded && distance <= lookRadius;
  autonomy.setCursorNear(near);
  const direction = near && sheet.hasLook && view.isStanding ? lookDirection(pointer, innerWidth, innerHeight, lookRadius) : null;
  view.setLook(direction);
  if (debugEnabled) {
    const debug: ViewDebug = {
      distance,
      direction,
      radius: lookRadius,
      scale: settings.values.scale,
      autonomy: autonomy.snapshot(),
    };
    void emitTo(POPUP_WINDOW, VIEW_DEBUG_EVENT, debug);
  }
}

canvas.addEventListener("pointerdown", (event) => {
  autonomy.touch();
  if (event.button !== 0) {
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("dragging");
  void invoke("drag_start");
});

const endDrag = (event: PointerEvent) => {
  if (!canvas.hasPointerCapture(event.pointerId)) {
    return;
  }
  canvas.releasePointerCapture(event.pointerId);
  canvas.classList.remove("dragging");
  void invoke("drag_end");
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  autonomy.touch();
  if (activeMode === null) {
    void openContextMenu(language, sheet.hasLook, debugEnabled, settings.values.autonomy);
  }
});

function handleMenuAction(action: MenuAction) {
  switch (action.action) {
    case "resize":
      return openOverlay("size");
    case "lookRange":
      return openOverlay("radius");
    case "changeSheet":
      return changeSheet();
    case "debug":
      return toggleDebug();
    case "language":
      language = action.language;
      return settings.update({ language: action.language });
    case "autonomy":
      autonomy.setLevel(action.level);
      return settings.update({ autonomy: action.level });
    case "quit":
      return invoke("quit_app");
  }
}

await listen<MotionState>("pet-motion", (event) => {
  view.setMotion(event.payload);
  if (event.payload.state === "standing") {
    void settings.update({ position: [event.payload.x, event.payload.y] });
  }
});
await listen<OverlayPreview>(OVERLAY_PREVIEW_EVENT, (event) => void previewMode(event.payload.value));
await listen<OverlayEnd>(OVERLAY_END_EVENT, (event) => void endMode(event.payload.commit));
await listen<MenuAction>(MENU_ACTION_EVENT, (event) => void handleMenuAction(event.payload));

await invoke("set_foot_inset", { ratio: sheet.footInsetRatio });
await invoke("resize_pet", { scale: settings.values.scale });
await invoke("place_pet", { position: settings.values.position });
view.start();
autonomy.start();
await petWindow.show();
setInterval(() => void updateLook(), LOOK_INTERVAL_MS);

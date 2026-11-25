import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "pretendard-jp/dist/web/variable/pretendardvariable-jp-dynamic-subset.css";
import "./popup.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { openMenu } from "./context-menu";
import { DebugPanel } from "./debug";
import { Language } from "./i18n";
import { MENU_OPEN_EVENT, MenuParams } from "./menu-protocol";
import { OVERLAY_OPEN_EVENT, OverlayParams } from "./overlay-protocol";
import { openOverlay } from "./overlay";
import {
  DEBUG_TOGGLE_EVENT,
  DebugToggle,
  PET_DEBUG_EVENT,
  PetDebug,
  PopupSession,
  VIEW_DEBUG_EVENT,
  ViewDebug,
} from "./popup-protocol";

const DISMISS_MS = 160;

const popupWindow = getCurrentWindow();
const stage = document.getElementById("stage") as HTMLDivElement;
const debugPanel = new DebugPanel(document.getElementById("debug-panel") as HTMLElement);
let session: PopupSession | null = null;
let debugEnabled = false;
let generation = 0;

function setLanguage(language: Language) {
  document.documentElement.lang = language;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reveal() {
  requestAnimationFrame(() => document.body.classList.add("open"));
}

async function conceal() {
  document.body.classList.remove("open");
  await wait(DISMISS_MS);
}

async function stopFollowing() {
  await invoke("follow_pet", { size: null });
  await popupWindow.setIgnoreCursorEvents(false);
}

async function showDebugPanel() {
  stage.replaceChildren();
  debugPanel.element.hidden = false;
  const { offsetWidth: width, offsetHeight: height } = debugPanel.element;
  await popupWindow.setIgnoreCursorEvents(true);
  await popupWindow.setSize(new LogicalSize(width, height));
  await invoke("follow_pet", { size: [width, height] });
  await invoke("show_popup", { focus: false });
  reveal();
}

async function begin(templateId: string, language: Language, start: (end: () => Promise<void>) => Promise<PopupSession>) {
  const current = ++generation;
  session = null;
  document.body.classList.remove("open");
  await popupWindow.hide();
  await stopFollowing();
  debugPanel.element.hidden = true;
  setLanguage(language);
  const template = document.getElementById(templateId) as HTMLTemplateElement;
  stage.replaceChildren(template.content.cloneNode(true));
  const started = await start(() => endSession(current));
  if (current !== generation) {
    return;
  }
  session = started;
  await invoke("show_popup", { focus: true });
  reveal();
}

async function endSession(owner: number) {
  if (owner !== generation) {
    return;
  }
  session = null;
  await conceal();
  if (owner !== generation) {
    return;
  }
  await popupWindow.hide();
  stage.replaceChildren();
  if (debugEnabled) {
    await showDebugPanel();
  }
}

async function setDebug(toggle: DebugToggle) {
  debugEnabled = toggle.enabled;
  if (session !== null) {
    return;
  }
  const current = ++generation;
  if (debugEnabled) {
    setLanguage(toggle.language);
    await showDebugPanel();
    return;
  }
  await conceal();
  if (current !== generation) {
    return;
  }
  await stopFollowing();
  await popupWindow.hide();
  debugPanel.element.hidden = true;
}

document.addEventListener("contextmenu", (event) => event.preventDefault());
document.addEventListener("keydown", (event) => session?.onKey(event));
document.addEventListener("pointerdown", (event) => session?.onPointerDown(event));

await popupWindow.onFocusChanged(({ payload: focused }) => {
  if (!focused) {
    session?.onBlur();
  }
});
await listen<MenuParams>(MENU_OPEN_EVENT, ({ payload }) =>
  void begin("menu-template", payload.language, (end) => openMenu(payload, end)),
);
await listen<OverlayParams>(OVERLAY_OPEN_EVENT, ({ payload }) =>
  void begin("overlay-template", payload.language, (end) => openOverlay(payload, end)),
);
await listen<DebugToggle>(DEBUG_TOGGLE_EVENT, ({ payload }) => void setDebug(payload));
await listen<PetDebug>(PET_DEBUG_EVENT, ({ payload }) => debugPanel.setPet(payload));
await listen<ViewDebug>(VIEW_DEBUG_EVENT, ({ payload }) => debugPanel.setView(payload));

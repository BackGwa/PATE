import { emitTo } from "@tauri-apps/api/event";
import { LogicalPosition, LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import "./context-menu.css";
import { LANGUAGES, texts } from "./i18n";
import { MENU_ACTION_EVENT, MenuAction, decodeMenuParams } from "./menu-protocol";
import { dismissPopup, preparePopup, revealPopup } from "./popup";

const SHADOW_MARGIN = 16;
const SUBMENU_OVERLAP = 4;
const SUBMENU_CLOSE_DELAY_MS = 200;
const CHECK_ICON = '<svg class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>';

const params = decodeMenuParams(location.search);
const text = texts(params.language);
const menuWindow = getCurrentWindow();
const menu = document.getElementById("menu") as HTMLDivElement;
const languageItem = document.getElementById("language-item") as HTMLButtonElement;
const submenu = document.getElementById("languages") as HTMLDivElement;
let closing = false;
let submenuCloseTimer: number | undefined;

preparePopup(params.language);

const labels: Record<string, string> = {
  resize: text.resize,
  lookRange: text.lookRange,
  changeSheet: text.changeSheet,
  quit: text.quit,
};

for (const item of menu.querySelectorAll<HTMLButtonElement>(".item[data-action]")) {
  const action = item.dataset.action as "resize" | "lookRange" | "changeSheet" | "quit";
  item.textContent = labels[action];
  item.disabled = action === "lookRange" && !params.lookAvailable;
  item.addEventListener("click", () => void choose({ action }));
  item.addEventListener("pointerenter", () => scheduleSubmenuClose());
}

(document.getElementById("language-label") as HTMLSpanElement).textContent = text.language;

for (const { code, name } of LANGUAGES) {
  const option = document.createElement("button");
  option.className = "item";
  option.setAttribute("role", "menuitemradio");
  option.setAttribute("aria-checked", String(code === params.language));
  option.innerHTML = `<span></span>${code === params.language ? CHECK_ICON : ""}`;
  option.querySelector("span")!.textContent = name;
  option.addEventListener("click", () => void choose({ action: "language", language: code }));
  submenu.append(option);
}

function openSubmenu() {
  window.clearTimeout(submenuCloseTimer);
  languageItem.setAttribute("aria-expanded", "true");
  submenu.hidden = false;
  requestAnimationFrame(() => submenu.classList.add("open"));
}

function closeSubmenu() {
  window.clearTimeout(submenuCloseTimer);
  languageItem.setAttribute("aria-expanded", "false");
  submenu.classList.remove("open");
  submenu.hidden = true;
}

function scheduleSubmenuClose() {
  window.clearTimeout(submenuCloseTimer);
  submenuCloseTimer = window.setTimeout(closeSubmenu, SUBMENU_CLOSE_DELAY_MS);
}

languageItem.addEventListener("pointerenter", openSubmenu);
languageItem.addEventListener("click", openSubmenu);
submenu.addEventListener("pointerenter", () => window.clearTimeout(submenuCloseTimer));

async function choose(action: MenuAction) {
  if (closing) {
    return;
  }
  closing = true;
  await emitTo("main", MENU_ACTION_EVENT, action);
  await dismissPopup();
}

async function close() {
  if (closing) {
    return;
  }
  closing = true;
  await dismissPopup();
}

function moveFocus(container: HTMLElement, step: number) {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)")];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[(current + step + buttons.length) % buttons.length]?.focus();
}

document.addEventListener("keydown", (event) => {
  const inSubmenu = submenu.contains(document.activeElement);
  if (event.key === "Escape") {
    void close();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveFocus(inSubmenu ? submenu : menu, event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "ArrowRight" && document.activeElement === languageItem) {
    openSubmenu();
    submenu.querySelector<HTMLButtonElement>("button")?.focus();
  } else if (event.key === "ArrowLeft" && inSubmenu) {
    closeSubmenu();
    languageItem.focus();
  }
});

document.addEventListener("pointerdown", (event) => {
  const target = event.target as Node;
  if (!menu.contains(target) && !submenu.contains(target)) {
    void close();
  }
});

async function layout() {
  submenu.hidden = false;
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const submenuWidth = submenu.offsetWidth;
  const submenuHeight = submenu.offsetHeight;
  submenu.hidden = true;

  const opensLeft = params.anchorX + menuWidth > params.workRight;
  const opensUp = params.anchorY + menuHeight > params.workBottom;
  const menuLeft = opensLeft ? params.anchorX - menuWidth : params.anchorX;
  const menuTop = Math.max(params.workTop, opensUp ? params.anchorY - menuHeight : params.anchorY);
  const submenuOnLeft = menuLeft + menuWidth - SUBMENU_OVERLAP + submenuWidth > params.workRight;
  const submenuLeft = submenuOnLeft ? menuLeft - submenuWidth + SUBMENU_OVERLAP : menuLeft + menuWidth - SUBMENU_OVERLAP;
  const submenuTop = Math.min(menuTop + languageItem.offsetTop - 5, params.workBottom - submenuHeight);

  const windowLeft = Math.max(params.workLeft, Math.min(menuLeft, submenuLeft)) - SHADOW_MARGIN;
  const windowTop = Math.min(menuTop, submenuTop) - SHADOW_MARGIN;
  const windowRight = Math.max(menuLeft + menuWidth, submenuLeft + submenuWidth) + SHADOW_MARGIN;
  const windowBottom = Math.max(menuTop + menuHeight, submenuTop + submenuHeight) + SHADOW_MARGIN;

  menu.style.left = `${menuLeft - windowLeft}px`;
  menu.style.top = `${menuTop - windowTop}px`;
  menu.style.transformOrigin = `${opensLeft ? "right" : "left"} ${opensUp ? "bottom" : "top"}`;
  submenu.style.left = `${submenuLeft - windowLeft}px`;
  submenu.style.top = `${submenuTop - windowTop}px`;
  submenu.style.transformOrigin = `${submenuOnLeft ? "right" : "left"} top`;

  await menuWindow.setSize(new LogicalSize(windowRight - windowLeft, windowBottom - windowTop));
  await menuWindow.setPosition(new LogicalPosition(windowLeft, windowTop));
}

await layout();
await revealPopup();
await menuWindow.onFocusChanged(({ payload: focused }) => {
  if (!focused) {
    void close();
  }
});

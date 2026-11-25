import { emitTo } from "@tauri-apps/api/event";
import { LogicalPosition, LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { AUTONOMY_LEVELS } from "./autonomy-level";
import "./context-menu.css";
import { LANGUAGES, texts } from "./i18n";
import { MENU_ACTION_EVENT, MenuAction, MenuParams } from "./menu-protocol";
import { PopupSession } from "./popup-protocol";

const SHADOW_MARGIN = 16;
const SUBMENU_OVERLAP = 4;
const SUBMENU_CLOSE_DELAY_MS = 200;
const CHECK_ICON = '<svg class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>';

type ItemAction = "resize" | "lookRange" | "changeSheet" | "quit";

type Submenu = {
  trigger: HTMLButtonElement;
  panel: HTMLDivElement;
};

type SubmenuOption = {
  label: string;
  checked: boolean;
  action: MenuAction;
};

export async function openMenu(params: MenuParams, end: () => Promise<void>): Promise<PopupSession> {
  const text = texts(params.language);
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const menu = byId<HTMLDivElement>("menu");
  const autostartItem = byId<HTMLButtonElement>("autostart-item");
  const debugItem = byId<HTMLButtonElement>("debug-item");
  const languages: Submenu = { trigger: byId("language-item"), panel: byId("languages") };
  const autonomy: Submenu = { trigger: byId("autonomy-item"), panel: byId("autonomy-levels") };
  const submenus = [languages, autonomy];
  let closing = false;
  let submenuCloseTimer: number | undefined;

  const labels: Record<ItemAction, string> = {
    resize: text.resize,
    lookRange: text.lookRange,
    changeSheet: text.changeSheet,
    quit: text.quit,
  };

  function openSubmenu(target: Submenu) {
    window.clearTimeout(submenuCloseTimer);
    for (const submenu of submenus) {
      if (submenu !== target) {
        hideSubmenu(submenu);
      }
    }
    target.trigger.setAttribute("aria-expanded", "true");
    target.panel.hidden = false;
    requestAnimationFrame(() => target.panel.classList.add("open"));
  }

  function hideSubmenu(submenu: Submenu) {
    submenu.trigger.setAttribute("aria-expanded", "false");
    submenu.panel.classList.remove("open");
    submenu.panel.hidden = true;
  }

  function closeSubmenus() {
    window.clearTimeout(submenuCloseTimer);
    submenus.forEach(hideSubmenu);
  }

  function scheduleSubmenuClose() {
    window.clearTimeout(submenuCloseTimer);
    submenuCloseTimer = window.setTimeout(closeSubmenus, SUBMENU_CLOSE_DELAY_MS);
  }

  async function finish(work?: () => Promise<void>) {
    if (closing) {
      return;
    }
    closing = true;
    window.clearTimeout(submenuCloseTimer);
    await work?.();
    await end();
  }

  const choose = (action: MenuAction) => finish(() => emitTo("main", MENU_ACTION_EVENT, action));

  function setChecked(item: HTMLButtonElement, checked: boolean) {
    item.setAttribute("aria-checked", String(checked));
    if (checked) {
      item.insertAdjacentHTML("beforeend", CHECK_ICON);
    }
  }

  function fillSubmenu(submenu: Submenu, label: string, options: SubmenuOption[]) {
    (submenu.trigger.querySelector("span") as HTMLSpanElement).textContent = label;
    for (const { label, checked, action } of options) {
      const option = document.createElement("button");
      option.className = "item";
      option.setAttribute("role", "menuitemradio");
      option.append(document.createElement("span"));
      option.querySelector("span")!.textContent = label;
      setChecked(option, checked);
      option.addEventListener("click", () => void choose(action));
      submenu.panel.append(option);
    }
    submenu.trigger.addEventListener("pointerenter", () => openSubmenu(submenu));
    submenu.trigger.addEventListener("click", () => openSubmenu(submenu));
    submenu.panel.addEventListener("pointerenter", () => window.clearTimeout(submenuCloseTimer));
  }

  for (const item of menu.querySelectorAll<HTMLButtonElement>(".item[data-action]")) {
    const action = item.dataset.action as ItemAction;
    item.textContent = labels[action];
    item.disabled = action === "lookRange" && !params.lookAvailable;
    item.addEventListener("click", () => void choose({ action }));
    item.addEventListener("pointerenter", scheduleSubmenuClose);
  }

  fillSubmenu(
    languages,
    text.language,
    LANGUAGES.map(({ code, name }) => ({
      label: name,
      checked: code === params.language,
      action: { action: "language", language: code },
    })),
  );
  fillSubmenu(
    autonomy,
    text.autonomy,
    AUTONOMY_LEVELS.map((level) => ({
      label: text.autonomyLevels[level],
      checked: level === params.autonomy,
      action: { action: "autonomy", level },
    })),
  );

  (byId("autostart-label") as HTMLSpanElement).textContent = text.launchAtStartup;
  const launchesAtStartup = await isEnabled();
  setChecked(autostartItem, launchesAtStartup);
  autostartItem.addEventListener("pointerenter", scheduleSubmenuClose);
  autostartItem.addEventListener("click", () => void finish(() => (launchesAtStartup ? disable() : enable())));

  (byId("debug-label") as HTMLSpanElement).textContent = text.debug;
  setChecked(debugItem, params.debug);
  debugItem.addEventListener("pointerenter", scheduleSubmenuClose);
  debugItem.addEventListener("click", () => void choose({ action: "debug" }));

  function moveFocus(container: HTMLElement, step: number) {
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(current + step + buttons.length) % buttons.length]?.focus();
  }

  async function layout() {
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const opensLeft = params.anchorX + menuWidth > params.workRight;
    const opensUp = params.anchorY + menuHeight > params.workBottom;
    const menuLeft = opensLeft ? params.anchorX - menuWidth : params.anchorX;
    const menuTop = Math.max(params.workTop, opensUp ? params.anchorY - menuHeight : params.anchorY);
    const boxes = [{ left: menuLeft, top: menuTop, right: menuLeft + menuWidth, bottom: menuTop + menuHeight }];

    const placed = submenus.map((submenu) => {
      submenu.panel.hidden = false;
      const width = submenu.panel.offsetWidth;
      const height = submenu.panel.offsetHeight;
      submenu.panel.hidden = true;
      const onLeft = menuLeft + menuWidth - SUBMENU_OVERLAP + width > params.workRight;
      const left = onLeft ? menuLeft - width + SUBMENU_OVERLAP : menuLeft + menuWidth - SUBMENU_OVERLAP;
      const top = Math.min(menuTop + submenu.trigger.offsetTop - 5, params.workBottom - height);
      boxes.push({ left, top, right: left + width, bottom: top + height });
      return { submenu, left, top, onLeft };
    });

    const windowLeft = Math.max(params.workLeft, Math.min(...boxes.map((box) => box.left))) - SHADOW_MARGIN;
    const windowTop = Math.min(...boxes.map((box) => box.top)) - SHADOW_MARGIN;
    const windowRight = Math.max(...boxes.map((box) => box.right)) + SHADOW_MARGIN;
    const windowBottom = Math.max(...boxes.map((box) => box.bottom)) + SHADOW_MARGIN;

    menu.style.left = `${menuLeft - windowLeft}px`;
    menu.style.top = `${menuTop - windowTop}px`;
    menu.style.transformOrigin = `${opensLeft ? "right" : "left"} ${opensUp ? "bottom" : "top"}`;
    for (const { submenu, left, top, onLeft } of placed) {
      submenu.panel.style.left = `${left - windowLeft}px`;
      submenu.panel.style.top = `${top - windowTop}px`;
      submenu.panel.style.transformOrigin = `${onLeft ? "right" : "left"} top`;
    }

    const popupWindow = getCurrentWindow();
    await popupWindow.setSize(new LogicalSize(windowRight - windowLeft, windowBottom - windowTop));
    await popupWindow.setPosition(new LogicalPosition(windowLeft, windowTop));
  }

  await layout();

  const submenuOf = (element: Element | null) => submenus.find((submenu) => submenu.panel.contains(element));

  return {
    onKey(event) {
      const activeSubmenu = submenuOf(document.activeElement);
      const triggered = submenus.find((submenu) => submenu.trigger === document.activeElement);
      if (event.key === "Escape") {
        void finish();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveFocus(activeSubmenu?.panel ?? menu, event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "ArrowRight" && triggered !== undefined) {
        openSubmenu(triggered);
        triggered.panel.querySelector<HTMLButtonElement>("button")?.focus();
      } else if (event.key === "ArrowLeft" && activeSubmenu !== undefined) {
        closeSubmenus();
        activeSubmenu.trigger.focus();
      }
    },
    onPointerDown(event) {
      const target = event.target as Node;
      if (!menu.contains(target) && submenuOf(target as Element) === undefined) {
        void finish();
      }
    },
    onBlur() {
      void finish();
    },
  };
}

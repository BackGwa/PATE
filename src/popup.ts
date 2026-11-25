import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "pretendard-jp/dist/web/variable/pretendardvariable-jp-dynamic-subset.css";
import "./popup.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Language } from "./i18n";

const DISMISS_MS = 160;

export function preparePopup(language: Language) {
  document.documentElement.lang = language;
  document.addEventListener("contextmenu", (event) => event.preventDefault());
}

export async function revealPopup() {
  await invoke("show_popup");
  requestAnimationFrame(() => document.body.classList.add("open"));
}

export async function dismissPopup() {
  document.body.classList.remove("open");
  await new Promise((resolve) => setTimeout(resolve, DISMISS_MS));
  await getCurrentWindow().close();
}

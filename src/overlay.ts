import { emitTo } from "@tauri-apps/api/event";
import "./overlay.css";
import { texts } from "./i18n";
import { HEAD_X_RATIO, HEAD_Y_RATIO } from "./look";
import {
  MAX_RADIUS_SLIDER,
  MAX_SCALE_PERCENT,
  MIN_RADIUS,
  MIN_SCALE_PERCENT,
  OVERLAY_END_EVENT,
  OVERLAY_PREVIEW_EVENT,
  OverlayEnd,
  OverlayPreview,
  decodeOverlayParams,
} from "./overlay-protocol";
import { dismissPopup, preparePopup, revealPopup } from "./popup";
import { CELL_HEIGHT, CELL_WIDTH } from "./sheet";

const SCREEN_MARGIN = 8;
const PANEL_GAP = 12;
const LABEL_GAP = 14;
const EDGE_GRAB_DISTANCE = 14;

const params = decodeOverlayParams(location.search);
const text = texts(params.language);
let scale = params.scale;
let radius = params.radius;
let ended = false;

preparePopup(params.language);

const element = <T extends Element>(id: string) => document.getElementById(id) as unknown as T;

function petRect() {
  const width = CELL_WIDTH * scale;
  const height = CELL_HEIGHT * scale;
  return {
    left: params.petCenterX - width / 2,
    top: params.petBottom - height,
    right: params.petCenterX + width / 2,
    bottom: params.petBottom,
    width,
    height,
  };
}

function head() {
  const rect = petRect();
  return { x: rect.left + rect.width * HEAD_X_RATIO, y: rect.top + rect.height * HEAD_Y_RATIO };
}

function insidePet(x: number, y: number) {
  const rect = petRect();
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function place(target: HTMLElement, left: number, top: number) {
  target.style.left = `${clamp(left, SCREEN_MARGIN, innerWidth - target.offsetWidth - SCREEN_MARGIN)}px`;
  target.style.top = `${clamp(top, SCREEN_MARGIN, innerHeight - target.offsetHeight - SCREEN_MARGIN)}px`;
}

function setFill(slider: HTMLInputElement) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  slider.style.setProperty("--fill", `${((Number(slider.value) - min) / (max - min)) * 100}%`);
}

function preview(value: number) {
  const payload: OverlayPreview = { value };
  void emitTo("main", OVERLAY_PREVIEW_EVENT, payload);
}

async function end(commit: boolean) {
  if (ended) {
    return;
  }
  ended = true;
  const payload: OverlayEnd = { commit };
  await emitTo("main", OVERLAY_END_EVENT, payload);
  await dismissPopup();
}

function setupSize() {
  const panel = element<HTMLDivElement>("size-panel");
  const value = element<HTMLOutputElement>("size-value");
  const slider = element<HTMLInputElement>("size-slider");
  slider.setAttribute("aria-label", text.size);
  slider.min = String(MIN_SCALE_PERCENT);
  slider.max = String(MAX_SCALE_PERCENT);
  slider.value = String(Math.round(scale * 100));
  const render = () => {
    setFill(slider);
    value.textContent = `${slider.value}%`;
  };
  slider.addEventListener("input", () => {
    scale = Number(slider.value) / 100;
    render();
    preview(scale);
  });
  panel.hidden = false;
  place(panel, params.petCenterX - panel.offsetWidth / 2, params.petBottom + PANEL_GAP);
  render();
  slider.focus();
  return (target: EventTarget | null, _event: PointerEvent) => panel.contains(target as Node);
}

function setupRadius() {
  const svg = element<SVGSVGElement>("range");
  const outline = element<SVGCircleElement>("range-outline");
  const edge = element<SVGCircleElement>("range-edge");
  const handle = element<SVGCircleElement>("range-handle");
  const label = element<HTMLDivElement>("range-label");
  const value = element<HTMLSpanElement>("range-value");
  const panel = element<HTMLDivElement>("radius-panel");
  const slider = element<HTMLInputElement>("radius-slider");
  const sliderValue = element<HTMLOutputElement>("radius-value");
  slider.setAttribute("aria-label", text.lookRange);
  slider.min = String(MIN_RADIUS);
  slider.max = String(MAX_RADIUS_SLIDER);
  const center = head();
  let angle = 0;
  let dragging = false;

  const render = () => {
    for (const circle of [outline, edge]) {
      circle.setAttribute("cx", String(center.x));
      circle.setAttribute("cy", String(center.y));
      circle.setAttribute("r", String(radius));
    }
    const handleX = center.x + Math.cos(angle) * radius;
    const handleY = center.y + Math.sin(angle) * radius;
    handle.setAttribute("cx", String(handleX));
    handle.setAttribute("cy", String(handleY));
    value.textContent = `${Math.round(radius)}px`;
    slider.value = String(Math.min(radius, MAX_RADIUS_SLIDER));
    setFill(slider);
    sliderValue.textContent = `${Math.round(radius)}px`;
    const labelLeft = Math.cos(angle) >= 0 ? handleX + LABEL_GAP : handleX - LABEL_GAP - label.offsetWidth;
    place(label, labelLeft, handleY - label.offsetHeight / 2);
  };
  const setRadius = (next: number) => {
    radius = Math.max(MIN_RADIUS, Math.round(next));
    render();
    preview(radius);
  };
  const distance = (event: PointerEvent) => Math.hypot(event.clientX - center.x, event.clientY - center.y);
  const nearEdge = (event: PointerEvent) => Math.abs(distance(event) - radius) <= EDGE_GRAB_DISTANCE;

  svg.addEventListener("pointerdown", (event) => {
    if (!nearEdge(event)) {
      return;
    }
    dragging = true;
    svg.setPointerCapture(event.pointerId);
    document.body.style.cursor = "grabbing";
  });
  svg.addEventListener("pointermove", (event) => {
    if (dragging) {
      angle = Math.atan2(event.clientY - center.y, event.clientX - center.x);
      setRadius(distance(event));
      return;
    }
    document.body.style.cursor = nearEdge(event) ? "grab" : "";
  });
  const stopDragging = () => {
    dragging = false;
    document.body.style.cursor = "";
  };
  svg.addEventListener("pointerup", stopDragging);
  svg.addEventListener("pointercancel", stopDragging);
  slider.addEventListener("input", () => setRadius(Number(slider.value)));

  svg.removeAttribute("hidden");
  svg.style.transformOrigin = `${center.x}px ${center.y}px`;
  label.hidden = false;
  panel.hidden = false;
  place(panel, params.petCenterX - panel.offsetWidth / 2, params.petBottom + PANEL_GAP);
  render();
  slider.focus();
  return (target: EventTarget | null, event: PointerEvent) => nearEdge(event) || panel.contains(target as Node);
}

const isControl = params.mode === "size" ? setupSize() : setupRadius();

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    void end(true);
  } else if (event.key === "Escape") {
    void end(false);
  }
});

document.addEventListener("pointerdown", (event) => {
  if (insidePet(event.clientX, event.clientY) || isControl(event.target, event)) {
    return;
  }
  void end(true);
});

await revealPopup();

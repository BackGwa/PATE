import "./debug.css";
import { AutonomyDebug, PetDebug, ViewDebug } from "./popup-protocol";

const ROWS = ["state", "velocity", "support", "walk", "position", "size", "foot", "gaze", "autonomy", "chain", "next"] as const;

type Row = (typeof ROWS)[number];

export class DebugPanel {
  private readonly values = new Map<Row, HTMLElement>();
  private pet: PetDebug | null = null;
  private view: ViewDebug | null = null;

  constructor(readonly element: HTMLElement) {
    for (const row of ROWS) {
      const label = document.createElement("dt");
      label.textContent = row;
      const value = document.createElement("dd");
      value.textContent = "-";
      this.values.set(row, value);
      element.append(label, value);
    }
  }

  setPet(pet: PetDebug) {
    this.pet = pet;
    this.render();
  }

  setView(view: ViewDebug) {
    this.view = view;
    this.render();
  }

  private render() {
    const pet = this.pet;
    const view = this.view;
    if (pet !== null) {
      this.set("state", pet.facing === null ? pet.state : `${pet.state} · ${pet.facing}`);
      this.set("velocity", `${round(pet.vx)}, ${round(pet.vy)} px/s`);
      this.set("support", supportText(pet));
      this.set("walk", pet.walk === null ? "-" : `${round(pet.walk.remaining)}px · edge ${pet.walk.leap ? "leap" : "turn"}`);
      this.set("position", `${round(pet.frame.x)}, ${round(pet.frame.y)}`);
      const scale = view === null ? "" : ` · ${Math.round(view.scale * 100)}%`;
      this.set("size", `${round(pet.frame.width)}×${round(pet.frame.height)}${scale} · ${pet.display_scale}x`);
      this.set("foot", `${round(pet.foot)}`);
    }
    if (view !== null) {
      const direction = view.direction === null ? "idle" : `dir ${view.direction}`;
      this.set("gaze", `${direction} · ${round(view.distance)}/${round(view.radius)}px`);
      this.renderAutonomy(view.autonomy);
    }
  }

  private renderAutonomy(autonomy: AutonomyDebug) {
    const near = autonomy.cursorNear ? " · cursor near" : "";
    this.set("autonomy", `${autonomy.level} · ${autonomy.current ?? "none"}${near}`);
    this.set("chain", autonomy.chain ?? "-");
    this.set("next", autonomy.nextActionInMs === null ? "-" : seconds(autonomy.nextActionInMs));
  }

  private set(row: Row, text: string) {
    const value = this.values.get(row)!;
    value.textContent = text;
    value.title = text;
  }
}

function supportText(pet: PetDebug): string {
  switch (pet.support?.kind) {
    case "floor":
      return "floor";
    case "window":
      return pet.title === null ? `window #${pet.support.id}` : `window · ${pet.title}`;
    default:
      return "-";
  }
}

function round(value: number): number {
  return Math.round(value);
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

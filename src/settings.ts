import { Store, load } from "@tauri-apps/plugin-store";
import { Language } from "./i18n";

export const DEFAULT_SCALE = 1;
export const DEFAULT_LOOK_RADIUS = 360;

export type Settings = {
  scale: number;
  lookRadius: number;
  sheetPath: string | null;
  language: Language | null;
  position: [number, number] | null;
};

const DEFAULTS: Settings = {
  scale: DEFAULT_SCALE,
  lookRadius: DEFAULT_LOOK_RADIUS,
  sheetPath: null,
  language: null,
  position: null,
};

export class SettingsStore {
  private constructor(
    private readonly store: Store,
    readonly values: Settings,
  ) {}

  static async open(): Promise<SettingsStore> {
    const store = await load("settings.json", { defaults: {}, autoSave: 300 });
    const values = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      const stored = await store.get<Settings[typeof key]>(key);
      if (stored !== undefined) {
        Object.assign(values, { [key]: stored });
      }
    }
    return new SettingsStore(store, values);
  }

  async update(changes: Partial<Settings>) {
    Object.assign(this.values, changes);
    for (const [key, value] of Object.entries(changes)) {
      await this.store.set(key, value);
    }
  }
}

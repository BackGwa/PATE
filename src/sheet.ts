import { invoke } from "@tauri-apps/api/core";
import defaultSheetUrl from "./assets/backgwa.png";

export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const COLUMNS = 8;
export const STANDARD_ROWS = 9;
export const LOOK_ROWS = 11;
const ALPHA_THRESHOLD = 16;

export type Sheet = {
  image: ImageBitmap;
  hasLook: boolean;
  footInsetRatio: number;
};

export class SheetSizeError extends Error {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    super(`unexpected sheet size ${width}x${height}`);
  }
}

export async function loadDefaultSheet(): Promise<Sheet> {
  const response = await fetch(defaultSheetUrl);
  return decodeSheet(await response.blob());
}

export async function loadSheetFile(path: string): Promise<Sheet> {
  const bytes = await invoke<ArrayBuffer>("read_sheet", { path });
  return decodeSheet(new Blob([bytes]));
}

async function decodeSheet(blob: Blob): Promise<Sheet> {
  const image = await createImageBitmap(blob);
  const rows = image.height / CELL_HEIGHT;
  if (image.width !== CELL_WIDTH * COLUMNS || (rows !== STANDARD_ROWS && rows !== LOOK_ROWS)) {
    const { width, height } = image;
    image.close();
    throw new SheetSizeError(width, height);
  }
  return {
    image,
    hasLook: rows === LOOK_ROWS,
    footInsetRatio: measureFootInsetRatio(image),
  };
}

function measureFootInsetRatio(image: ImageBitmap): number {
  const canvas = new OffscreenCanvas(CELL_WIDTH, CELL_HEIGHT);
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, CELL_WIDTH, CELL_HEIGHT, 0, 0, CELL_WIDTH, CELL_HEIGHT);
  const { data } = context.getImageData(0, 0, CELL_WIDTH, CELL_HEIGHT);
  for (let row = CELL_HEIGHT - 1; row >= 0; row--) {
    for (let column = 0; column < CELL_WIDTH; column++) {
      if (data[(row * CELL_WIDTH + column) * 4 + 3] > ALPHA_THRESHOLD) {
        return (CELL_HEIGHT - 1 - row) / CELL_HEIGHT;
      }
    }
  }
  return 0;
}

import { Flow } from "./flow";
import type { FlowRequest, FlowResponse } from "./flow-worker";
import { CELL_HEIGHT, CELL_WIDTH, COLUMNS, Sheet } from "./sheet";

type FramePixels = {
  data: Uint8ClampedArray;
  premultiplied: Float32Array;
};

export class FlowMorph {
  private readonly worker = new Worker(new URL("./flow-worker.ts", import.meta.url), { type: "module" });
  private readonly flows = new Map<string, Flow>();
  private readonly pending = new Set<string>();
  private readonly frames = new Map<number, FramePixels>();
  private readonly accumulator = new Float32Array(CELL_WIDTH * CELL_HEIGHT * 4);
  private readonly output = new ImageData(CELL_WIDTH, CELL_HEIGHT);
  private generation = 0;

  constructor(private sheet: Sheet) {
    this.worker.onmessage = (event: MessageEvent<FlowResponse>) => {
      const { key, fx, fy } = event.data;
      if (this.pending.delete(key)) {
        this.flows.set(key, { fx, fy });
      }
    };
  }

  setSheet(sheet: Sheet) {
    this.sheet = sheet;
    this.generation++;
    this.flows.clear();
    this.pending.clear();
    this.frames.clear();
  }

  prepare(pairs: [number, number][]) {
    for (const [from, to] of pairs) {
      this.request(from, to);
    }
  }

  render(from: number, to: number, progress: number): ImageData | null {
    const flow = this.flows.get(this.key(from, to));
    if (flow === undefined) {
      this.request(from, to);
      return null;
    }
    const a = this.pixels(from).premultiplied;
    const b = this.pixels(to).premultiplied;
    this.accumulator.fill(0);
    for (let y = 0; y < CELL_HEIGHT; y++) {
      for (let x = 0; x < CELL_WIDTH; x++) {
        const index = y * CELL_WIDTH + x;
        const dx = flow.fx[index];
        const dy = flow.fy[index];
        this.sample(a, x - progress * dx, y - progress * dy, index * 4, 1 - progress);
        this.sample(b, x + (1 - progress) * dx, y + (1 - progress) * dy, index * 4, progress);
      }
    }
    this.unpremultiply();
    return this.output;
  }

  private key(from: number, to: number) {
    return `${this.generation}:${from}>${to}`;
  }

  private request(from: number, to: number) {
    const key = this.key(from, to);
    if (this.flows.has(key) || this.pending.has(key)) {
      return;
    }
    this.pending.add(key);
    const request: FlowRequest = {
      key,
      from: this.pixels(from).data.slice(),
      to: this.pixels(to).data.slice(),
      width: CELL_WIDTH,
      height: CELL_HEIGHT,
    };
    this.worker.postMessage(request, [request.from.buffer, request.to.buffer]);
  }

  private pixels(sprite: number): FramePixels {
    const cached = this.frames.get(sprite);
    if (cached !== undefined) {
      return cached;
    }
    const canvas = new OffscreenCanvas(CELL_WIDTH, CELL_HEIGHT);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(
      this.sheet.image,
      (sprite % COLUMNS) * CELL_WIDTH,
      Math.floor(sprite / COLUMNS) * CELL_HEIGHT,
      CELL_WIDTH,
      CELL_HEIGHT,
      0,
      0,
      CELL_WIDTH,
      CELL_HEIGHT,
    );
    const data = context.getImageData(0, 0, CELL_WIDTH, CELL_HEIGHT).data;
    const premultiplied = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      premultiplied[i] = data[i] * alpha;
      premultiplied[i + 1] = data[i + 1] * alpha;
      premultiplied[i + 2] = data[i + 2] * alpha;
      premultiplied[i + 3] = data[i + 3];
    }
    const pixels = { data, premultiplied };
    this.frames.set(sprite, pixels);
    return pixels;
  }

  private sample(source: Float32Array, x: number, y: number, offset: number, weight: number) {
    if (x < 0 || y < 0 || x > CELL_WIDTH - 1 || y > CELL_HEIGHT - 1) {
      return;
    }
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, CELL_WIDTH - 1);
    const y1 = Math.min(y0 + 1, CELL_HEIGHT - 1);
    const tx = x - x0;
    const ty = y - y0;
    const w00 = (1 - tx) * (1 - ty) * weight;
    const w10 = tx * (1 - ty) * weight;
    const w01 = (1 - tx) * ty * weight;
    const w11 = tx * ty * weight;
    const i00 = (y0 * CELL_WIDTH + x0) * 4;
    const i10 = (y0 * CELL_WIDTH + x1) * 4;
    const i01 = (y1 * CELL_WIDTH + x0) * 4;
    const i11 = (y1 * CELL_WIDTH + x1) * 4;
    for (let channel = 0; channel < 4; channel++) {
      this.accumulator[offset + channel] +=
        source[i00 + channel] * w00 +
        source[i10 + channel] * w10 +
        source[i01 + channel] * w01 +
        source[i11 + channel] * w11;
    }
  }

  private unpremultiply() {
    const target = this.output.data;
    for (let i = 0; i < target.length; i += 4) {
      const alpha = this.accumulator[i + 3];
      if (alpha <= 0) {
        target[i] = target[i + 1] = target[i + 2] = target[i + 3] = 0;
        continue;
      }
      const scale = 255 / alpha;
      target[i] = this.accumulator[i] * scale;
      target[i + 1] = this.accumulator[i + 1] * scale;
      target[i + 2] = this.accumulator[i + 2] * scale;
      target[i + 3] = alpha;
    }
  }
}

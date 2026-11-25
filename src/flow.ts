const BLOCK = 4;
const WINDOW = 4;
const SEARCH = 9;
const MOTION_PENALTY = 40;
const ALPHA_WEIGHT = 0.6;
const SMOOTHING_PASSES = 2;

type Field = Float32Array<ArrayBuffer>;

export type Flow = {
  fx: Field;
  fy: Field;
};

type Features = {
  luma: Field;
  alpha: Field;
};

function halfFeatures(pixels: Uint8ClampedArray, width: number, height: number): Features {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const luma = new Float32Array(halfWidth * halfHeight);
  const alpha = new Float32Array(halfWidth * halfHeight);
  for (let y = 0; y < halfHeight; y++) {
    for (let x = 0; x < halfWidth; x++) {
      let lumaSum = 0;
      let alphaSum = 0;
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          const i = ((y * 2 + oy) * width + (x * 2 + ox)) * 4;
          const weight = pixels[i + 3] / 255;
          lumaSum += (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) * weight;
          alphaSum += pixels[i + 3];
        }
      }
      luma[y * halfWidth + x] = lumaSum / 4;
      alpha[y * halfWidth + x] = alphaSum / 4;
    }
  }
  return { luma, alpha };
}

function matchBlocks(a: Features, b: Features, halfWidth: number, halfHeight: number) {
  const gridWidth = halfWidth / BLOCK;
  const gridHeight = halfHeight / BLOCK;
  const gx = new Float32Array(gridWidth * gridHeight);
  const gy = new Float32Array(gridWidth * gridHeight);
  const at = (field: Field, x: number, y: number) =>
    x < 0 || y < 0 || x >= halfWidth || y >= halfHeight ? 0 : field[y * halfWidth + x];

  for (let by = 0; by < gridHeight; by++) {
    for (let bx = 0; bx < gridWidth; bx++) {
      const cx = bx * BLOCK + BLOCK / 2;
      const cy = by * BLOCK + BLOCK / 2;
      let coverage = 0;
      for (let y = -WINDOW; y < WINDOW; y++) {
        for (let x = -WINDOW; x < WINDOW; x++) {
          coverage += at(a.alpha, cx + x, cy + y) + at(b.alpha, cx + x, cy + y);
        }
      }
      if (coverage < 1) {
        continue;
      }
      let best = Infinity;
      let bestX = 0;
      let bestY = 0;
      for (let dy = -SEARCH; dy <= SEARCH; dy++) {
        for (let dx = -SEARCH; dx <= SEARCH; dx++) {
          let cost = (Math.abs(dx) + Math.abs(dy)) * MOTION_PENALTY;
          for (let y = -WINDOW; y < WINDOW && cost < best; y++) {
            for (let x = -WINDOW; x < WINDOW; x++) {
              const ax = cx + x;
              const ay = cy + y;
              cost += Math.abs(at(a.luma, ax, ay) - at(b.luma, ax + dx, ay + dy));
              cost += Math.abs(at(a.alpha, ax, ay) - at(b.alpha, ax + dx, ay + dy)) * ALPHA_WEIGHT;
            }
          }
          if (cost < best) {
            best = cost;
            bestX = dx;
            bestY = dy;
          }
        }
      }
      gx[by * gridWidth + bx] = bestX * 2;
      gy[by * gridWidth + bx] = bestY * 2;
    }
  }
  return { gx, gy, gridWidth, gridHeight };
}

function smoothGrid(field: Field, gridWidth: number, gridHeight: number): Field {
  const result = new Float32Array(field.length);
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      let sum = 0;
      let count = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const px = x + ox;
          const py = y + oy;
          if (px < 0 || py < 0 || px >= gridWidth || py >= gridHeight) {
            continue;
          }
          sum += field[py * gridWidth + px];
          count++;
        }
      }
      result[y * gridWidth + x] = sum / count;
    }
  }
  return result;
}

function upsample(field: Field, gridWidth: number, gridHeight: number, width: number, height: number) {
  const result = new Float32Array(width * height);
  const cell = BLOCK * 2;
  for (let y = 0; y < height; y++) {
    const gridY = Math.min(Math.max((y - cell / 2) / cell, 0), gridHeight - 1);
    const y0 = Math.floor(gridY);
    const y1 = Math.min(y0 + 1, gridHeight - 1);
    const ty = gridY - y0;
    for (let x = 0; x < width; x++) {
      const gridX = Math.min(Math.max((x - cell / 2) / cell, 0), gridWidth - 1);
      const x0 = Math.floor(gridX);
      const x1 = Math.min(x0 + 1, gridWidth - 1);
      const tx = gridX - x0;
      const top = field[y0 * gridWidth + x0] * (1 - tx) + field[y0 * gridWidth + x1] * tx;
      const bottom = field[y1 * gridWidth + x0] * (1 - tx) + field[y1 * gridWidth + x1] * tx;
      result[y * width + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return result;
}

export function computeFlow(from: Uint8ClampedArray, to: Uint8ClampedArray, width: number, height: number): Flow {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  let { gx, gy, gridWidth, gridHeight } = matchBlocks(
    halfFeatures(from, width, height),
    halfFeatures(to, width, height),
    halfWidth,
    halfHeight,
  );
  for (let pass = 0; pass < SMOOTHING_PASSES; pass++) {
    gx = smoothGrid(gx, gridWidth, gridHeight);
    gy = smoothGrid(gy, gridWidth, gridHeight);
  }
  return {
    fx: upsample(gx, gridWidth, gridHeight, width, height),
    fy: upsample(gy, gridWidth, gridHeight, width, height),
  };
}

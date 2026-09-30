/**
 * Image work for local OCR: pure JS, no Pillow, ImageMagick or new packages.
 *
 * The problem: a scan carries a dense grey stipple watermark under black type.
 * Blur turns the fine stipple into light grey while the (thicker) type stays
 * dark; a cut between the two leaves clean type. Where the cut goes has to be
 * chosen per page, so this file estimates it from the page's own histogram.
 */

export interface Gray {
  w: number;
  h: number;
  data: Uint8Array;
}

export type Rotation = 0 | 90 | 180 | 270;

/** Parse a binary PGM (P5), which is what `pdftoppm -gray` writes. */
export function parsePgm(buf: Buffer): Gray {
  let pos = 0;
  const isSpace = (b: number) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;
  const token = (): string => {
    for (;;) {
      while (pos < buf.length && isSpace(buf[pos])) pos++;
      if (buf[pos] === 0x23) {
        while (pos < buf.length && buf[pos] !== 0x0a) pos++;
        continue;
      }
      break;
    }
    const start = pos;
    while (pos < buf.length && !isSpace(buf[pos])) pos++;
    return buf.toString("latin1", start, pos);
  };
  if (token() !== "P5") throw new Error("unexpected image format");
  const w = Number(token());
  const h = Number(token());
  const max = Number(token());
  pos++;
  if (!w || !h || max !== 255 || buf.length < pos + w * h) throw new Error("unexpected image data");
  return { w, h, data: new Uint8Array(buf.subarray(pos, pos + w * h)) };
}

/** One separable box blur, edge-clamped. */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const size = radius * 2 + 1;
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / size;
      sum += src[row + Math.min(w - 1, x + radius + 1)] - src[row + Math.max(0, x - radius)];
    }
  }
  const out = new Float32Array(src.length);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / size;
      sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
    }
  }
  return out;
}

/** Gaussian blur (sigma in pixels) as three box passes. */
export function gaussianBlur(img: Gray, sigma: number): Gray {
  const radius = Math.max(1, Math.round((Math.sqrt((4 * sigma * sigma) + 1) - 1) / 2));
  let cur: Float32Array = Float32Array.from(img.data);
  for (let pass = 0; pass < 3; pass++) cur = boxBlur(cur, img.w, img.h, radius);
  const data = new Uint8Array(cur.length);
  for (let i = 0; i < cur.length; i++) data[i] = cur[i] + 0.5;
  return { w: img.w, h: img.h, data };
}

export function histogram(img: Gray): number[] {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < img.data.length; i++) hist[img.data[i]]++;
  return hist;
}

/** Otsu: the grey level that best separates dark from light, and how well. */
export function otsu(hist: number[]): { level: number; variance: number } {
  const total = hist.reduce((s, n) => s + n, 0);
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let w0 = 0;
  let sum0 = 0;
  let best = { level: 128, variance: -1 };
  for (let t = 0; t < 255; t++) {
    w0 += hist[t];
    sum0 += t * hist[t];
    const w1 = total - w0;
    if (!w0 || !w1) continue;
    const m0 = sum0 / w0;
    const m1 = (sumAll - sum0) / w1;
    const variance = (w0 / total) * (w1 / total) * (m0 - m1) ** 2;
    if (variance > best.variance) best = { level: t, variance };
  }
  return best;
}

/** Two cuts, ink | watermark | paper, on a coarse 64-bin histogram. */
export function otsuThreeWay(hist: number[]): { low: number; high: number } {
  const bins = new Array<number>(64).fill(0);
  for (let i = 0; i < 256; i++) bins[i >> 2] += hist[i];
  const total = bins.reduce((s, n) => s + n, 0);
  const cum = new Array<number>(65).fill(0);
  const mom = new Array<number>(65).fill(0);
  for (let i = 0; i < 64; i++) {
    cum[i + 1] = cum[i] + bins[i];
    mom[i + 1] = mom[i] + bins[i] * i;
  }
  const mt = mom[64] / total;
  let best = { v: -1, a: 20, b: 50 };
  for (let a = 1; a < 62; a++) {
    for (let b = a + 1; b < 63; b++) {
      const w0 = cum[a];
      const w1 = cum[b] - cum[a];
      const w2 = total - cum[b];
      if (!w0 || !w1 || !w2) continue;
      const m0 = mom[a] / w0;
      const m1 = (mom[b] - mom[a]) / w1;
      const m2 = (mom[64] - mom[b]) / w2;
      const v = (w0 * (m0 - mt) ** 2 + w1 * (m1 - mt) ** 2 + w2 * (m2 - mt) ** 2) / total;
      if (v > best.v) best = { v, a, b };
    }
  }
  return { low: best.a * 4, high: best.b * 4 };
}

const clampCut = (v: number) => Math.round(Math.min(215, Math.max(80, v)));

/**
 * Cuts to try for one blurred page, best guess first.
 *
 * Otsu is the guess. When the page has hardly any ink the valley is weak and
 * Otsu drifts into the watermark tone, so the lower cut of a three-way split is
 * used instead. The alternates bracket the guess: lighter cuts drop a darker
 * watermark, higher cuts keep faint type.
 */
export function candidateThresholds(blurred: Gray): { first: number; others: number[] } {
  const hist = histogram(blurred);
  const total = blurred.data.length;
  const two = otsu(hist);
  const three = otsuThreeWay(hist);
  const inkShare = (cut: number) => {
    let n = 0;
    for (let i = 0; i <= cut; i++) n += hist[i];
    return n / total;
  };
  const weak = two.variance < 300;
  let first = clampCut(weak ? three.low + 12 : two.level);
  // A page of type has a few percent ink. When the cut lets in far more than
  // that, a heavy watermark is being read as ink (Otsu then splits watermark
  // from paper). Come down to the valley between ink and watermark.
  if (inkShare(first) > MAX_INK_SHARE) {
    first = clampCut(three.low + 8);
    while (first > 90 && inkShare(first) > MAX_INK_SHARE) first = clampCut(first - 10);
  }
  const raw = [(three.low + two.level) / 2, three.low + 6, two.level + 22, three.low - 24, first - 30, first + 25];
  const others: number[] = [];
  for (const value of raw.map(clampCut)) {
    if (Math.abs(value - first) < 8) continue;
    if (others.some((o) => Math.abs(o - value) < 8)) continue;
    others.push(value);
  }
  return { first, others };
}

/** Most of a real page is paper; type is a few percent of it. */
const MAX_INK_SHARE = 0.09;

export interface Bits {
  w: number;
  h: number;
  /** 1 = ink. */
  bits: Uint8Array;
}

/** Threshold to ink bits, optionally rotated clockwise. */
export function binarize(img: Gray, threshold: number, rotation: Rotation = 0): Bits {
  const { w, h, data } = img;
  const turned = rotation === 90 || rotation === 270;
  const ow = turned ? h : w;
  const oh = turned ? w : h;
  const bits = new Uint8Array(ow * oh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] > threshold) continue;
      let nx = x;
      let ny = y;
      if (rotation === 180) {
        nx = w - 1 - x;
        ny = h - 1 - y;
      } else if (rotation === 90) {
        nx = h - 1 - y;
        ny = x;
      } else if (rotation === 270) {
        nx = y;
        ny = w - 1 - x;
      }
      bits[ny * ow + nx] = 1;
    }
  }
  return { w: ow, h: oh, bits };
}

/** Packed 1-bit PBM (P4), which tesseract reads from stdin. Ink is black. */
export function toPbm(img: Bits): Buffer {
  const header = Buffer.from(`P4\n${img.w} ${img.h}\n`, "latin1");
  const stride = (img.w + 7) >> 3;
  const body = Buffer.alloc(stride * img.h);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.bits[y * img.w + x]) body[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, body]);
}

export function inkFraction(bits: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bits.length; i++) n += bits[i];
  return n / bits.length;
}

/** Test helper: grey page with dark type-like strokes and a grey stipple overlay. */
export function syntheticPage(opts: { w?: number; h?: number; stipple: number; density?: number; ink?: number; paper?: number; seed?: number }): Gray {
  const w = opts.w ?? 600;
  const h = opts.h ?? 400;
  const ink = opts.ink ?? 10;
  const paper = opts.paper ?? 255;
  let seed = opts.seed ?? 1;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const data = new Uint8Array(w * h).fill(paper);
  // Diagonal stipple: sparse single dots along diagonal bands.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const band = ((x + y) % 40) < 14;
      if (band && rand() < (opts.density ?? 0.35)) data[y * w + x] = opts.stipple;
    }
  }
  // "Type": thick horizontal strokes in rows, 4 px tall.
  for (let row = 0; row < 8; row++) {
    const top = 30 + row * 42;
    for (let seg = 0; seg < 12; seg++) {
      const left = 40 + seg * 44;
      for (let y = top; y < top + 5; y++) for (let x = left; x < left + 30; x++) data[y * w + x] = ink;
    }
  }
  return { w, h, data };
}

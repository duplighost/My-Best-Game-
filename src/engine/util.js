// util.js — math, RNG, and noise. Zero dependencies, deterministic everywhere.
// Everything in the world is seeded so the same coordinate always yields the
// same hill, the same tree, the same secret. That is what makes an infinite
// place feel like a real place instead of a slot machine.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// Frame-rate independent exponential damping. `rate` is responsiveness (1/s).
export const damp = (current, target, rate, dt) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

// Critically-ish damped spring step. Returns [newValue, newVelocity].
export function spring(value, target, vel, stiffness, damping, dt) {
  const f = -stiffness * (value - target);
  const d = -damping * vel;
  vel += (f + d) * dt;
  value += vel * dt;
  return [value, vel];
}

export const mix3 = (out, a, b, t) => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
};

// ---------------------------------------------------------------------------
// RNG: mulberry32, tiny and fast and good enough for a dream.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic 2D integer hash -> [0,1). Used as the seed for everything
// placed at a coordinate (which tree, which secret, which color jitter).
export function hash2(x, y, salt = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (salt | 0) * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
export function hashInt(x, y, salt = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (salt | 0) * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// Value noise (smooth, cheap, analytic) with fbm. Continuous everywhere so we
// can sample terrain height at any float coordinate with no chunk seams.
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1; // [-1,1]
}

export function fbm(x, y, { octaves = 4, freq = 1, lacunarity = 2, gain = 0.5, seed = 1337 } = {}) {
  let amp = 0.5, f = freq, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x * f, y * f, seed + o * 101);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm; // [-1,1]
}

// Ridged noise for mountain spines — sharp peaks, soft valleys.
export function ridged(x, y, { octaves = 4, freq = 1, seed = 99 } = {}) {
  let amp = 0.5, f = freq, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(vnoise(x * f, y * f, seed + o * 53));
    n *= n;
    sum += amp * n;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm; // [0,1]
}

// Domain warp: feed noise coordinates through noise so biomes/terrain get
// that organic, swirling, non-griddy continental shape.
export function warp2(x, y, amount, seed) {
  const wx = fbm(x * 0.5 + 5.2, y * 0.5 + 1.3, { octaves: 3, seed: seed + 11 });
  const wy = fbm(x * 0.5 + 9.7, y * 0.5 + 4.8, { octaves: 3, seed: seed + 23 });
  return [x + wx * amount, y + wy * amount];
}

// Cheap 0..1 cell value for "scatter one thing per grid cell" decisions.
export const cell01 = (cx, cy, salt) => hash2(cx, cy, salt);

// Pick from array deterministically.
export const pick = (arr, r) => arr[Math.min(arr.length - 1, (r * arr.length) | 0)];

// Angle helpers
export const shortestAngle = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

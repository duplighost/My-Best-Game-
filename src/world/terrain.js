// terrain.js — the ground itself. climate() decides which biomes blend at a
// point; heightAt() is analytic so the mesh you see and the floor you walk on
// are always the same surface; rivers are carved globally so water threads
// through forest and plain alike.
import * as THREE from 'three';
import { fbm, ridged, clamp, clamp01, lerp, smoothstep } from '../engine/util.js';
import { BIOMES, BIOME_KEYS, WATER_LEVEL } from './biomes.js';

export const CHUNK = 52;       // world units per chunk
export const RES = 22;         // grid subdivisions per chunk

// biome centers in (temperature, moisture) space
const CENTERS = {
  meadow: [0.0, 0.05],
  forest: [0.15, 0.72],
  desert: [0.62, -0.62],
  snow: [-0.72, 0.08],
};

export class Terrain {
  constructor(seed) {
    this.seed = seed | 0;
  }

  // ---- climate: returns blended biome weights at a world point ----
  climate(x, z) {
    const s = this.seed;
    // continental coords + domain warp for organic regions. Frequency chosen so
    // biomes are big enough to immerse in but small enough that wandering keeps
    // turning up somewhere new.
    let cx = x * 0.0026, cz = z * 0.0026;
    cx += fbm(cx * 1.4 + 11, cz * 1.4, { octaves: 2, seed: s + 1 }) * 0.7;
    cz += fbm(cx * 1.4, cz * 1.4 + 7, { octaves: 2, seed: s + 2 }) * 0.7;
    const temp = fbm(cx, cz, { octaves: 3, seed: s + 100 });
    const moist = fbm(cx + 40, cz - 20, { octaves: 3, seed: s + 200 });

    const w = { meadow: 0, forest: 0, desert: 0, snow: 0, city: 0, hollow: 0, shrine: 0 };
    for (const k in CENTERS) {
      const c = CENTERS[k];
      const dt = temp - c[0], dm = moist - c[1];
      w[k] = Math.exp(-(dt * dt + dm * dm) / 0.42);
    }
    // special pockets — neon city, haunted hollow, sacred ground. More frequent
    // than the naturals are rare, so there's always a destination on the horizon.
    const cityF = fbm(x * 0.0016 + 5, z * 0.0016, { octaves: 2, seed: s + 300 });
    const hollowF = fbm(x * 0.0019 - 7, z * 0.0019, { octaves: 2, seed: s + 400 });
    const shrineF = fbm(x * 0.0022 + 3, z * 0.0022 - 9, { octaves: 2, seed: s + 500 });
    const cityS = smoothstep(0.42, 0.60, cityF);
    const hollowS = smoothstep(0.48, 0.64, hollowF);
    const shrineS = smoothstep(0.64, 0.78, shrineF);
    const suppress = clamp01(cityS + hollowS + shrineS);
    for (const k in CENTERS) w[k] *= (1 - suppress);
    w.city = cityS * 1.4;
    w.hollow = hollowS * 1.4;
    w.shrine = shrineS * 1.6;

    let sum = 0;
    for (const k in w) sum += w[k];
    if (sum < 1e-5) { w.meadow = 1; sum = 1; }
    let dom = 'meadow', domW = -1;
    for (const k in w) { w[k] /= sum; if (w[k] > domW) { domW = w[k]; dom = k; } }
    return { temp, moist, w, dom, domW };
  }

  // river mask 0..1 (1 at river center). Suppressed in desert/city.
  riverMask(x, z, naturalWeight) {
    const r = fbm(x * 0.0042 + 11, z * 0.0042, { octaves: 2, seed: this.seed + 600 });
    const channel = 1 - smoothstep(0.0, 0.05, Math.abs(r));
    return channel * naturalWeight;
  }

  heightFromClimate(x, z, cl) {
    const w = cl.w;
    let h = 0;
    for (const k of BIOME_KEYS) {
      const wi = w[k];
      if (wi > 0.001) h += wi * BIOMES[k].height(x, z, this.seed);
    }
    const naturalW = w.meadow + w.forest + w.snow * 0.4;
    const rm = this.riverMask(x, z, naturalW);
    if (rm > 0.001) h = lerp(h, Math.min(h, WATER_LEVEL - 1.4), clamp01(rm));
    return h;
  }

  heightAt(x, z) {
    return this.heightFromClimate(x, z, this.climate(x, z));
  }

  slopeAt(x, z) {
    const e = 1.2;
    const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e);
    return Math.hypot(hR - hL, hU - hD) / (2 * e);
  }

  _hexColor(out, hex) {
    out.set((hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255);
    return out;
  }

  // allocation-free blended terrain color written into out[0..2]
  colorNumeric(x, z, h, slope, cl, out) {
    const w = cl.w;
    const detail = 0.5 + fbm(x * 0.11, z * 0.11, { octaves: 2, seed: this.seed + 17 }) * 0.5;
    // bias toward the richer low/mid tones; the pale high color only at altitude
    let f0 = clamp01(detail * 0.5 + clamp01((h - 3) / 30) * 0.5);
    f0 = f0 * f0 * (3 - 2 * f0); // smootherstep keeps mids from washing out
    let r = 0, g = 0, b = 0, tot = 0;
    for (const k of BIOME_KEYS) {
      const wi = w[k];
      if (wi < 0.02) continue;
      const B = BIOMES[k];
      let c1, c2, t;
      if (k === 'snow' && slope > 0.85 && B.rock) { c1 = B.rock; c2 = B.rock; t = 0; }
      else if (k === 'snow') { c1 = B.colLow; c2 = B.colHigh; t = clamp01(f0); }
      else if (f0 < 0.5) { c1 = B.colLow; c2 = B.colMid; t = f0 * 2; }
      else { c1 = B.colMid; c2 = B.colHigh; t = (f0 - 0.5) * 2; }
      let cr = lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t) / 255;
      let cg = lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t) / 255;
      let cb = lerp(c1 & 255, c2 & 255, t) / 255;
      if (k !== 'snow' && slope > 0.9) { cr *= 0.7; cg *= 0.7; cb *= 0.7; }
      r += cr * wi; g += cg * wi; b += cb * wi; tot += wi;
    }
    if (tot > 0) { r /= tot; g /= tot; b /= tot; }
    if (h < WATER_LEVEL + 0.4) { r *= 0.5; g *= 0.6; b *= 0.7; }
    out[0] = r; out[1] = g; out[2] = b;
  }

  buildTerrainMesh(cx, cz, material) {
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const n = RES + 1;
    const verts = n * n;
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const idx = [];
    let minH = Infinity, maxH = -Infinity;
    const step = CHUNK / RES;
    // pass 1: positions, heights, climate (one climate() per vertex)
    const H = new Float32Array(verts);
    const cls = new Array(verts);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = ox + i * step, z = oz + j * step;
        const cl = this.climate(x, z);
        const h = this.heightFromClimate(x, z, cl);
        const k = j * n + i;
        H[k] = h; cls[k] = cl;
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        if (h < minH) minH = h; if (h > maxH) maxH = h;
      }
    }
    // pass 2: slope from neighbour heights + color (no extra climate calls)
    const out = [0, 0, 0];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const il = i > 0 ? k - 1 : k, ir = i < n - 1 ? k + 1 : k;
        const jd = j > 0 ? k - n : k, ju = j < n - 1 ? k + n : k;
        const sx = (H[ir] - H[il]) / (step * ((i > 0 && i < n - 1) ? 2 : 1));
        const sz = (H[ju] - H[jd]) / (step * ((j > 0 && j < n - 1) ? 2 : 1));
        const slope = Math.hypot(sx, sz);
        const x = ox + i * step, z = oz + j * step;
        this.colorNumeric(x, z, H[k], slope, cls[k], out);
        col[k * 3] = out[0]; col[k * 3 + 1] = out[1]; col[k * 3 + 2] = out[2];
      }
    }
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return { mesh, minH, maxH };
  }
}

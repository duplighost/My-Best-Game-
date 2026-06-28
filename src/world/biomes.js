// biomes.js — the seven moods of the world. Each one is a different texture of
// feeling: the luminous plains you wake in, a warm sunken desert with an oasis,
// a deep glowing forest cut by rivers, a quiet nostalgic snow under the aurora,
// an endless neon city, a haunted hollow, and the rare sacred ground.
//
// Palettes deliberately avoid red-vs-green as a carrier of meaning (brightness,
// shape and cool/warm do the work instead), so the world reads cleanly for
// green-spectrum color vision.
import { fbm, ridged, clamp01, lerp } from '../engine/util.js';

export const WATER_LEVEL = 0.0;

// height functions take world coords + the world seed.
export const BIOMES = {
  meadow: {
    key: 'meadow', name: 'The Luminous Plains',
    blurb: 'Soft hills of glassgrass that light where you step.',
    height: (x, z, s) => 6 + fbm(x * 0.012, z * 0.012, { octaves: 4, seed: s }) * 5
                          + fbm(x * 0.05, z * 0.05, { octaves: 2, seed: s + 7 }) * 1.2,
    colLow: 0x1b234e, colMid: 0x305a82, colHigh: 0x5b86bc, accent: 0x6cf0d6,
    env: { horizon: 0xf0a074, zenith: 0x232a64, ground: 0x121430, sunCol: 0xffd9a0,
           fog: 0x4a4e88, fogDensity: 0.005, hemiSky: 0x95a8d8, hemiGround: 0x2a2240,
           sunI: 1.7, hemiI: 0.85, auroraTarget: 0.06 },
    music: 0.45,
  },
  desert: {
    key: 'desert', name: 'The Warm Expanse',
    blurb: 'Slow dunes and a single oasis that remembers rain.',
    height: (x, z, s) => 5 + fbm(x * 0.008, z * 0.008, { octaves: 3, seed: s + 31 }) * 7
                          + Math.sin(x * 0.02 + fbm(x*0.01,z*0.01,{seed:s+3})*3) * 1.4,
    colLow: 0xc1924f, colMid: 0xe0bd76, colHigh: 0xf6e4ac, accent: 0xffce6a,
    env: { horizon: 0xffcaa0, zenith: 0x5a74c0, ground: 0x6a4e2e, sunCol: 0xfff0c4,
           fog: 0xe9c79a, fogDensity: 0.0035, hemiSky: 0xfff0d0, hemiGround: 0x6a4a2a,
           sunI: 3.0, hemiI: 1.5, auroraTarget: 0.0 },
    music: 0.3,
  },
  forest: {
    key: 'forest', name: 'The Deep Glow',
    blurb: 'Tall light-bearing trees and cold rivers between them.',
    height: (x, z, s) => 4.2 + fbm(x * 0.014, z * 0.014, { octaves: 4, seed: s + 51 }) * 6
                          + fbm(x * 0.06, z * 0.06, { octaves: 2, seed: s + 9 }) * 1.6,
    colLow: 0x16332e, colMid: 0x265c4a, colHigh: 0x69b08c, accent: 0x49ffce,
    env: { horizon: 0x2f8f8a, zenith: 0x10243a, ground: 0x09140f, sunCol: 0xbfeec0,
           fog: 0x123a36, fogDensity: 0.012, hemiSky: 0x9fe6d0, hemiGround: 0x10241c,
           sunI: 1.5, hemiI: 1.1, auroraTarget: 0.05 },
    music: 0.5,
  },
  snow: {
    key: 'snow', name: 'The Quiet Cold',
    blurb: 'Nostalgic snow, frozen water, peaks worth the climb.',
    height: (x, z, s) => 8 + ridged(x * 0.01, z * 0.01, { octaves: 4, seed: s + 71 }) * 30
                          + fbm(x * 0.03, z * 0.03, { octaves: 3, seed: s + 13 }) * 2.4,
    colLow: 0x9fb3da, colMid: 0xd7e6ff, colHigh: 0xffffff, accent: 0xbdeeff, rock: 0x4a5570,
    env: { horizon: 0xbfe0ff, zenith: 0x213a72, ground: 0x2a3358, sunCol: 0xeaf4ff,
           fog: 0xaac6ee, fogDensity: 0.006, hemiSky: 0xdcebff, hemiGround: 0x3a4a72,
           sunI: 2.0, hemiI: 1.5, auroraTarget: 0.42 },
    music: 0.6,
  },
  city: {
    key: 'city', name: 'The Endless City',
    blurb: 'Neon towers, grind-lines, a whole second world overhead.',
    height: (x, z, s) => 7 + fbm(x * 0.01, z * 0.01, { octaves: 2, seed: s + 91 }) * 2.0,
    colLow: 0x141a2e, colMid: 0x1c2746, colHigh: 0x33457a, accent: 0x63f7ff,
    env: { horizon: 0x7a3fb0, zenith: 0x090a1e, ground: 0x0a0c1a, sunCol: 0xff86d8,
           fog: 0x16183a, fogDensity: 0.0075, hemiSky: 0x8aa0ff, hemiGround: 0x1a1030,
           sunI: 1.3, hemiI: 1.05, auroraTarget: 0.18 },
    music: 0.8,
  },
  hollow: {
    key: 'hollow', name: 'The Haunted Hollow',
    blurb: 'Dead light, drifting fog, a house that wants you inside.',
    height: (x, z, s) => 3 + fbm(x * 0.016, z * 0.016, { octaves: 4, seed: s + 41 }) * 4.2,
    colLow: 0x14101c, colMid: 0x241b2e, colHigh: 0x3c3048, accent: 0x9a7dff, lantern: 0xffcf85,
    env: { horizon: 0x3a2350, zenith: 0x0a0712, ground: 0x070409, sunCol: 0x9a7dff,
           fog: 0x140e1e, fogDensity: 0.02, hemiSky: 0x4a3a66, hemiGround: 0x0a0710,
           sunI: 0.5, hemiI: 0.8, auroraTarget: 0.0 },
    music: 0.35,
  },
  shrine: {
    key: 'shrine', name: 'The Still Ground',
    blurb: 'Where the light that watches the world goes to rest.',
    height: (x, z, s) => 6 + fbm(x * 0.02, z * 0.02, { octaves: 3, seed: s + 5 }) * 2.0,
    colLow: 0x2a2440, colMid: 0x4a416e, colHigh: 0xe8dcff, accent: 0xffe9a8,
    env: { horizon: 0xffe6c0, zenith: 0x2a2456, ground: 0x191333, sunCol: 0xfff2d0,
           fog: 0x4a3f72, fogDensity: 0.006, hemiSky: 0xeadfff, hemiGround: 0x2a2050,
           sunI: 2.2, hemiI: 1.6, auroraTarget: 0.3 },
    music: 0.55,
  },
};

export const BIOME_KEYS = Object.keys(BIOMES);

// Smoothly blend two env descriptors by t.
export function blendEnv(a, b, t) {
  const out = {};
  const cL = (x, y) => {
    const ar = (x >> 16) & 255, ag = (x >> 8) & 255, ab = x & 255;
    const br = (y >> 16) & 255, bg = (y >> 8) & 255, bb = y & 255;
    const r = Math.round(lerp(ar, br, t)), g = Math.round(lerp(ag, bg, t)), bl = Math.round(lerp(ab, bb, t));
    return (r << 16) | (g << 8) | bl;
  };
  for (const k of ['horizon', 'zenith', 'ground', 'sunCol', 'fog', 'hemiSky', 'hemiGround']) out[k] = cL(a[k], b[k]);
  for (const k of ['fogDensity', 'sunI', 'hemiI', 'auroraTarget']) out[k] = lerp(a[k], b[k], t);
  return out;
}

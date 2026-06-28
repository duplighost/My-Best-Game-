// save.js — local progress only. No servers, no accounts. Your Atlas, your
// settings, and the seed of your world live in this browser.
const KEY = 'reverie.save.v1';

const DEFAULT = {
  seed: 0, // 0 => load() assigns the warm default world seed
  settings: { quality: 'auto', sensitivity: 1.0, invertY: false, reducedMotion: false, muted: false },
  progress: {
    glimmers: 0, memories: 0, relics: 0, distance: 0, deepest: 0,
    abilities: { doubleDash: false, longGlide: false, fastGrind: false },
    boons: {},                      // id -> level, chosen when a Memory is kept
    bossesFelled: 0,
    seenBiomes: [], seenCreatures: [], seenEnemies: [], foundLandmarks: [],
  },
  firstRun: true,
};

export const Save = {
  load() {
    let data;
    try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) { data = null; }
    if (!data) data = JSON.parse(JSON.stringify(DEFAULT));
    if (!data.seed || typeof data.seed !== 'number') data.seed = 1993 * 7919 + 28; // a fixed, warm default world
    // merge missing keys
    data.settings = Object.assign({}, DEFAULT.settings, data.settings || {});
    data.progress = Object.assign({}, DEFAULT.progress, data.progress || {});
    data.progress.abilities = Object.assign({}, DEFAULT.progress.abilities, data.progress.abilities || {});
    data.progress.boons = data.progress.boons || {};
    if (typeof data.progress.bossesFelled !== 'number') data.progress.bossesFelled = 0;
    for (const k of ['seenBiomes', 'seenCreatures', 'seenEnemies', 'foundLandmarks']) if (!Array.isArray(data.progress[k])) data.progress[k] = [];
    return data;
  },
  save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  },
  reset() { try { localStorage.removeItem(KEY); } catch (e) {} },
};

// hud.js — the read-out. Deliberately quiet: a soft reticle, a light meter, a
// combo that only shows when it matters, counts in the corner, a whisper of a
// compass toward the nearest landmark, and floating numbers that rise off what
// you touch. Plus the Atlas — the record of everywhere you've been.
import * as THREE from 'three';
import { clamp, clamp01, lerp } from '../engine/util.js';
import { BIOMES } from '../world/biomes.js';

const CREATURE_NAMES = { driftjelly: 'Driftbell', grazer: 'Lumegrazer', school: 'Mote-school' };
const ENEMY_NAMES = { husk: 'Husk', sentinel: 'Sentinel', chorus: 'Chorus', wraith: 'Wraith' };
const ENEMY_DESC = {
  husk: 'A hollow shape that hoards the light it takes. Break it and the light comes back.',
  sentinel: 'A patient eye that keeps its distance and throws slow fire. Dash its shots.',
  chorus: 'A core wearing a ring of voices. Take the voices and it goes quiet.',
  wraith: 'Fast, thin, and certain. It comes straight for you.',
};
const CREATURE_DESC = {
  driftbell: 'Drifts the high air. Scatters when you move fast.',
  driftjelly: 'Drifts the high air. Scatters when you move fast.',
  grazer: 'Wanders the ground, grazing the glassgrass. Skittish.',
  school: 'A handful of motes that move as one.',
};

export class HUD {
  constructor(el) {
    this.el = el;
    this.popups = [];
    this.q = (s) => el.querySelector(s);
    this.reticle = this.q('#reticle');
    this.lightFill = this.q('#lightFill');
    this.comboEl = this.q('#combo');
    this.comboNum = this.q('#comboNum');
    this.countGlimmer = this.q('#cGlimmer');
    this.countMemory = this.q('#cMemory');
    this.biomeName = this.q('#biomeName');
    this.biomeBlurb = this.q('#biomeBlurb');
    this.compass = this.q('#compass');
    this.compassLabel = this.q('#compassLabel');
    this.prompt = this.q('#prompt');
    this.bossBar = this.q('#bossBar');
    this.bossName = this.q('#bossName');
    this.bossFill = this.q('#bossFill');
    this.toastEl = this.q('#toast');
    this.flashEl = this.q('#flash');
    this.popLayer = this.q('#popLayer');
    this._comboT = 0; this._toastT = 0; this._biomeT = 0; this._lastBiome = '';
    this._flash = 0; this._flashColor = '#ffffff';
  }

  setLight(t) { if (this.lightFill) this.lightFill.style.width = (clamp01(t) * 100).toFixed(1) + '%'; }

  setCounters(g, m) {
    if (this.countGlimmer) this.countGlimmer.textContent = g;
    if (this.countMemory) this.countMemory.textContent = m;
  }

  setCombo(n) {
    if (n <= 1) { this.comboEl.classList.remove('show'); return; }
    this.comboNum.textContent = '×' + n;
    this.comboEl.classList.add('show', 'pop');
    this._comboT = 1.6;
    setTimeout(() => this.comboEl.classList.remove('pop'), 120);
  }

  setBiome(key) {
    if (key === this._lastBiome) return;
    this._lastBiome = key;
    const b = BIOMES[key]; if (!b) return;
    this.biomeName.textContent = b.name;
    this.biomeBlurb.textContent = b.blurb;
    this.biomeName.parentElement.classList.remove('show'); void this.biomeName.offsetWidth;
    this.biomeName.parentElement.classList.add('show');
    this._biomeT = 4.5;
  }

  setBoss(name, frac) {
    if (!this.bossBar) return;
    this.bossBar.classList.add('show');
    this.bossName.textContent = name;
    this.bossFill.style.width = (clamp01(frac) * 100).toFixed(1) + '%';
  }
  clearBoss() { if (this.bossBar) this.bossBar.classList.remove('show'); }

  setPrompt(text) {
    if (!text) { this.prompt.classList.remove('show'); return; }
    this.prompt.textContent = text; this.prompt.classList.add('show');
  }

  toast(text, dur = 4) {
    this.toastEl.textContent = text; this.toastEl.classList.add('show'); this._toastT = dur;
  }

  flash(color, strength) { this._flash = Math.max(this._flash, strength); this._flashColor = color; }

  popup(worldPos, text, color, big = false) {
    const d = document.createElement('div');
    d.className = 'pop' + (big ? ' big' : '');
    d.textContent = text; d.style.color = color;
    this.popLayer.appendChild(d);
    this.popups.push({ el: d, pos: worldPos.clone(), t: big ? 1.4 : 0.9, life: big ? 1.4 : 0.9, vy: 0 });
  }

  setCompass(camera, target, name) {
    if (!target) { this.compass.classList.remove('show'); return; }
    this.compass.classList.add('show');
    this.compassLabel.textContent = name || '';
    // angle of target relative to camera forward (yaw only)
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    const yaw = Math.atan2(fwd.x, fwd.z);
    const toT = Math.atan2(target.x - camera.position.x, target.z - camera.position.z);
    let rel = toT - yaw;
    while (rel > Math.PI) rel -= Math.PI * 2; while (rel < -Math.PI) rel += Math.PI * 2;
    // place the marker horizontally based on rel angle, clamp to edges
    const px = clamp(rel / (Math.PI * 0.7), -1, 1);
    this.compass.style.transform = `translateX(${px * 42}vw)`;
    const dist = Math.hypot(target.x - camera.position.x, target.z - camera.position.z);
    this.compass.style.opacity = clamp01(1 - dist / 400) * 0.9 + 0.1;
  }

  update(dt, camera, renderer) {
    // combo timeout
    if (this._comboT > 0) { this._comboT -= dt; if (this._comboT <= 0) this.comboEl.classList.remove('show'); }
    if (this._toastT > 0) { this._toastT -= dt; if (this._toastT <= 0) this.toastEl.classList.remove('show'); }
    if (this._biomeT > 0) { this._biomeT -= dt; if (this._biomeT <= 0) this.biomeName.parentElement.classList.remove('show'); }
    // flash
    if (this._flash > 0.001) {
      this._flash = lerp(this._flash, 0, clamp(dt * 5, 0, 1));
      this.flashEl.style.background = this._flashColor;
      this.flashEl.style.opacity = this._flash.toFixed(3);
    } else if (this.flashEl.style.opacity !== '0') this.flashEl.style.opacity = '0';
    // popups
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t -= dt; p.pos.y += dt * 1.4;
      if (p.t <= 0) { p.el.remove(); this.popups.splice(i, 1); continue; }
      const v = p.pos.clone().project(camera);
      if (v.z > 1) { p.el.style.opacity = '0'; continue; }
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const f = p.t / p.life;
      p.el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) scale(${0.8 + f * 0.4})`;
      p.el.style.opacity = clamp01(f * 1.4).toFixed(2);
    }
  }

  // ---------- Atlas ----------
  buildAtlas(progress) {
    const wrap = document.getElementById('atlasBody');
    const biomeKeys = Object.keys(BIOMES);
    const seenB = new Set(progress.seenBiomes);
    const seenC = new Set(progress.seenCreatures);
    const seenE = new Set(progress.seenEnemies);
    const found = new Set(progress.foundLandmarks);
    const card = (title, sub, found, color) => `<div class="acard ${found ? 'found' : 'unfound'}">
      <div class="adot" style="background:${found ? color : '#2a2f44'}"></div>
      <div class="atitle">${found ? title : '— — —'}</div>
      <div class="asub">${found ? sub : 'undiscovered'}</div></div>`;
    let html = '';
    html += `<h3>Lands <span>${seenB.size}/${biomeKeys.length}</span></h3><div class="agrid">`;
    for (const k of biomeKeys) html += card(BIOMES[k].name, BIOMES[k].blurb, seenB.has(k), '#' + BIOMES[k].accent.toString(16).padStart(6, '0'));
    html += '</div>';
    html += `<h3>Things that mean you harm <span>${seenE.size}/${Object.keys(ENEMY_NAMES).length}</span></h3><div class="agrid">`;
    for (const k in ENEMY_NAMES) html += card(ENEMY_NAMES[k], ENEMY_DESC[k], seenE.has(k), '#cfe0ff');
    html += '</div>';
    html += `<h3>Gentle things <span>${seenC.size}/${Object.keys(CREATURE_NAMES).length}</span></h3><div class="agrid">`;
    for (const k in CREATURE_NAMES) html += card(CREATURE_NAMES[k], CREATURE_DESC[k] || '', seenC.has(k), '#9ff0c8');
    html += '</div>';
    const lm = { house: 'A House That Waited', cabin: 'A Cabin in the Cold Woods', spire: 'The Listening Spire', oasis: 'The Oasis That Remembers', shrine: 'Where the Watcher Rests', tree: 'The Tree That Holds the Light', door: 'A Door to Nowhere', monument: 'The Monument of Quiet' };
    html += `<h3>Places found <span>${found.size}/${Object.keys(lm).length}</span></h3><div class="agrid">`;
    for (const k in lm) html += card(lm[k], 'a landmark', found.has(k), '#ffe9a8');
    html += '</div>';
    html += `<div class="astats">light gathered: <b>${progress.glimmers}</b> · memories kept: <b>${progress.memories}</b> · charms: <b>${progress.relics}</b> · the Keeper felled: <b>${progress.bossesFelled || 0}</b> · farthest from where you woke: <b>${Math.round(progress.deepest)}m</b></div>`;
    wrap.innerHTML = html;
  }
}

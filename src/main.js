// main.js — Reverie. An endless world you fall into. This file is the spine:
// it builds every system, runs the loop, moves the sun, blends each biome's sky,
// and keeps the small handful of gameplay numbers (your light, your combo, the
// places you've found) that turn wandering into a game you want to keep playing.
import * as THREE from 'three';
import { Renderer } from './engine/render.js';
import { Input } from './engine/input.js';
import { FX } from './engine/fx.js';
import { Audio } from './engine/audio.js';
import { Save } from './engine/save.js';
import { clamp, clamp01, lerp, damp } from './engine/util.js';
import { World } from './world/world.js';
import { Decorator } from './world/decorate.js';
import { BIOMES, BIOME_KEYS } from './world/biomes.js';
import { CameraRig } from './player/camera.js';
import { Controller } from './player/controller.js';
import { Entities } from './entities/entities.js';
import { HUD } from './ui/hud.js';

const MAX_LIGHT = 100;

// Boons — chosen one at a time, each time a Memory is kept. The "build" that
// makes you want to keep wandering. Named softly, in Reverie's voice.
const BOONS = [
  { id: 'glide', name: 'Lighter Step', desc: 'your glide carries you farther' },
  { id: 'airdash', name: 'Second Wind', desc: 'one more dash, in the air' },
  { id: 'dash', name: 'Quicker Light', desc: 'your dash returns to you sooner' },
  { id: 'magnet', name: 'Open Hands', desc: 'light drifts to you from farther' },
  { id: 'pulse', name: 'Brighter Send', desc: 'the light you send strikes harder' },
  { id: 'maxlight', name: 'Deeper Well', desc: 'you can hold more light' },
  { id: 'sense', name: 'Keener Sense', desc: 'sense farther, and more often' },
  { id: 'rail', name: 'Truer Rails', desc: 'the grind-lines run faster under you' },
  { id: 'jump', name: 'Longer Reach', desc: 'you leap a little higher' },
];

class Game {
  constructor() {
    this.save = Save.load();
    this.quality = this._resolveQuality(this.save.settings.quality);
    this.canvas = document.getElementById('game');
    this.r = new Renderer(this.canvas, this.quality);
    this.scene = this.r.scene;
    this.input = new Input(this.canvas);
    this.input.sensitivity = 0.0022 * this.save.settings.sensitivity;
    this.input.touchLookScale = 0.0042 * this.save.settings.sensitivity;
    this.input.invertY = this.save.settings.invertY;
    this.audio = new Audio();
    this.audio.muted = this.save.settings.muted;

    this.world = new World(this.save.seed, this.quality, this.r.anisotropy);
    this.world.decorator = new Decorator(this.world);
    this.scene.add(this.world.root);

    this.fx = new FX(this.scene, this.quality === 'low' ? 1200 : 2400);
    this.rig = new CameraRig(this.r.camera);
    this.rig.reducedMotion = this.save.settings.reducedMotion;
    this.controller = new Controller(this.world, this.rig);
    Object.assign(this.controller.abilities, this.save.progress.abilities);

    this.entities = new Entities({
      world: this.world, scene: this.scene, fx: this.fx, audio: this.audio,
      rig: this.rig, controller: this.controller,
      damagePlayer: (a, p) => this._damage(a, p),
      onKill: (e) => this._onKill(e),
      onCollect: (c) => this._onCollect(c),
      onSeen: (kind, key, name) => this._onSeen(kind, key, name),
      onBossSpawn: (b) => this._onBossSpawn(b),
      onBossHp: (name, frac) => this.hud.setBoss(name, frac),
      onBossDeath: (pos) => this._onBossDeath(pos),
    });

    this.hud = new HUD(document.getElementById('hud'));
    this.fx.popup = (p, t, c, big) => this.hud.popup(p, t, c, big);
    this.fx.flash = (c, s) => this.hud.flash(c, s);

    this.state = 'loading';
    this.time = 0;
    this.dayTime = 0.18;          // 0..1 around the clock; start at dawn
    this.maxLight = MAX_LIGHT;
    this.light = MAX_LIGHT;
    this.senseRadius = 36;
    this.senseCdMax = 1.5;
    this._senseCd = 0;
    this.combo = 0; this.comboT = 0;
    this.spawn = new THREE.Vector3();
    this.fading = false; this.fadeT = 0;
    this._saveT = 0;
    this._fwd = new THREE.Vector3();
    this._envAccum = {};
    this._tutorialStep = 0;
    this._lastLandmark = null;
    this._homeNearPos = null;
    this._homeMusicT = 0;
    this._crackleT = 0;
    this._dayF = 1;
    this._bossCd = 25;     // grace before The Keeper can first wake

    this.applyBoons();
    this._bindUI();
    this._placePlayer();
    this._preload();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    window.addEventListener('resize', () => this._layoutMobile());
    this._layoutMobile();
  }

  _resolveQuality(pref) {
    if (pref && pref !== 'auto') return pref;
    const touch = matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    if (touch) return cores >= 8 && mem >= 6 ? 'medium' : 'low';
    return cores >= 8 ? 'high' : 'medium';
  }

  _placePlayer() {
    // find pleasant non-water ground near origin
    let best = new THREE.Vector3(0, 0, 0), found = false;
    for (let i = 0; i < 40 && !found; i++) {
      const a = i * 2.4, rad = i * 6;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const cl = this.world.climate(x, z);
      const h = this.world.groundHeight(x, z);
      if (h > 1 && this.world.slope(x, z) < 0.6 && (cl.dom === 'meadow' || cl.dom === 'forest' || cl.dom === 'snow' || cl.dom === 'desert')) {
        best.set(x, h, z); found = true;
      }
    }
    if (!found) best.set(0, Math.max(2, this.world.groundHeight(0, 0)), 0);
    this.spawn.copy(best);
    this.controller.reset(best.x, best.y, best.z);
    this.rig.cam.position.set(best.x, best.y + 1.6, best.z);
  }

  _preload() {
    // build the chunks immediately around spawn so the first frame isn't empty
    for (let i = 0; i < 8; i++) this.world.update(this.controller.pos, 0.016, 14);
    const fill = document.getElementById('loadFill');
    if (fill) fill.style.width = '100%';
    setTimeout(() => { this._toTitle(); }, 350);
  }

  _toTitle() {
    this.state = 'title';
    document.getElementById('loading').classList.remove('active');
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('title').classList.remove('hidden');
    document.getElementById('title').classList.add('active');
    this._refreshSaveChip();
  }

  _refreshSaveChip() {
    const chip = document.getElementById('saveChip');
    const p = this.save.progress;
    if (chip) chip.textContent = (p.glimmers || p.memories) ? `light gathered: ${p.glimmers} · memories: ${p.memories}` : 'a new world';
  }

  _bindUI() {
    const start = () => this._play();
    document.getElementById('playBtn').addEventListener('click', start);
    // quality buttons
    document.querySelectorAll('#qualityRow .qbtn').forEach((b) => {
      b.classList.toggle('on', b.dataset.q === this.save.settings.quality);
      b.addEventListener('click', () => {
        document.querySelectorAll('#qualityRow .qbtn').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        this.save.settings.quality = b.dataset.q; Save.save(this.save);
        document.getElementById('reloadNote').classList.add('show');
      });
    });
    // sliders / toggles
    const sens = document.getElementById('sensRange');
    if (sens) { sens.value = this.save.settings.sensitivity; sens.addEventListener('input', () => {
      this.save.settings.sensitivity = parseFloat(sens.value);
      this.input.sensitivity = 0.0022 * this.save.settings.sensitivity;
      this.input.touchLookScale = 0.0042 * this.save.settings.sensitivity; Save.save(this.save);
    }); }
    const inv = document.getElementById('invertY');
    if (inv) { inv.checked = this.save.settings.invertY; inv.addEventListener('change', () => { this.save.settings.invertY = inv.checked; this.input.invertY = inv.checked; Save.save(this.save); }); }
    const rm = document.getElementById('reducedMotion');
    if (rm) { rm.checked = this.save.settings.reducedMotion; rm.addEventListener('change', () => { this.save.settings.reducedMotion = rm.checked; this.rig.reducedMotion = rm.checked; Save.save(this.save); }); }
    const mute = document.getElementById('muteToggle');
    if (mute) { mute.checked = this.save.settings.muted; mute.addEventListener('change', () => { this.save.settings.muted = mute.checked; this.audio.setMuted(mute.checked); Save.save(this.save); }); }

    document.getElementById('resumeBtn').addEventListener('click', () => this._resume());
    document.getElementById('atlasBtn').addEventListener('click', () => this._openAtlas());
    document.getElementById('titleBtn').addEventListener('click', () => this._toTitleFromPause());
    document.getElementById('atlasClose').addEventListener('click', () => this._closeAtlas());
    const reset = document.getElementById('resetBtn');
    if (reset) reset.addEventListener('click', () => { if (confirm('Forget this world and everything found in it?')) { Save.reset(); location.reload(); } });

    // pointer lock change -> pause only if we actually held lock and then lost it
    // (prevents a pause-loop when the browser declines the initial lock request)
    this._wasLocked = false;
    this.input.onLockChange = (locked) => {
      if (locked) this._wasLocked = true;
      else if (this._wasLocked && this.state === 'playing' && !this.input.isTouch) { this._wasLocked = false; this._pause(); }
    };

    // mobile buttons
    this.input.bindButton(document.getElementById('tJump'), 'jump');
    this.input.bindButton(document.getElementById('tDash'), 'dash', true);
    this.input.bindButton(document.getElementById('tPulse'), 'pulse');
    this.input.bindButton(document.getElementById('tSense'), 'interact', true);
    this.input.bindButton(document.getElementById('tSprint'), 'sprint');
    const stickBase = document.getElementById('stickBase'), stickKnob = document.getElementById('stickKnob');
    this.input.onStickStart = (x, y) => { if (stickBase) { stickBase.style.left = x + 'px'; stickBase.style.top = y + 'px'; stickBase.classList.add('show'); } };
    this.input.onStickMove = (x, y) => { if (stickKnob) { stickKnob.style.left = x + 'px'; stickKnob.style.top = y + 'px'; } };
    this.input.onStickEnd = () => { if (stickBase) stickBase.classList.remove('show'); };
    if (this.input.isTouch) document.getElementById('mobileControls').classList.add('touch');
  }

  _play() {
    this.audio.start(); this.audio.resume();
    document.getElementById('title').classList.add('hidden');
    document.getElementById('title').classList.remove('active');
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('hud').classList.add('show');
    this.state = 'playing';
    if (!this.input.isTouch) this.input.requestLock();
    if (this.save.firstRun || this._tutorialStep === 0) { this._startTutorial(); }
  }
  _pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    document.getElementById('pause').classList.remove('hidden');
    document.getElementById('pause').classList.add('active');
    this._writeSave();
  }
  _resume() {
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('pause').classList.remove('active');
    this.state = 'playing';
    if (!this.input.isTouch) this.input.requestLock();
    this.audio.resume();
  }
  _openAtlas() {
    this.hud.buildAtlas(this.save.progress);
    document.getElementById('atlas').classList.remove('hidden');
    document.getElementById('atlas').classList.add('active');
    this.state = 'atlas';
  }
  _closeAtlas() {
    document.getElementById('atlas').classList.add('hidden');
    document.getElementById('atlas').classList.remove('active');
    this.state = 'paused';
  }
  _toTitleFromPause() {
    this._writeSave();
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('hud').classList.remove('show');
    this._toTitle();
  }

  _startTutorial() {
    this._tutorialStep = 1;
    const t = this.input.isTouch
      ? 'left thumb to move · right thumb to look · find the light'
      : 'move with WASD · look with the mouse · find the light';
    this.hud.toast(t, 6);
    setTimeout(() => { if (this.state === 'playing') this.hud.toast(this.input.isTouch ? 'tap DASH to surge — it pulls toward what matters' : 'press Q to dash · hold Space in the air to glide', 6); }, 7000);
    setTimeout(() => { if (this.state === 'playing') this.hud.toast(this.input.isTouch ? 'tap SENSE to find what the world is hiding' : 'F send light · E sense hidden things · J Atlas', 6); }, 14000);
    this.save.firstRun = false; this._writeSave();
  }

  // ---------- gameplay events ----------
  _damage(amount, pos) {
    if (this.fading || this.controller.iframes > 0) return;
    this.light = Math.max(0, this.light - amount);
    this.combo = 0; this.comboT = 0; this.hud.setCombo(0);
    this.rig.addShake(0.5);
    this.hud.flash('#3a0f2a', 0.4);
    this.audio.damage();
    if (this.light <= 0) this._beginFade();
  }
  _beginFade() {
    this.fading = true; this.fadeT = 1.4;
    this.hud.flash('#ffffff', 0.0);
    this.hud.toast('the light went out of you — but the world keeps its place', 4);
  }
  _respawn() {
    // return to spawn (or nearest safe), keep all progress
    this._placePlayer();
    this.light = this.maxLight * 0.7;
    this.fading = false;
    this.entities.clear();
  }
  _onKill(e) {
    this.combo++; this.comboT = 2.2;
    this.hud.setCombo(this.combo);
    this.audio.combo(this.combo);
    // combos restore a piece of light (not the whole thing)
    const restore = 4 + this.combo;
    this.light = Math.min(this.maxLight, this.light + restore);
    this.hud.popup(e.pos.clone().setY(e.pos.y + 1.2), '+' + restore, '#9ff0ff');
    this._addSeen('seenEnemies', e.type);
  }
  _onCollect(c) {
    if (c.kind === 'glimmer') {
      this.save.progress.glimmers++;
      this.light = Math.min(this.maxLight, this.light + 2);
      this.audio.pickup('glimmer');
      this.hud.popup(new THREE.Vector3(c.x, c.baseY + 0.6, c.z), '+1', '#9ff0ff');
    } else if (c.kind === 'memory') {
      this.save.progress.memories++;
      this.light = this.maxLight;
      this.audio.memory();
      this.hud.flash('#ffe9a8', 0.5);
      this.hud.popup(new THREE.Vector3(c.x, c.baseY + 0.8, c.z), 'a memory kept', '#ffe9a8', true);
      this.hud.toast('a memory kept — keep one thing of it', 3);
      setTimeout(() => { if (this.state === 'playing') this.openBoonChoice(); }, 650);
    } else if (c.kind === 'relic') {
      this.save.progress.relics++;
      if (c.ability) { this.controller.abilities[c.ability] = true; this.save.progress.abilities[c.ability] = true; }
      this.audio.pickup('relic');
      this.hud.flash('#9ff0ff', 0.5);
      const msg = c.ability === 'doubleDash' ? 'you can dash again in the air' : c.ability === 'longGlide' ? 'your glide carries you farther' : c.ability === 'fastGrind' ? 'the rails run faster under you' : 'something changed';
      this.hud.popup(new THREE.Vector3(c.x, c.baseY + 0.9, c.z), c.name || 'a charm', '#9ff0ff', true);
      this.hud.toast(msg, 5);
    }
    this.hud.setCounters(this.save.progress.glimmers, this.save.progress.memories);
    this._writeSave();
  }
  _onSeen(kind, key, name) {
    if (kind === 'enemy') this._addSeen('seenEnemies', key);
    else this._addSeen('seenCreatures', key);
  }
  _addSeen(list, key) {
    if (!this.save.progress[list].includes(key)) { this.save.progress[list].push(key); this._writeSave(); }
  }

  // ---------- boons (the build) ----------
  applyBoons() {
    const bo = this.save.progress.boons || {};
    const lvl = (id) => bo[id] || 0;
    const ab = this.controller.abilities;
    this.maxLight = MAX_LIGHT + lvl('maxlight') * 25;
    if (this.light > this.maxLight) this.light = this.maxLight;
    this.controller.tune.dashCd = Math.pow(0.86, lvl('dash'));
    this.controller.tune.jump = 1 + lvl('jump') * 0.11;
    this.controller.tune.glide = lvl('glide') + (ab.longGlide ? 1 : 0);
    this.controller.tune.rail = (1 + lvl('rail') * 0.12) * (ab.fastGrind ? 1.18 : 1);
    this.controller.maxAirDash = 1 + lvl('airdash') + (ab.doubleDash ? 1 : 0);
    this.entities.magnetMul = 1 + lvl('magnet') * 0.5;
    this.entities.pulseDmg = 1 + lvl('pulse') * 0.5;
    this.senseRadius = 36 + lvl('sense') * 14;
    this.senseCdMax = Math.max(0.5, 1.5 * Math.pow(0.82, lvl('sense')));
  }

  openBoonChoice() {
    const bo = this.save.progress.boons;
    const pool = BOONS.filter((b) => (bo[b.id] || 0) < 6);
    for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const choices = pool.slice(0, 3);
    if (!choices.length) return;
    this.state = 'boon';
    this.audio.boon();
    if (!this.input.isTouch) this.input.exitLock();
    const wrap = document.getElementById('boonCards'); wrap.innerHTML = '';
    choices.forEach((b) => {
      const have = bo[b.id] || 0;
      const card = document.createElement('button');
      card.className = 'booncard';
      card.innerHTML = `<div class="bcname">${b.name}</div><div class="bcdesc">${b.desc}</div>` + (have ? `<div class="bclvl">kept ×${have}</div>` : '');
      card.addEventListener('click', () => this._chooseBoon(b.id));
      wrap.appendChild(card);
    });
    document.getElementById('boon').classList.remove('hidden');
    document.getElementById('boon').classList.add('active');
  }
  _chooseBoon(id) {
    const bo = this.save.progress.boons;
    bo[id] = (bo[id] || 0) + 1;
    this.applyBoons();
    this._writeSave();
    document.getElementById('boon').classList.add('hidden');
    document.getElementById('boon').classList.remove('active');
    this.state = 'playing';
    this.hud.flash('#ffe9a8', 0.3);
    if (!this.input.isTouch) this.input.requestLock();
  }

  // ---------- the boss ----------
  _onBossSpawn(b) {
    this.audio.bossCry();
    this.rig.addShake(0.6);
    this.hud.setBoss(b.name, 1);
    this.hud.toast('something old has woken — break its lanterns, then its heart', 6);
  }
  _onBossDeath(pos) {
    this.hud.clearBoss();
    this.hud.flash('#ffe9a8', 0.6);
    this.save.progress.bossesFelled = (this.save.progress.bossesFelled || 0) + 1;
    this.save.progress.memories++;
    this.hud.setCounters(this.save.progress.glimmers, this.save.progress.memories);
    this.hud.popup(pos.clone().setY(pos.y + 4), 'the Keeper is at rest', '#ffe9a8', true);
    this.hud.toast('the Keeper is at rest — it leaves you a memory', 5);
    this.audio.memory();
    this._writeSave();
    setTimeout(() => { if (this.state === 'playing') this.openBoonChoice(); }, 1000);
    this._bossCd = 150;
  }
  _maybeWakeBoss(cl, realDt) {
    this._bossCd = Math.max(0, this._bossCd - realDt);
    if (this.entities.boss || this._bossCd > 0) return;
    if (!cl || cl.dom !== 'hollow' || this._dayF > 0.42) return;        // hollow, at night
    if (Math.random() < realDt * 0.07) {
      const a = this.rig.yaw;   // spawn it ahead of you (where you're looking)
      const sx = this.controller.pos.x - Math.sin(a) * 32, sz = this.controller.pos.z - Math.cos(a) * 32;
      const sy = this.world.groundHeight(sx, sz);
      if (sy > 0.5) this.entities.spawnBoss(sx, sy, sz);
    }
  }

  _maybeStorm(hollowW, realDt) {
    if (hollowW < 0.5 || this._dayF > 0.62) { this._stormT = 6 + Math.random() * 6; return; }
    this._stormT = (this._stormT || 8) - realDt;
    if (this._stormT <= 0) {
      this._stormT = 7 + Math.random() * 12;
      this.hud.flash('#e8f0ff', 0.55);
      setTimeout(() => this.hud.flash('#cfe0ff', 0.32), 95);
      setTimeout(() => this.audio.thunder(), 400 + Math.random() * 1500);
    }
  }

  _doSense() {
    if (this._senseCd > 0 || this.state !== 'playing') return;
    this._senseCd = this.senseCdMax;
    this.audio.sense();
    this.rig.addFovPunch(3);
    const n = this.entities.sense(this.controller.pos, this.senseRadius);
    if (n > 0) {
      this.audio.reveal();
      this.hud.flash('#bfe6ff', 0.16);
      this.hud.popup(new THREE.Vector3(this.controller.pos.x, this.controller.pos.y + 1.7, this.controller.pos.z), n === 1 ? 'something hidden' : n + ' hidden things', '#bfe6ff', true);
    }
  }

  _writeSave() {
    this.save.progress.distance = Math.round(this.save.progress.distance);
    Save.save(this.save);
  }

  // ---------- per-frame env ----------
  _updateEnv(dt, playerPos) {
    // sun position from day time
    this.dayTime = (this.dayTime + dt / 220) % 1; // ~3.7 min day
    const ang = this.dayTime * Math.PI * 2;
    const sunY = Math.sin(ang);
    const sunDir = this._fwd.set(Math.cos(ang) * 0.6, Math.max(-0.3, sunY), Math.sin(ang * 0.7) * 0.6).normalize();
    const dayF = clamp01(sunY * 1.4 + 0.35); // 0 night .. 1 day
    this._dayF = dayF;

    // blend biome env by weights at the player
    const cl = this.world.climate(playerPos.x, playerPos.z);
    const acc = { horizon: [0, 0, 0], zenith: [0, 0, 0], ground: [0, 0, 0], sunCol: [0, 0, 0], fog: [0, 0, 0], hemiSky: [0, 0, 0], hemiGround: [0, 0, 0], fogDensity: 0, sunI: 0, hemiI: 0, auroraTarget: 0 };
    let tot = 0;
    const addCol = (arr, hex, w) => { arr[0] += ((hex >> 16) & 255) * w; arr[1] += ((hex >> 8) & 255) * w; arr[2] += (hex & 255) * w; };
    for (const k of BIOME_KEYS) {
      const w = cl.w[k]; if (w < 0.02) continue;
      const e = BIOMES[k].env;
      addCol(acc.horizon, e.horizon, w); addCol(acc.zenith, e.zenith, w); addCol(acc.ground, e.ground, w);
      addCol(acc.sunCol, e.sunCol, w); addCol(acc.fog, e.fog, w); addCol(acc.hemiSky, e.hemiSky, w); addCol(acc.hemiGround, e.hemiGround, w);
      acc.fogDensity += e.fogDensity * w; acc.sunI += e.sunI * w; acc.hemiI += e.hemiI * w; acc.auroraTarget += e.auroraTarget * w;
      tot += w;
    }
    if (tot < 1e-3) tot = 1;
    const toHex = (arr) => (Math.round(clamp(arr[0] / tot, 0, 255)) << 16) | (Math.round(clamp(arr[1] / tot, 0, 255)) << 8) | Math.round(clamp(arr[2] / tot, 0, 255));
    // night darkens colors and lifts aurora
    const nightMul = lerp(0.32, 1, dayF);
    const scale = (hex, m) => (((Math.min(255, ((hex >> 16) & 255) * m)) | 0) << 16) | (((Math.min(255, ((hex >> 8) & 255) * m)) | 0) << 8) | ((Math.min(255, (hex & 255) * m)) | 0);
    const env = {
      horizon: scale(toHex(acc.horizon), lerp(0.5, 1.05, dayF)),
      zenith: scale(toHex(acc.zenith), lerp(0.35, 1, dayF)),
      ground: toHex(acc.ground),
      sunCol: toHex(acc.sunCol),
      fog: scale(toHex(acc.fog), nightMul),
      hemiSky: scale(toHex(acc.hemiSky), nightMul),
      hemiGround: toHex(acc.hemiGround),
      fogDensity: acc.fogDensity / tot,
      sunI: (acc.sunI / tot) * clamp01(dayF * 0.92 + 0.05),
      hemiI: (acc.hemiI / tot) * lerp(0.45, 0.82, dayF),
      auroraTarget: (acc.auroraTarget / tot) + (1 - dayF) * 0.35,
    };
    this.r.setSky(env);
    this.r.update(dt, this.time, playerPos, sunDir);

    // audio mood
    const danger = clamp01(this.entities.enemies.length / 6);
    this.audio.setBiome(cl.dom, danger * 0.5);
    this.hud.setBiome(cl.dom);
    if (!this.save.progress.seenBiomes.includes(cl.dom)) this._addSeen('seenBiomes', cl.dom);

    // weather: rain in the hollow, god-rays through the forest canopy by day
    const hollowW = cl.w.hollow || 0, forestW = cl.w.forest || 0;
    this.r.setWeather(hollowW, clamp01((forestW - 0.35) * 2) * dayF * 0.34);
    this.audio.setRain(hollowW * 0.9);
    this._maybeStorm(hollowW, dt);
    return cl;
  }

  _checkLandmarks(playerPos) {
    let nearest = null, nd = Infinity, enter = null;
    let home = null, homeD = Infinity;
    for (const it of this.world.interiorTriggers) {
      const d = Math.hypot(it.x - playerPos.x, it.z - playerPos.z);
      if (d < nd) { nd = d; nearest = it; }
      if (d < 6 && Math.abs(it.y - playerPos.y) < 14) enter = it;
      if ((it.key === 'house' || it.key === 'cabin') && d < homeD && d < 12) { homeD = d; home = it; }
    }
    // a home you're inside keeps its music box turning
    this._homeNearPos = home ? new THREE.Vector3(home.x, home.y + 1.4, home.z) : null;
    // compass to the nearest landmark (gentle)
    this.hud.setCompass(this.rig.cam, nearest && nd < 380 ? nearest : null, nearest ? nearest.name : '');
    if (enter && enter.key !== this._lastLandmark) {
      this._lastLandmark = enter.key;
      const fresh = !this.save.progress.foundLandmarks.includes(enter.key);
      if (fresh) {
        this.save.progress.foundLandmarks.push(enter.key);
        this.audio.enter();
        this.hud.flash('#ffffff', 0.18);
        this.hud.toast('you found ' + enter.name.toLowerCase(), 4);
        this._writeSave();
      }
      if (enter.key === 'house' || enter.key === 'cabin') {
        this.audio.musicBox(new THREE.Vector3(enter.x, enter.y + 1.4, enter.z));
        this._homeMusicT = 19;
        if (fresh) this.hud.toast('someone lived here, once', 4.5);
      }
    } else if (!enter) {
      if (nd > 12) this._lastLandmark = null;
    }
  }

  _layoutMobile() {
    // nothing dynamic needed; CSS handles it. placeholder for safe-area tweaks.
  }

  // ---------- main loop ----------
  _loop(now) {
    requestAnimationFrame(this._loop);
    const realDt = clamp((now - (this._last || now)) / 1000, 0, 0.05);
    this._last = now;
    this.time += realDt;

    if (this.state === 'playing') this._stepPlaying(realDt);
    else if (this.state === 'paused' || this.state === 'atlas' || this.state === 'boon') {
      // keep the world gently breathing behind the menu
      this.r.update(realDt, this.time, this.controller.pos, this._fwd);
      this.world.materials.update(realDt * 0.2);
    }
    this.r.render();
  }

  _stepPlaying(realDt) {
    const input = this.input;
    input.beginFrame();
    // look first (always responsive)
    const look = input.consumeLook();
    this.rig.processLook(look);

    const scale = this.fx.consumeTimeScale(realDt);
    const gdt = realDt * scale;

    // stream world (more budget while moving fast / first seconds)
    this.world.update(this.controller.pos, gdt || 0.0001, this.quality === 'high' ? 5 : 3.5);

    if (gdt > 0) {
      const before = this.controller.pos.clone();
      const ev = this.controller.update(gdt, input, this.rig.yaw);
      this._handleMoveEvents(ev);
      // distance from spawn
      const dFromSpawn = this.controller.pos.distanceTo(this.spawn);
      this.save.progress.distance += before.distanceTo(this.controller.pos);
      if (dFromSpawn > this.save.progress.deepest) this.save.progress.deepest = dFromSpawn;

      this.entities.update(gdt, realDt, this.controller.pos, this.rig.yaw);
    }

    // pulse attack + sense
    if (input.justPressed('pulse')) this.entities.pulse(this.rig.yaw, this.rig.pitch);
    if (input.justPressed('interact')) this._doSense();
    if (input.justPressed('atlas')) this._openAtlas();
    if (input.justPressed('pause')) this._pause();
    this._senseCd = Math.max(0, this._senseCd - realDt);

    // camera + env + audio
    this.rig.update(realDt, this.controller, input, this.fx);
    const cl = this._updateEnv(realDt, this.controller.pos);
    this._maybeWakeBoss(cl, realDt);
    this.rig.forwardFlat(this._fwd);
    this.audio.setListener(this.rig.cam.position, this._fwd);
    this.audio.update(realDt);

    // combo decay
    if (this.comboT > 0) { this.comboT -= realDt; if (this.comboT <= 0 && this.combo > 0) { this.combo = 0; this.hud.setCombo(0); } }

    // light slowly returns in safe biomes
    if (this.entities.enemies.length === 0 && this.light < this.maxLight) this.light = Math.min(this.maxLight, this.light + realDt * 3);
    this.hud.setLight(this.light / this.maxLight);

    // landmarks + compass
    this._checkLandmarks(this.controller.pos);
    // a hint when the world is hiding something near you (Sense to reveal it)
    if (this._senseCd <= 0 && this.entities.hiddenNear(this.controller.pos, this.senseRadius * 1.5))
      this.hud.setPrompt(this.input.isTouch ? 'tap SENSE — something is hidden near' : 'press E to sense — something is hidden near');
    else this.hud.setPrompt(null);
    // the music box turns again now and then while you linger in a home
    if (this._homeNearPos) {
      this._homeMusicT -= realDt;
      if (this._homeMusicT <= 0) { this.audio.musicBox(this._homeNearPos); this._homeMusicT = 17 + Math.random() * 9; }
      this._crackleT -= realDt;
      if (this._crackleT <= 0) { this.audio.crackle(this._homeNearPos); this._crackleT = 0.9 + Math.random() * 1.8; }
    }

    // fade/respawn
    if (this.fading) {
      this.fadeT -= realDt;
      this.hud.flash('#06040b', clamp01(1 - this.fadeT / 1.4));
      if (this.fadeT <= 0) { this._respawn(); this.hud.flash('#ffffff', 0.6); }
    }

    this.fx.update(realDt);
    this.hud.update(realDt, this.rig.cam, this.r.renderer);

    // periodic save
    this._saveT -= realDt;
    if (this._saveT <= 0) { this._saveT = 6; this._writeSave(); }

    input.endFrame();
  }

  _handleMoveEvents(ev) {
    if (ev.jumped) this.audio.jump();
    if (ev.dashed) { this.audio.dash(); this.fx.burst(this.controller.pos.x, this.controller.pos.y + 1, this.controller.pos.z, 0x9ff0ff, 10, { spread: 3, life: 0.4, dir: this._fwd, dirSpeed: -6 }); }
    if (ev.landed) { this.audio.land(ev.landed); this.rig.dipVel += ev.landed * 9; this.fx.burst(this.controller.pos.x, this.controller.pos.y + 0.1, this.controller.pos.z, 0xcfe0ff, 6, { spread: 3, up: 0.5, life: 0.4 }); }
    if (ev.grindStart) this.audio.rail();
    if (ev.launch) { this.fx.ring(this.controller.pos.x, this.controller.pos.y, this.controller.pos.z, 0x63f7ff, 16, 0.8, 8); }
    if (ev.glideStart) this.fx.burst(this.controller.pos.x, this.controller.pos.y, this.controller.pos.z, 0x9ff0ff, 6, { spread: 2, life: 0.5 });
    // footstep particles handled by step accumulator? simple: occasional on ground at speed
  }
}

window.addEventListener('DOMContentLoaded', () => { window.__game = new Game(); });

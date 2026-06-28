// audio.js — every sound is synthesized at runtime; no files to load. A slow
// four-voice pad gives each biome its own air, footsteps pitch to the ground
// you're on, and combat/pickup tones are short and bright so the world stays
// dreamlike rather than noisy. World sounds are panned by where they happen.
import { clamp, lerp } from './util.js';

const BIOME_FILTER = { meadow: 560, desert: 460, forest: 420, snow: 720, city: 900, hollow: 300, shrine: 640 };
const BIOME_ROOT = { meadow: 110, desert: 98, forest: 92, snow: 130, city: 87, hollow: 73, shrine: 146 };

export class Audio {
  constructor() {
    this.ctx = null; this.master = null; this.started = false; this.muted = false;
    this.pad = []; this.listener = { x: 0, y: 0, z: 0, fx: 0, fz: 1 };
    this._targetFilter = 560; this._targetGain = 0.5; this._stepClock = 0;
  }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    this.padFilter = this.ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 560; this.padFilter.Q.value = 0.5;
    this.padGain = this.ctx.createGain(); this.padGain.gain.value = 0.16;
    this.padFilter.connect(this.padGain); this.padGain.connect(this.master);

    const voices = [[1, 'sine', 0.5], [1.5, 'triangle', 0.22], [2, 'sine', 0.14], [3, 'sine', 0.08]];
    this._root = 110;
    for (const [mult, type, g] of voices) {
      const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
      osc.type = type; osc.frequency.value = this._root * mult; gain.gain.value = g;
      osc.connect(gain); gain.connect(this.padFilter); osc.start();
      this.pad.push({ osc, gain, mult });
    }
    this.started = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.1); }

  setListener(pos, fwd) { this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z; this.listener.fx = fwd.x; this.listener.fz = fwd.z; }

  setBiome(dom, intensity = 0) {
    this._targetFilter = (BIOME_FILTER[dom] || 560) + intensity * 600;
    const root = BIOME_ROOT[dom] || 110;
    if (this.pad.length) for (const p of this.pad) p.osc.frequency.setTargetAtTime(root * p.mult, this.ctx.currentTime, 0.6);
  }

  update(dt) {
    if (!this.started) return;
    const cur = this.padFilter.frequency.value;
    this.padFilter.frequency.value = lerp(cur, this._targetFilter, clamp(dt * 1.2, 0, 1));
  }

  _pan(pos) {
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
    const dist = Math.hypot(dx, dz);
    const atten = clamp(1 / (1 + dist * dist * 0.012), 0, 1);
    const rx = -this.listener.fz, rz = this.listener.fx;
    const side = dist > 0.01 ? clamp((dx * rx + dz * rz) / dist, -1, 1) : 0;
    return { atten, side };
  }

  _tone(freq, dur, type, gain, bend, pos) {
    if (!this.started || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); const g = this.ctx.createGain(); const filt = this.ctx.createBiquadFilter();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (bend) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t + dur);
    filt.type = 'lowpass'; filt.frequency.value = 3200;
    let outGain = gain;
    let node = g;
    osc.connect(filt); filt.connect(g);
    if (pos) {
      const { atten, side } = this._pan(pos);
      outGain *= atten;
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = side; g.connect(pan); pan.connect(this.master); }
      else g.connect(this.master);
    } else g.connect(this.master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, outGain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  _noise(dur, gain, pos) {
    if (!this.started || this.muted) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = gain;
    const filt = this.ctx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = 800;
    src.connect(filt); filt.connect(g);
    if (pos) { const { atten, side } = this._pan(pos); g.gain.value = gain * atten; const pan = this.ctx.createStereoPanner && this.ctx.createStereoPanner(); if (pan) { pan.pan.value = side; g.connect(pan); pan.connect(this.master); } else g.connect(this.master); }
    else g.connect(this.master);
    src.start(t);
  }

  // ---- events ----
  footstep(dom) { const f = dom === 'snow' ? 150 : dom === 'city' ? 100 : 90; this._tone(f, 0.05, 'sine', 0.04, 0.8); this._noise(0.03, 0.015); }
  jump() { this._tone(220, 0.16, 'sine', 0.05, 2.0); }
  land(s) { this._tone(120, 0.14, 'sine', clamp(0.03 + s * 0.05, 0.02, 0.1), 0.5); this._noise(0.05, 0.02 + s * 0.03); }
  dash() { this._tone(180, 0.22, 'sawtooth', 0.06, 2.4); this._noise(0.12, 0.03); }
  shoot() { this._tone(720, 0.07, 'triangle', 0.04, 1.7); }
  enemyShoot(pos) { this._tone(300, 0.18, 'sawtooth', 0.05, 0.6, pos); }
  hit(pos) { this._tone(180, 0.1, 'square', 0.04, 0.7, pos); }
  kill(pos) { this._tone(330, 0.18, 'triangle', 0.06, 1.8, pos); this._tone(495, 0.22, 'sine', 0.04, 1.6, pos); }
  damage() { this._tone(90, 0.22, 'sawtooth', 0.08, 0.5); this._noise(0.1, 0.05); }
  pickup(kind) {
    if (kind === 'glimmer') this._tone(620 + Math.random() * 180, 0.12, 'sine', 0.05, 1.5);
    else { this._tone(330, 0.2, 'triangle', 0.06, 2.0); this._tone(660, 0.28, 'sine', 0.05, 1.6); this._tone(990, 0.34, 'sine', 0.03, 1.4); }
  }
  combo(n) { this._tone(440 + n * 40, 0.08, 'square', 0.035, 1.2); }
  memory() { for (let i = 0; i < 4; i++) setTimeout(() => this._tone([262, 330, 392, 523][i], 0.5, 'sine', 0.05, 1.0), i * 90); }
  rail() { this._tone(260, 0.3, 'sawtooth', 0.04, 1.4); }
  enter() { this._tone(180, 0.4, 'sine', 0.05, 1.3); this._tone(90, 0.5, 'sine', 0.04, 1.2); }
}

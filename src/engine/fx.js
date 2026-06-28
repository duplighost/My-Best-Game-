// fx.js — the juice. A pooled particle fountain, hitstop and slow-mo for impact,
// and hooks the HUD uses for screen flashes and floating numbers. Additive
// blending + the bloom pass turn every burst into light.
import * as THREE from 'three';
import { clamp, clamp01 } from './util.js';

export class FX {
  constructor(scene, max = 2400) {
    this.scene = scene;
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.vel = Array.from({ length: max }, () => new THREE.Vector3());
    this.life = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.size = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;
    const mat = new THREE.PointsMaterial({
      size: 0.5, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    this._hitstop = 0;
    this._slowmo = 0;
    this.popup = null;     // set by HUD: (worldPos, text, color)
    this.flash = null;     // set by HUD: (color, strength)
  }

  burst(x, y, z, color, count = 18, opts = {}) {
    const c = new THREE.Color(color);
    const spread = opts.spread ?? 6;
    const up = opts.up ?? 2;
    const life = opts.life ?? 0.8;
    for (let i = 0; i < count; i++) {
      const k = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      const v = this.vel[k];
      v.set(Math.cos(a) * r * spread, Math.random() * up + (opts.up ? 0.5 : -1) , Math.sin(a) * r * spread);
      if (opts.dir) v.addScaledVector(opts.dir, opts.dirSpeed || 4);
      const jitter = 0.85 + Math.random() * 0.3;
      this.base[k * 3] = c.r * jitter; this.base[k * 3 + 1] = c.g * jitter; this.base[k * 3 + 2] = c.b * jitter;
      this.col[k * 3] = this.base[k * 3]; this.col[k * 3 + 1] = this.base[k * 3 + 1]; this.col[k * 3 + 2] = this.base[k * 3 + 2];
      this.ttl[k] = life * (0.6 + Math.random() * 0.8);
      this.life[k] = this.ttl[k];
      this.size[k] = opts.size ?? (0.3 + Math.random() * 0.4);
    }
  }

  ring(x, y, z, color, count = 24, radius = 1, speed = 8) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const k = this.next; this.next = (this.next + 1) % this.max;
      const a = (i / count) * Math.PI * 2;
      this.pos[k * 3] = x + Math.cos(a) * radius; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z + Math.sin(a) * radius;
      this.vel[k].set(Math.cos(a) * speed, 0.5, Math.sin(a) * speed);
      this.base[k * 3] = c.r; this.base[k * 3 + 1] = c.g; this.base[k * 3 + 2] = c.b;
      this.col[k * 3] = c.r; this.col[k * 3 + 1] = c.g; this.col[k * 3 + 2] = c.b;
      this.ttl[k] = 0.5; this.life[k] = 0.5; this.size[k] = 0.45;
    }
  }

  addHitstop(t) { this._hitstop = Math.max(this._hitstop, t); }
  addSlowmo(t) { this._slowmo = Math.max(this._slowmo, t); }

  // returns the game time scale for this frame and decrements timers by realDt
  consumeTimeScale(realDt) {
    if (this._hitstop > 0) { this._hitstop -= realDt; return 0.0; }
    if (this._slowmo > 0) { this._slowmo -= realDt; return 0.32; }
    return 1;
  }

  update(realDt) {
    const drag = Math.pow(0.12, realDt);
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) {
        if (this.size[k] !== 0) { this.pos[k * 3 + 1] = -9999; this.size[k] = 0; this.col[k*3]=this.col[k*3+1]=this.col[k*3+2]=0; }
        continue;
      }
      this.life[k] -= realDt;
      const v = this.vel[k];
      v.y -= 9 * realDt;
      v.multiplyScalar(drag);
      this.pos[k * 3] += v.x * realDt;
      this.pos[k * 3 + 1] += v.y * realDt;
      this.pos[k * 3 + 2] += v.z * realDt;
      // fade to black (additive blend makes them vanish) from the base color
      const f = clamp01(this.life[k] / (this.ttl[k] || 1));
      const ff = f * f;
      this.col[k * 3] = this.base[k * 3] * ff;
      this.col[k * 3 + 1] = this.base[k * 3 + 1] * ff;
      this.col[k * 3 + 2] = this.base[k * 3 + 2] * ff;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

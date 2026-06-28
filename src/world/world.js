// world.js — streams the infinite ground in and out around the player, owns all
// collision, and answers the questions the movement code asks: how high is the
// ground here, what am I bumping into, is there a rail to grab, is there
// something worth dashing at.
import * as THREE from 'three';
import { Terrain, CHUNK, RES } from './terrain.js';
import { Materials } from './materials.js';
import { WATER_LEVEL } from './biomes.js';
import { clamp, clamp01 } from '../engine/util.js';

export class Rail {
  constructor(points, closed = false, color = 0x63f7ff) {
    this.points = points;
    this.closed = closed;
    this.color = color;
    this.seg = [];
    this.length = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const d = a.distanceTo(b);
      this.seg.push({ a, b, d, acc: this.length });
      this.length += d;
    }
    if (closed && points.length > 1) {
      const a = points[points.length - 1], b = points[0];
      const d = a.distanceTo(b);
      this.seg.push({ a, b, d, acc: this.length });
      this.length += d;
    }
    this.mid = new THREE.Vector3();
    for (const p of points) this.mid.add(p);
    this.mid.multiplyScalar(1 / points.length);
    this.radius = 0; // bounding radius from mid
    for (const p of points) this.radius = Math.max(this.radius, p.distanceTo(this.mid));
  }
  pointAt(t) {
    const dist = clamp01(t) * this.length;
    let s = this.seg[0];
    for (const sg of this.seg) { if (dist >= sg.acc && dist <= sg.acc + sg.d) { s = sg; break; } }
    const lt = s.d > 0 ? (dist - s.acc) / s.d : 0;
    return new THREE.Vector3().lerpVectors(s.a, s.b, lt);
  }
  tangentAt(t) {
    const dist = clamp01(t) * this.length;
    let s = this.seg[0];
    for (const sg of this.seg) { if (dist >= sg.acc && dist <= sg.acc + sg.d) { s = sg; break; } }
    return new THREE.Vector3().subVectors(s.b, s.a).normalize();
  }
  // nearest t and distance to a world point (coarse sample)
  nearest(p) {
    let best = Infinity, bt = 0;
    const N = Math.max(8, Math.ceil(this.length / 3));
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const pt = this.pointAt(t);
      const d = pt.distanceTo(p);
      if (d < best) { best = d; bt = t; }
    }
    return { d: best, t: bt };
  }
}

export class World {
  constructor(seed, quality, anisotropy) {
    this.seed = seed;
    this.terrain = new Terrain(seed);
    this.materials = new Materials(anisotropy);
    this.root = new THREE.Group();
    this.chunks = new Map();        // "cx,cz" -> chunk
    this.queue = [];
    this.radius = quality === 'high' ? 6 : quality === 'medium' ? 5 : 3;
    this.unloadRadius = this.radius + 2;
    this.rails = [];
    this.airpads = [];
    this.poi = [];                  // points of interest (dash targets, landmarks, secrets)
    this.collectibles = [];         // glimmers, memories, relics waiting to be found
    this.interiorTriggers = [];     // doorways that reveal where you can enter
    this.entities = null;           // set by main; queried for dash homing
    this.decorator = null;          // set by main
    this.onChunkBuilt = null;
    this._key = (cx, cz) => cx + ',' + cz;
    this._tmp = new THREE.Vector3();
  }

  worldToChunk(x, z) { return [Math.floor(x / CHUNK), Math.floor(z / CHUNK)]; }
  groundHeight(x, z) { return this.terrain.heightAt(x, z); }
  slope(x, z) { return this.terrain.slopeAt(x, z); }
  climate(x, z) { return this.terrain.climate(x, z); }

  // ---- streaming ----
  update(playerPos, dt, timeBudgetMs = 5) {
    this.materials.update(dt);
    const [pcx, pcz] = this.worldToChunk(playerPos.x, playerPos.z);
    // enqueue needed
    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const key = this._key(cx, cz);
        if (this.chunks.has(key)) continue;
        if (this.queue.find((q) => q.key === key)) continue;
        const dist = dx * dx + dz * dz;
        if (dist > (this.radius + 0.5) * (this.radius + 0.5)) continue;
        this.queue.push({ cx, cz, key, dist });
      }
    }
    this.queue.sort((a, b) => a.dist - b.dist);
    // build within budget
    const start = performance.now();
    while (this.queue.length && performance.now() - start < timeBudgetMs) {
      const q = this.queue.shift();
      if (this.chunks.has(q.key)) continue;
      this._buildChunk(q.cx, q.cz);
      if (performance.now() - start > timeBudgetMs) break;
    }
    // unload far
    for (const [key, ch] of this.chunks) {
      const dx = ch.cx - pcx, dz = ch.cz - pcz;
      if (dx * dx + dz * dz > this.unloadRadius * this.unloadRadius) this._unloadChunk(key);
    }
    // run "living" updaters (haunted homes that still move, alone) near the player
    const t = this.materials.time.value;
    for (const ch of this._nearbyChunks(playerPos.x, playerPos.z)) {
      if (ch.updaters.length) for (const u of ch.updaters) u(dt, t, playerPos);
    }
  }

  _buildChunk(cx, cz) {
    const key = this._key(cx, cz);
    const group = new THREE.Group();
    const { mesh, minH, maxH } = this.terrain.buildTerrainMesh(cx, cz, this.materials.terrain);
    group.add(mesh);

    const chunk = {
      cx, cz, key, group,
      walls: [], platforms: [], rails: [], airpads: [], poi: [],
      collectibles: [], interiors: [],
      disposables: [mesh.geometry], updaters: [],
    };

    // water plane where the chunk dips below sea level
    if (minH < WATER_LEVEL + 0.2) {
      const w = new THREE.Mesh(this.materials.waterPlaneGeo, this.materials.water);
      w.rotation.x = -Math.PI / 2;
      w.position.set(cx * CHUNK + CHUNK / 2, WATER_LEVEL + 0.02, cz * CHUNK + CHUNK / 2);
      w.scale.set(CHUNK, CHUNK, 1);
      w.renderOrder = 1;
      group.add(w);
      chunk.water = w;
    }

    // decorate (flora, structures, landmarks, secrets, rails, creatures)
    if (this.decorator) this.decorator.decorate(chunk, cx, cz);

    // register dynamic collections
    for (const r of chunk.rails) this.rails.push(r);
    for (const p of chunk.airpads) this.airpads.push(p);
    for (const p of chunk.poi) this.poi.push(p);
    for (const c of chunk.collectibles) this.collectibles.push(c);
    for (const it of chunk.interiors) this.interiorTriggers.push(it);

    this.root.add(group);
    this.chunks.set(key, chunk);
    if (this.onChunkBuilt) this.onChunkBuilt(chunk);
  }

  _unloadChunk(key) {
    const ch = this.chunks.get(key);
    if (!ch) return;
    this.root.remove(ch.group);
    ch.group.traverse((o) => { if (o.isMesh && o.geometry && o.geometry._unique) o.geometry.dispose(); });
    for (const g of ch.disposables) { if (g && g.dispose) g.dispose(); }
    for (const r of ch.rails) { const i = this.rails.indexOf(r); if (i >= 0) this.rails.splice(i, 1); }
    for (const p of ch.airpads) { const i = this.airpads.indexOf(p); if (i >= 0) this.airpads.splice(i, 1); }
    for (const p of ch.poi) { const i = this.poi.indexOf(p); if (i >= 0) this.poi.splice(i, 1); }
    for (const c of ch.collectibles) { const i = this.collectibles.indexOf(c); if (i >= 0) this.collectibles.splice(i, 1); }
    for (const it of ch.interiors) { const i = this.interiorTriggers.indexOf(it); if (i >= 0) this.interiorTriggers.splice(i, 1); }
    if (ch.onUnload) ch.onUnload();
    this.chunks.delete(key);
  }

  // ---- collision queries (used by the controller) ----
  _nearbyChunks(x, z) {
    const [pcx, pcz] = this.worldToChunk(x, z);
    const out = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ch = this.chunks.get(this._key(pcx + dx, pcz + dz));
      if (ch) out.push(ch);
    }
    return out;
  }

  collide(x, z, r, y) {
    let px = x, pz = z, hit = false;
    const chunks = this._nearbyChunks(x, z);
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const ch of chunks) {
        for (const w of ch.walls) {
          if (w.yTop != null && y != null && (y > w.yTop || y < w.yBot)) continue;
          if (w.type === 'circle') {
            const dx = px - w.x, dz = pz - w.z;
            const d = Math.hypot(dx, dz);
            const rad = w.r + r;
            if (d < rad && d > 1e-4) { const push = rad - d; px += (dx / d) * push; pz += (dz / d) * push; moved = true; hit = true; }
          } else { // box
            const cx = clamp(px, w.minx, w.maxx), cz = clamp(pz, w.minz, w.maxz);
            const dx = px - cx, dz = pz - cz; const d = Math.hypot(dx, dz);
            if (d < r && d > 1e-4) { const push = r - d; px += (dx / d) * push; pz += (dz / d) * push; moved = true; hit = true; }
            else if (d <= 1e-4) {
              const l = px - w.minx, ri = w.maxx - px, u = pz - w.minz, dn = w.maxz - pz;
              const m = Math.min(l, ri, u, dn);
              if (m === l) px = w.minx - r; else if (m === ri) px = w.maxx + r;
              else if (m === u) pz = w.minz - r; else pz = w.maxz + r;
              moved = true; hit = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    return { x: px, z: pz, hit };
  }

  platformTop(x, z, feetY, vy) {
    let best = -Infinity;
    for (const ch of this._nearbyChunks(x, z)) {
      for (const p of ch.platforms) {
        if (x < p.minx || x > p.maxx || z < p.minz || z > p.maxz) continue;
        if (p.top <= feetY + 0.7 && p.top > best) best = p.top;
      }
    }
    return best;
  }

  airPadAt(x, z, y) {
    for (const p of this.airpads) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < p.r * p.r && y < p.y + 2.0 && y > p.y - 1.0) return p.power;
    }
    return null;
  }

  nearestRail(pos, vel, horizSpeed) {
    let best = null, bestD = Infinity;
    for (const rail of this.rails) {
      if (pos.distanceTo(rail.mid) > rail.radius + 4) continue;
      const nr = rail.nearest(pos);
      if (nr.d < 2.0 && nr.d < bestD) {
        const pt = rail.pointAt(nr.t);
        if (pos.y > pt.y - 1.2 && pos.y < pt.y + 2.4) { best = { rail, t: nr.t, dir: 1, d: nr.d }; bestD = nr.d; }
      }
    }
    if (best) {
      const tan = best.rail.tangentAt(best.t);
      const dot = vel.x * tan.x + vel.z * tan.z;
      best.dir = dot >= 0 ? 1 : -1;
    }
    return best;
  }

  // homing dash: find the best target inside the dash cone
  dashTarget(pos, dx, dz, coneCos, range) {
    let best = null, bestScore = -Infinity;
    const consider = (tx, ty, tz) => {
      const ox = tx - pos.x, oz = tz - pos.z;
      const d = Math.hypot(ox, oz);
      if (d < 1.5 || d > range) return;
      const nd = (ox * dx + oz * dz) / d;
      if (nd < coneCos) return;
      const score = nd * 2 - d / range;
      if (score > bestScore) { bestScore = score; best = { x: tx, y: ty, z: tz }; }
    };
    if (this.entities) for (const e of this.entities.enemies) { if (e.alive) consider(e.pos.x, e.pos.y, e.pos.z); }
    for (const p of this.poi) { if (p.dashable && !p.taken) consider(p.x, p.y, p.z); }
    return best;
  }

  dispose() {
    for (const key of [...this.chunks.keys()]) this._unloadChunk(key);
  }
}

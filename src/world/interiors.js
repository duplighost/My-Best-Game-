// interiors.js — the places you can walk inside. Each landmark flattens a floor,
// raises walls with doorways, stacks platforms you can climb, and hides a
// Memory at the heart of it as the reward for going in and going up. Collision
// is the same wall/platform system the open world uses, so entering is seamless
// — no loading screen, you just step through the door.
import * as THREE from 'three';
import { hash2, TAU, clamp } from '../engine/util.js';
import { Rail } from './world.js';

export class Interiors {
  constructor(world, decorator) { this.world = world; this.M = world.materials; this.deco = decorator; }

  // ---- primitives ----
  _box(chunk, x, y, z, w, h, d, mat, opts = {}) {
    const m = new THREE.Mesh(this.M.geo('unit', () => new THREE.BoxGeometry(1, 1, 1)), mat);
    m.position.set(x, y + h / 2, z); m.scale.set(w, h, d);
    if (opts.rotY) m.rotation.y = opts.rotY;
    m.castShadow = opts.shadow !== false; m.receiveShadow = true;
    chunk.group.add(m);
    return m;
  }
  // a wall = visible box + a collider that only blocks within its height band
  _wall(chunk, x, y, z, w, h, d, mat) {
    this._box(chunk, x, y, z, w, h, d, mat);
    chunk.walls.push({ type: 'box', minx: x - w / 2, maxx: x + w / 2, minz: z - d / 2, maxz: z + d / 2, yBot: y - 0.2, yTop: y + h });
  }
  _floor(chunk, x, y, z, w, d, mat) {
    this._box(chunk, x, y - 0.15, z, w, 0.3, d, mat, { shadow: false });
    chunk.platforms.push({ minx: x - w / 2, maxx: x + w / 2, minz: z - d / 2, maxz: z + d / 2, top: y });
  }
  _steps(chunk, x, y, z, w, dir, count, rise, run, mat) {
    // a simple staircase made of platform steps along +x (dir = 'x') or +z
    for (let i = 0; i < count; i++) {
      const sy = y + (i + 1) * rise;
      const sx = dir === 'x' ? x + i * run : x;
      const sz = dir === 'z' ? z + i * run : z;
      const sw = dir === 'x' ? run : w;
      const sd = dir === 'z' ? run : w;
      this._box(chunk, sx, sy - 0.1, sz, sw, 0.2, sd, mat, { shadow: false });
      chunk.platforms.push({ minx: sx - sw / 2, maxx: sx + sw / 2, minz: sz - sd / 2, maxz: sz + sd / 2, top: sy });
    }
  }
  _light(chunk, x, y, z, color, intensity = 6, dist = 16) {
    const l = new THREE.PointLight(color, intensity, dist, 2); l.position.set(x, y, z); chunk.group.add(l); return l;
  }
  _memory(chunk, x, y, z, color = 0xffe9a8) {
    const geo = this.M.geo('memcore', () => new THREE.IcosahedronGeometry(0.5, 0));
    const mesh = new THREE.Mesh(geo, this.M.glow('mem' + color, color, 2.8));
    mesh.position.set(x, y, z); mesh.scale.setScalar(1.5);
    chunk.group.add(mesh);
    const c = { x, y, z, kind: 'memory', color, mesh, taken: false, dashable: true, baseY: y, phase: hash2(x|0,z|0,9)*TAU, value: 5 };
    const light = this._light(chunk, x, y, z, color, 9, 18); c.light = light;
    chunk.collectibles.push(c); chunk.poi.push(c);
  }
  _landmark(chunk, x, y, z, name, key) {
    chunk.poi.push({ x, y: y + 3, z, kind: 'landmark', name, key, dashable: false });
    chunk.interiors.push({ x, y, z, name, key });
  }
  _relic(chunk, x, y, z, color, ability, name) {
    const geo = this.M.geo('reliccore', () => new THREE.TorusKnotGeometry(0.4, 0.14, 48, 8));
    const mesh = new THREE.Mesh(geo, this.M.glow('relic' + color, color, 2.4));
    mesh.position.set(x, y, z); chunk.group.add(mesh);
    const c = { x, y, z, kind: 'relic', color, mesh, taken: false, dashable: true, baseY: y, phase: 0, value: 3, ability, name };
    this._light(chunk, x, y, z, color, 7, 16);
    chunk.collectibles.push(c); chunk.poi.push(c);
  }

  // ======================================================================
  //  HOMES — the heart of the request. Built to feel like somewhere that was
  //  warm a long time ago: a hearth, an armchair drawn up to it, a set table,
  //  a child's room. Then left. The dust, the cold blue at the windows, the
  //  music box still turning — that's what makes it spooky now, not gore.
  // ======================================================================

  _homeMats() {
    if (this._hm) return this._hm;
    const M = this.M;
    this._hm = {
      floor: M.std('home-floor', 0x3c2c1e, { roughness: 0.92 }),
      wall: M.std('home-wall', 0x3b3346, { roughness: 0.95 }),
      wood: M.std('home-wood', 0x46331f, { roughness: 0.9 }),
      darkwood: M.std('home-darkwood', 0x2e2014, { roughness: 0.9 }),
      stone: M.std('home-stone', 0x4a4450, { roughness: 0.96 }),
      fabricRose: M.std('home-rose', 0x5a3a44, { roughness: 1.0 }),   // faded dusty rose
      fabricTeal: M.std('home-teal', 0x2f4a4c, { roughness: 1.0 }),   // faded teal
      linen: M.std('home-linen', 0x6a6258, { roughness: 1.0 }),       // grey, dusty
      ember: M.glow('home-ember', 0xff7a2a, 1.6),
      windowGlow: M.glow('home-window', 0x9fb6ff, 0.7, { transparent: true, opacity: 0.8 }),
      lanternGlow: M.glow('home-lantern', 0xffb868, 1.8),
    };
    return this._hm;
  }

  _portraitTex() {
    if (this._ptex) return this._ptex;
    const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#1a141e'; ctx.fillRect(0, 0, s, s);
    // a faded pale face, eyes lost to time
    const g = ctx.createRadialGradient(s / 2, s * 0.42, 4, s / 2, s * 0.5, s * 0.42);
    g.addColorStop(0, 'rgba(190,180,170,0.6)'); g.addColorStop(1, 'rgba(40,34,44,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(s / 2, s * 0.48, s * 0.26, s * 0.34, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(10,8,14,0.65)';
    ctx.beginPath(); ctx.ellipse(s * 0.40, s * 0.46, 5, 7, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * 0.60, s * 0.46, 5, 7, 0, 0, 7); ctx.fill();
    this._ptex = new THREE.CanvasTexture(cv); this._ptex.colorSpace = THREE.SRGBColorSpace;
    return this._ptex;
  }

  // a plain piece of furniture (visual; optionally a soft circle collider)
  _furn(chunk, x, y, z, w, h, d, mat, rotY = 0, solid = false) {
    const m = this._box(chunk, x, y, z, w, h, d, mat, { rotY, shadow: true });
    if (solid) chunk.walls.push({ type: 'circle', x, z, r: Math.max(w, d) * 0.45, yBot: y - 0.2, yTop: y + h });
    return m;
  }

  _rug(chunk, x, y, z, w, d, mat) {
    this._box(chunk, x, y + 0.04, z, w, 0.06, d, mat, { shadow: false });
  }

  // a hearth with a fire still burning, alone — flames flicker, the light
  // breathes, and it crackles (the crackle audio plays when you're near a home).
  _hearth(chunk, x, y, z, faceZ) {
    const hm = this._homeMats();
    const fz = faceZ; // +1 faces +z, -1 faces -z
    this._furn(chunk, x, y, z, 4.2, 4.6, 1.0, hm.stone, 0, true);          // chimney breast
    this._box(chunk, x, y + 0.4, z + fz * 0.45, 2.6, 1.6, 0.5, hm.darkwood, { shadow: false }); // firebox
    this._box(chunk, x, y + 2.6, z + fz * 0.55, 3.2, 0.3, 0.7, hm.wood, { shadow: false });      // mantel
    this._box(chunk, x - 0.4, y + 0.26, z + fz * 0.5, 1.5, 0.18, 0.22, hm.darkwood, { rotY: 0.25, shadow: false }); // logs
    this._box(chunk, x + 0.4, y + 0.34, z + fz * 0.5, 1.5, 0.18, 0.22, hm.darkwood, { rotY: -0.28, shadow: false });
    const ember = this._light(chunk, x, y + 0.7, z + fz * 0.85, 0xff7a1e, 7, 11);
    this._box(chunk, x, y + 0.45, z + fz * 0.55, 1.8, 0.5, 0.2, hm.ember, { shadow: false }); // bed of coals
    const flames = [];
    const fmat = this.M.glow('flame', 0xff8a2a, 2.8);
    for (let i = 0; i < 5; i++) {
      const fl = new THREE.Mesh(this.M.geo('flame', () => new THREE.ConeGeometry(0.18, 0.8, 6)), fmat);
      fl.position.set(x + (i - 2) * 0.3, y + 0.55, z + fz * 0.5);
      fl.renderOrder = 4; chunk.group.add(fl); flames.push(fl);
    }
    chunk.updaters.push((dt, t) => {
      ember.intensity = 7 + Math.sin(t * 7.1) * 1.9 + Math.sin(t * 13.7) * 1.0;
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i], ph = t * 9 + i * 1.7;
        f.scale.y = 0.7 + Math.abs(Math.sin(ph)) * 0.85 + Math.sin(ph * 2.3) * 0.2;
        f.scale.x = f.scale.z = 0.8 + Math.sin(ph * 1.7) * 0.16;
        f.position.y = y + 0.55 + f.scale.y * 0.2;
      }
    });
    return { ember, lit: true };
  }

  _armchair(chunk, x, y, z, rotY, mat) {
    this._furn(chunk, x, y, z, 1.3, 0.5, 1.3, mat, rotY);                  // seat
    const bx = Math.sin(rotY) * 0.55, bz = Math.cos(rotY) * 0.55;
    this._box(chunk, x - bx, y + 0.9, z - bz, 1.3, 1.1, 0.25, mat, { rotY, shadow: true }); // back
    this._box(chunk, x + bz * 0.5, y + 0.65, z - bx * 0.5, 0.25, 0.7, 1.2, mat, { rotY, shadow: false });
    this._box(chunk, x - bz * 0.5, y + 0.65, z + bx * 0.5, 0.25, 0.7, 1.2, mat, { rotY, shadow: false });
  }

  // a rocking chair (the updater makes it rock very slightly, alone)
  _rockingChair(chunk, x, y, z, rotY) {
    const hm = this._homeMats();
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; chunk.group.add(g);
    const add = (px, py, pz, w, h, d) => { const m = new THREE.Mesh(this.M.geo('unit', () => new THREE.BoxGeometry(1,1,1)), hm.darkwood); m.position.set(px, py, pz); m.scale.set(w, h, d); m.castShadow = true; g.add(m); };
    add(0, 0.5, 0, 0.9, 0.12, 0.9);   // seat
    add(0, 1.0, -0.4, 0.9, 1.0, 0.12); // back
    add(-0.4, 0.25, 0, 0.1, 0.5, 0.9); add(0.4, 0.25, 0, 0.1, 0.5, 0.9); // sides
    return g; // rock by tilting this group
  }

  _table(chunk, x, y, z, w, d, mat) {
    this._box(chunk, x, y + 0.95, z, w, 0.12, d, mat, { shadow: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      this._box(chunk, x + sx * (w/2 - 0.2), y + 0.47, z + sz * (d/2 - 0.2), 0.14, 0.95, 0.14, mat, { shadow: false });
    chunk.walls.push({ type: 'circle', x, z, r: Math.max(w, d) * 0.42, yBot: y, yTop: y + 1.1 });
  }
  _chair(chunk, x, y, z, rotY, mat) {
    this._box(chunk, x, y + 0.5, z, 0.6, 0.1, 0.6, mat, { rotY, shadow: true });
    const bx = Math.sin(rotY) * 0.26, bz = Math.cos(rotY) * 0.26;
    this._box(chunk, x - bx, y + 0.95, z - bz, 0.6, 0.9, 0.1, mat, { rotY, shadow: false });
  }
  _setting(chunk, x, y, z, mat) { // a dusty place setting
    this._box(chunk, x, y + 1.02, z, 0.34, 0.04, 0.34, mat, { shadow: false });
  }

  _bed(chunk, x, y, z, rotY, mat, small) {
    const hm = this._homeMats();
    const w = small ? 1.1 : 1.8, d = small ? 2.0 : 2.4;
    this._box(chunk, x, y + 0.35, z, w, 0.5, d, hm.darkwood, { rotY, shadow: true });        // frame
    this._box(chunk, x, y + 0.62, z, w - 0.15, 0.3, d - 0.2, mat, { rotY, shadow: false });   // mattress/quilt
    const hx = Math.sin(rotY) * (d/2 - 0.1), hz = Math.cos(rotY) * (d/2 - 0.1);
    this._box(chunk, x + hx, y + 1.0, z + hz, w, 1.0, 0.16, hm.darkwood, { rotY, shadow: true }); // headboard
    this._box(chunk, x + hx*0.7, y + 0.78, z + hz*0.7, w*0.5, 0.18, 0.5, hm.linen, { rotY, shadow: false }); // pillow
    chunk.walls.push({ type: 'circle', x, z, r: Math.max(w, d) * 0.4, yBot: y, yTop: y + 1.0 });
  }

  _bookshelf(chunk, x, y, z, rotY) {
    const hm = this._homeMats();
    this._furn(chunk, x, y, z, 2.0, 3.0, 0.5, hm.wood, rotY, true);
    const bookCols = [0x4a2a2a, 0x2a3a4a, 0x3a3a26, 0x3a2a40, 0x244a3a];
    const fx = Math.cos(rotY), fz = -Math.sin(rotY);
    const inst = new THREE.InstancedMesh(this.M.geo('unit', () => new THREE.BoxGeometry(1,1,1)),
      this.M.std('home-books', 0xffffff, { roughness: 1, vertexColors: false }), 24);
    const d3 = new THREE.Object3D(); let bi = 0; const col = new THREE.Color();
    for (let shelf = 0; shelf < 3; shelf++) {
      let bx = -0.8;
      while (bx < 0.8 && bi < 24) {
        const bw = 0.08 + Math.random() * 0.06, bh = 0.5 + Math.random() * 0.25;
        const px = x + fx * (bx + bw / 2), pz = z + fz * (bx + bw / 2);
        d3.position.set(px, y + 0.5 + shelf * 0.85 + bh / 2, pz); d3.rotation.set(0, rotY, 0); d3.scale.set(bw, bh, 0.34);
        d3.updateMatrix(); inst.setMatrixAt(bi, d3.matrix);
        col.setHex(bookCols[(Math.random() * bookCols.length) | 0]); inst.setColorAt(bi, col);
        bi++; bx += bw + 0.01;
      }
    }
    inst.count = bi; inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    chunk.group.add(inst);
  }

  _clock(chunk, x, y, z, rotY) {
    const hm = this._homeMats();
    this._furn(chunk, x, y, z, 0.8, 3.4, 0.5, hm.darkwood, rotY, true);
    const fx = Math.cos(rotY), fz = -Math.sin(rotY);
    this._box(chunk, x + fx * 0.26, y + 2.7, z + fz * 0.26, 0.5, 0.5, 0.06, hm.linen, { rotY, shadow: false }); // pale face
  }

  _portrait(chunk, x, y, z, rotY) {
    const hm = this._homeMats();
    this._box(chunk, x, y, z, 0.9, 1.2, 0.08, hm.darkwood, { rotY, shadow: false }); // frame
    const fx = Math.cos(rotY), fz = -Math.sin(rotY);
    const face = new THREE.Mesh(this.M.geo('portrait-plane', () => new THREE.PlaneGeometry(0.7, 1.0)),
      new THREE.MeshBasicMaterial({ map: this._portraitTex(), transparent: true }));
    face.position.set(x + fx * 0.05, y, z + fz * 0.05); face.rotation.y = rotY; chunk.group.add(face);
  }

  _musicBox(chunk, x, y, z) {
    const hm = this._homeMats();
    this._box(chunk, x, y, z, 0.5, 0.3, 0.4, hm.wood, { shadow: false });
    const lid = this._box(chunk, x, y + 0.22, z - 0.15, 0.5, 0.06, 0.1, hm.wood, { shadow: false });
    const dancer = new THREE.Mesh(this.M.geo('mbox-dancer', () => new THREE.ConeGeometry(0.08, 0.3, 8)),
      this.M.glow('mbox', 0xffd9a8, 2.0));
    dancer.position.set(x, y + 0.35, z); chunk.group.add(dancer);
    this._light(chunk, x, y + 0.4, z, 0xffd9a8, 1.2, 5);
    return dancer; // updater spins it slowly
  }

  _dust(chunk, x, y, z, w, h, d) {
    const N = 46;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i*3] = x + (Math.random()-0.5)*w; pos[i*3+1] = y + Math.random()*h; pos[i*3+2] = z + (Math.random()-0.5)*d; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xb9a98a, size: 0.05, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; chunk.group.add(pts);
    chunk.disposables.push(g);
    return pts;
  }

  // a floor/ceiling slab built as panels around a rectangular opening (a stairwell)
  _slabWithHole(chunk, cx, y, cz, W, D, hole, mat, asPlatform) {
    const x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2;
    const hx0 = Math.max(x0, hole.minx), hx1 = Math.min(x1, hole.maxx);
    const hz0 = Math.max(z0, hole.minz), hz1 = Math.min(z1, hole.maxz);
    const panel = (px0, px1, pz0, pz1) => {
      const w = px1 - px0, d = pz1 - pz0; if (w <= 0.05 || d <= 0.05) return;
      this._box(chunk, (px0 + px1) / 2, y - 0.1, (pz0 + pz1) / 2, w, 0.2, d, mat, { shadow: false });
      if (asPlatform) chunk.platforms.push({ minx: px0, maxx: px1, minz: pz0, maxz: pz1, top: y });
    };
    panel(x0, x1, z0, hz0);    // strip before the hole
    panel(x0, x1, hz1, z1);    // strip after the hole
    panel(x0, hx0, hz0, hz1);  // left of the hole
    panel(hx1, x1, hz0, hz1);  // right of the hole
  }

  _stepsDown(chunk, x, y, z, w, dir, count, rise, run, mat) {
    for (let i = 0; i < count; i++) {
      const sy = y - (i + 1) * rise;
      const sx = dir === 'x' ? x + i * run : x;
      const sz = dir === 'z' ? z + i * run : z;
      const sw = dir === 'x' ? run + 0.04 : w, sd = dir === 'z' ? run + 0.04 : w;
      this._box(chunk, sx, sy - 0.1, sz, sw, 0.2, sd, mat, { shadow: false });
      chunk.platforms.push({ minx: sx - sw / 2, maxx: sx + sw / 2, minz: sz - sd / 2, maxz: sz + sd / 2, top: sy });
    }
  }

  // ---- CELLAR: descend below a home into the cold dark. A Memory waits there. ----
  _cellar(chunk, x, y, z, CW, CD, sw) {
    const hm = this._homeMats();
    const depth = 4.4, cy = y - depth;
    this._floor(chunk, x, cy + 0.05, z, CW, CD, hm.stone);                 // cellar floor
    this._wall(chunk, x, cy, z - CD / 2, CW, depth, 0.4, hm.stone);
    this._wall(chunk, x, cy, z + CD / 2, CW, depth, 0.4, hm.stone);
    this._wall(chunk, x - CW / 2, cy, z, 0.4, depth, CD, hm.stone);
    this._wall(chunk, x + CW / 2, cy, z, 0.4, depth, CD, hm.stone);
    this._slabWithHole(chunk, x, y - 0.25, z, CW, CD, sw, hm.darkwood, false); // ceiling w/ stairwell gap
    const sx = (sw.minx + sw.maxx) / 2, swid = (sw.maxx - sw.minx) - 0.3;
    const zlen = sw.maxz - sw.minz, count = 11;
    this._stepsDown(chunk, sx, y, sw.minz + 0.4, swid, 'z', count, (depth - 0.3) / count, (zlen - 0.6) / count, hm.wood);
    chunk.pits.push({ minx: x - CW / 2, maxx: x + CW / 2, minz: z - CD / 2, maxz: z + CD / 2 });
    // contents: barrels, a shelf, a dim swaying cold bulb, dust, and a Memory
    for (let i = 0; i < 4; i++) this._furn(chunk, x + (i - 1.5) * 1.4 + 1, cy, z - CD / 2 + 1.2, 0.9, 1.2, 0.9, hm.darkwood, 0, true);
    this._bookshelf(chunk, x + CW / 2 - 0.6, cy, z, -Math.PI / 2);
    const bulb = this._light(chunk, x, cy + depth - 1.0, z, 0x9fd0c0, 6, 15);
    this._box(chunk, x, cy + depth - 0.6, z, 0.16, 0.16, 0.16, this.M.glow('cellarbulb', 0xbfe6d8, 1.8), { shadow: false });
    this._dust(chunk, x, cy + 0.8, z, CW - 2, depth - 1.5, CD - 2);
    this._memory(chunk, x, cy + 1.3, z + CD / 2 - 1.6, 0xbfe6d8);
    chunk.updaters.push((dt, t) => { bulb.intensity = 4 + Math.sin(t * 3.1) * 1.6 + (Math.sin(t * 23) > 0.92 ? -3.2 : 0); });
  }

  // ---- HAUNTED HOUSE: a home gone cold — parlor, kitchen, a child's room up top ----
  hauntedHouse(chunk, x, y, z) {
    const hm = this._homeMats();
    const wallMat = hm.wall, floorMat = hm.floor;
    const W = 18, D = 16, H = 4.4;
    const CW = 12, CD = 10;
    const sw = { minx: x - 5, maxx: x - 2.2, minz: z - 1, maxz: z + 3 }; // the stairwell down
    this._slabWithHole(chunk, x, y + 0.05, z, W, D, sw, floorMat, true);  // ground floor (minus stairwell)
    this._floor(chunk, x, y + H + 0.05, z, W, D, floorMat); // upper floor
    // outer walls (front doorway gap on +z)
    this._wall(chunk, x, y, z - D / 2, W, H * 2, 0.4, wallMat);
    this._wall(chunk, x - W / 4 - 1, y, z + D / 2, W / 2 - 2, H * 2, 0.4, wallMat);
    this._wall(chunk, x + W / 4 + 1, y, z + D / 2, W / 2 - 2, H * 2, 0.4, wallMat);
    this._wall(chunk, x, y + H * 1.4, z + D / 2, 4, H * 0.6, 0.4, wallMat); // lintel
    this._wall(chunk, x - W / 2, y, z, 0.4, H * 2, D, wallMat);
    this._wall(chunk, x + W / 2, y, z, 0.4, H * 2, D, wallMat);
    this._wall(chunk, x - 3, y, z + 2, 0.3, H, D / 2 - 1, wallMat);  // parlor/kitchen partition
    this._wall(chunk, x, y + H * 2, z, W + 1, 0.4, D + 1, wallMat);   // roof
    // cold blue at the windows (emissive — they glow on their own); one cool spill
    for (const wx of [-W/2, W/2]) for (const wz of [-3.5, 3.5])
      this._box(chunk, x + wx, y + 2.2, z + wz, 0.1, 1.5, 1.1, hm.windowGlow, { shadow: false });
    this._light(chunk, x, y + 2.8, z, 0x6f86c8, 7, 18); // one cool spill across the room

    // ---- the parlor (right side): hearth, the chairs drawn up to it, a rug ----
    const hearth = this._hearth(chunk, x + W/2 - 1.2, y, z - 2, +1); // against right wall, faces in
    this._rug(chunk, x + 3.5, y, z - 1, 5, 4, hm.fabricRose);
    this._armchair(chunk, x + 2.5, y, z - 2.5, -0.5, hm.fabricTeal);
    const rocker = this._rockingChair(chunk, x + 4.8, y, z + 0.5, 2.4); // rocks, alone
    this._furn(chunk, x + 3.6, y, z - 0.6, 1.1, 0.5, 0.7, hm.darkwood);   // low table
    this._bookshelf(chunk, x + W/2 - 0.6, y, z + 3, -Math.PI/2);
    this._clock(chunk, x - W/2 + 0.6, y, z - 5, Math.PI/2);               // grandfather clock
    this._portrait(chunk, x, y + 2.6, z - D/2 + 0.3, 0);
    this._portrait(chunk, x + 5, y + 2.6, z - D/2 + 0.3, 0);

    // ---- the kitchen (left side): a set table that was never cleared ----
    this._table(chunk, x - 5, y, z + 3, 2.6, 1.4, hm.wood);
    this._chair(chunk, x - 5, y, z + 4.3, 0, hm.wood);
    this._chair(chunk, x - 5, y, z + 1.7, Math.PI, hm.wood);
    this._chair(chunk, x - 6.6, y, z + 3, Math.PI/2, hm.wood);
    this._setting(chunk, x - 4.4, y, z + 3, hm.linen);
    this._setting(chunk, x - 5.6, y, z + 3, hm.linen);
    this._furn(chunk, x - W/2 + 0.9, y, z + 5, 2.4, 1.6, 1.0, hm.darkwood, 0, true); // counter/stove

    // ---- stairs up, and the child's room above ----
    this._steps(chunk, x - 1, y, z - 6.5, 2.4, 'x', 8, H / 8, 0.9, hm.wood);
    this._bed(chunk, x - 5, y + H, z - 4.5, 0, hm.fabricRose, true);       // a small bed
    this._furn(chunk, x - 5, y + H, z + 3, 1.2, 1.4, 0.6, hm.darkwood, 0, true); // toy chest
    const horse = this._furn(chunk, x - 2.5, y + H, z + 1, 1.2, 1.0, 0.4, hm.wood); // rocking horse
    this._portrait(chunk, x + 4, y + H + 2.4, z - D/2 + 0.3, 0);
    this._bed(chunk, x + 4.5, y + H, z - 4.5, 0, hm.fabricTeal, false);    // the parents' bed

    // dust in the cold light; a single lantern still burning; the music box turning
    this._dust(chunk, x, y + 1.2, z, W - 3, 3, D - 3);
    const lantern = this._box(chunk, x - 2, y + H - 0.6, z, 0.3, 0.5, 0.3, hm.lanternGlow, { shadow: false });
    this._light(chunk, x - 2, y + H - 0.7, z, 0xffc078, 14, 15);           // lantern upstairs
    this._light(chunk, x + 3.2, y + 2.4, z - 1.5, 0xffae66, 11, 17);       // parlor warmth
    this._light(chunk, x - 4.5, y + 2.4, z + 3, 0xffc080, 13, 16);         // kitchen warmth
    this._light(chunk, x, y + H + 2.4, z - 2, 0xc79cff, 11, 16);           // upstairs, cool
    const dancer = this._musicBox(chunk, x - 5, y + H + 1.15, z - 4.5);   // on the child's bed-side

    // the memory waits in the child's room
    this._memory(chunk, x - 2.5, y + H + 1.4, z - 5, 0xffd9a0);

    // a few things still move, alone
    chunk.updaters.push((dt, t) => {
      rocker.rotation.x = Math.sin(t * 1.15) * 0.045;
      if (dancer) dancer.rotation.y = t * 1.4;
    });
    this._cellar(chunk, x, y, z, CW, CD, sw); // and a cellar, below it all
    this._landmark(chunk, x, y, z, 'A House That Waited', 'house');
  }

  // ---- FOREST CABIN: one warm room deep in the woods, left to the cold ----
  forestCabin(chunk, x, y, z) {
    const hm = this._homeMats();
    const W = 11, D = 10, H = 3.6;
    this._floor(chunk, x, y + 0.05, z, W, D, hm.floor);
    this._wall(chunk, x, y, z - D/2, W, H, 0.35, hm.darkwood);
    this._wall(chunk, x - W/4 - 0.7, y, z + D/2, W/2 - 1.4, H, 0.35, hm.darkwood);
    this._wall(chunk, x + W/4 + 0.7, y, z + D/2, W/2 - 1.4, H, 0.35, hm.darkwood);
    this._wall(chunk, x - W/2, y, z, 0.35, H, D, hm.darkwood);
    this._wall(chunk, x + W/2, y, z, 0.35, H, D, hm.darkwood);
    // pitched-ish roof (two slabs)
    this._box(chunk, x, y + H + 0.6, z - 2, W + 1, 0.3, D/2 + 1, hm.wood, { rotY: 0, shadow: true });
    this._box(chunk, x, y + H + 0.6, z + 2, W + 1, 0.3, D/2 + 1, hm.wood, { shadow: true });
    // a window, cold and blue (emissive; the cool spill is added below)
    this._box(chunk, x - W/2, y + 1.9, z, 0.1, 1.1, 1.0, hm.windowGlow, { shadow: false });
    // the hearth and the chair that faced it
    const hearth = this._hearth(chunk, x, y, z - D/2 + 0.8, +1);
    this._rug(chunk, x, y, z + 0.5, 4, 3.2, hm.fabricRose);
    const rocker = this._rockingChair(chunk, x + 1.6, y, z + 1, 2.6);
    this._armchair(chunk, x - 1.8, y, z + 0.5, 0.6, hm.fabricTeal);
    this._table(chunk, x + 2.5, y, z + 3, 1.8, 1.1, hm.wood);
    this._chair(chunk, x + 2.5, y, z + 4, 0, hm.wood);
    this._setting(chunk, x + 2.5, y, z + 3, hm.linen);
    this._bed(chunk, x - 3, y, z + 3, 0, hm.linen, false);
    this._bookshelf(chunk, x + W/2 - 0.5, y, z - 2, -Math.PI/2);
    this._portrait(chunk, x, y + 2.2, z - D/2 + 0.25, 0);
    this._dust(chunk, x, y + 1.0, z, W - 2, 2.4, D - 2);
    this._light(chunk, x, y + 2.4, z, 0xffb066, 9, 14);                   // warm room fill
    this._light(chunk, x - W/2 + 0.6, y + 1.9, z, 0x6f86c8, 4, 9);        // cold window spill
    const dancer = this._musicBox(chunk, x + 2.5, y + 1.15, z + 3);
    this._memory(chunk, x, y + 1.4, z + 1, 0xffd9a0);
    chunk.updaters.push((dt, t) => {
      rocker.rotation.x = Math.sin(t * 1.05 + 1) * 0.05;
      if (dancer) dancer.rotation.y = t * 1.3;
    });
    this._landmark(chunk, x, y, z, 'A Cabin in the Cold Woods', 'cabin');
  }

  // ---- ALIEN SPIRE: a tall hollow tower you climb by pad, ledges and a rail ----
  alienSpire(chunk, x, y, z) {
    const M = this.M;
    const shellMat = M.std('spireshell', 0x141a30, { roughness: 0.4, metalness: 0.5 });
    const glowMat = M.glow('spireglow', 0x63f7ff, 1.4);
    const H = 56, R = 7;
    // hollow shell as 12 tall panels (with a doorway gap on -z)
    const panels = 12;
    for (let i = 0; i < panels; i++) {
      const a = (i / panels) * TAU;
      if (Math.abs(((a + Math.PI) % TAU) - Math.PI) < 0.45) continue; // door gap near +z... actually gap where a≈PI
      const px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
      const m = this._box(chunk, px, y, pz, 0.5, H, (TAU * R / panels) * 1.1, shellMat, { rotY: -a });
      chunk.walls.push({ type: 'circle', x: px, z: pz, r: 1.0, yBot: y, yTop: y + H });
    }
    // base floor
    this._floor(chunk, x, y + 0.05, z, R * 2.1, R * 2.1, shellMat);
    // launch pad in the centre
    chunk.airpads.push({ x, z, r: 2.2, y: y, power: 20 });
    const pad = this._box(chunk, x, y + 0.2, z, 4, 0.4, 4, glowMat, { shadow: false });
    // spiral ledges + a memory ring climbing the inside
    const ledges = 7;
    let prev = null;
    for (let i = 1; i <= ledges; i++) {
      const a = i * 1.5;
      const ly = y + (H / (ledges + 1)) * i;
      const lx = x + Math.cos(a) * (R - 2), lz = z + Math.sin(a) * (R - 2);
      this._box(chunk, lx, ly - 0.1, lz, 3.2, 0.3, 3.2, glowMat, { shadow: false });
      chunk.platforms.push({ minx: lx - 1.6, maxx: lx + 1.6, minz: lz - 1.6, maxz: lz + 1.6, top: ly });
      if (i % 2 === 0) this._light(chunk, lx, ly + 1, lz, 0x63f7ff, 4, 14);
      prev = { x: lx, y: ly, z: lz };
    }
    // a rail spiralling up the outside for a fast descent/ascent flourish
    const rpts = [];
    for (let i = 0; i <= 8; i++) {
      const a = -i * 0.8; const ry = y + 4 + (H - 8) * (i / 8);
      rpts.push(new THREE.Vector3(x + Math.cos(a) * (R + 1.4), ry, z + Math.sin(a) * (R + 1.4)));
    }
    const rail = new Rail(rpts, false, 0x63f7ff);
    chunk.rails.push(rail);
    if (this.deco) this.deco._railMesh(chunk, rail);
    // top: the memory + a beacon
    this._memory(chunk, x, y + H - 3, z, 0x9ff0ff);
    this._box(chunk, x, y + H, z, 1.2, 6, 1.2, glowMat, { shadow: false });
    this._landmark(chunk, x, y, z, 'The Listening Spire', 'spire');
  }

  // ---- OASIS REFUGE: water, palms, a few huts you can step into ----
  oasisRefuge(chunk, x, y, z) {
    const M = this.M;
    const water = new THREE.Mesh(M.waterPlaneGeo, M.water);
    water.rotation.x = -Math.PI / 2; water.position.set(x, y + 0.05, z); water.scale.set(16, 16, 1);
    chunk.group.add(water);
    const palmTrunk = M.std('palm', 0x4a3a26);
    const palmLeaf = M.glow('palmleaf', 0x7be0a0, 0.5, { roughness: 0.7 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3; const px = x + Math.cos(a) * 11, pz = z + Math.sin(a) * 11;
      const py = this.world.groundHeight(px, pz);
      const h = 5 + hash2(px|0, pz|0, 3) * 3;
      this._box(chunk, px, py, pz, 0.5, h, 0.5, palmTrunk);
      for (let l = 0; l < 5; l++) {
        const la = (l / 5) * TAU;
        this._box(chunk, px + Math.cos(la) * 1.4, py + h, pz + Math.sin(la) * 1.4, 2.6, 0.16, 0.5, palmLeaf, { rotY: la, shadow: false });
      }
      chunk.walls.push({ type: 'circle', x: px, z: pz, r: 0.4 });
    }
    // refuge huts
    const hutMat = M.std('hut', 0xc2a878, { roughness: 0.95 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 1.0; const hx = x + Math.cos(a) * 18, hz = z + Math.sin(a) * 18;
      const hy = this.world.groundHeight(hx, hz);
      this._floor(chunk, hx, hy + 0.05, hz, 6, 6, hutMat);
      this._wall(chunk, hx, hy, hz - 3, 6, 3.4, 0.3, hutMat);
      this._wall(chunk, hx - 3, hy, hz, 0.3, 3.4, 6, hutMat);
      this._wall(chunk, hx + 3, hy, hz, 0.3, 3.4, 6, hutMat);
      this._wall(chunk, hx - 2, hy, hz + 3, 2, 3.4, 0.3, hutMat); // partial front (door gap)
      this._box(chunk, hx, hy + 3.4, hz, 7, 0.3, 7, hutMat); // roof
      this._light(chunk, hx, hy + 2, hz, 0xffce6a, 3, 12);
    }
    this._relic(chunk, x, y + 2.0, z, 0xffce6a, 'longGlide', 'Wind-Worn Charm');
    this._landmark(chunk, x, y, z, 'The Oasis That Remembers', 'oasis');
  }

  // ---- SHRINE SANCTUM: a ring of arches around the watcher ----
  shrineSanctum(chunk, x, y, z) {
    const M = this.M;
    const stone = M.std('shrinestone', 0xb9aede, { roughness: 0.5, emissive: 0x2a2456, emissiveIntensity: 0.3 });
    this._floor(chunk, x, y + 0.05, z, 22, 22, M.std('shrinefloor', 0x2a2440, { roughness: 0.4 }));
    const arches = 8;
    for (let i = 0; i < arches; i++) {
      const a = (i / arches) * TAU; const ax = x + Math.cos(a) * 9, az = z + Math.sin(a) * 9;
      this._box(chunk, ax, y, az, 1.0, 7, 1.0, stone, { rotY: a });
      chunk.walls.push({ type: 'circle', x: ax, z: az, r: 0.7 });
    }
    // the watcher: a tall translucent guardian (glass)
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.5, emissive: 0x6fa0ff, emissiveIntensity: 0.8, roughness: 0.2, metalness: 0.1 });
    const body = new THREE.Mesh(M.geo('watcher', () => new THREE.CapsuleGeometry(1.2, 4, 6, 12)), glass);
    body.position.set(x, y + 4, z); chunk.group.add(body);
    const head = new THREE.Mesh(M.geo('whead', () => new THREE.IcosahedronGeometry(1.0, 1)), glass);
    head.position.set(x, y + 7.2, z); chunk.group.add(head);
    this._light(chunk, x, y + 6, z, 0xffe9a8, 10, 26);
    this._memory(chunk, x, y + 1.6, z, 0xffe9a8);
    this._landmark(chunk, x, y, z, 'Where the Watcher Rests', 'shrine');
  }

  // ---- GREAT TREE: a giant glowing tree with platforms up to a memory ----
  greatTree(chunk, x, y, z) {
    const M = this.M;
    const trunkMat = M.std('greattrunk', 0x18302a, { roughness: 0.9 });
    const H = 38;
    const trunk = this._box(chunk, x, y, z, 4, H, 4, trunkMat);
    chunk.walls.push({ type: 'circle', x, z, r: 2.4, yBot: y, yTop: y + H });
    const canopy = new THREE.Mesh(M.geo('greatcanopy', () => new THREE.IcosahedronGeometry(1, 2)), M.glow('greatglow', 0x49ffce, 0.7, { roughness: 0.6 }));
    canopy.position.set(x, y + H + 4, z); canopy.scale.setScalar(12); chunk.group.add(canopy);
    // spiralling bough platforms
    for (let i = 1; i <= 6; i++) {
      const a = i * 1.7; const r = 4 + (i % 2) * 1.5;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, py = y + (H / 7) * i;
      this._box(chunk, px, py - 0.1, pz, 3, 0.3, 3, M.glow('bough', 0x49ffce, 0.6), { shadow: false });
      chunk.platforms.push({ minx: px - 1.5, maxx: px + 1.5, minz: pz - 1.5, maxz: pz + 1.5, top: py });
    }
    chunk.airpads.push({ x: x + 4, z, r: 1.8, y, power: 15 });
    const pad = this._box(chunk, x + 4, y + 0.2, z, 3, 0.3, 3, M.glow('treepad', 0x49ffce, 1.6), { shadow: false });
    this._memory(chunk, x, y + H + 2, z, 0x8effe0);
    this._landmark(chunk, x, y, z, 'The Tree That Holds the Light', 'tree');
  }

  // ---- LONE DOOR: a single surreal door standing in the plains ----
  loneDoor(chunk, x, y, z) {
    const M = this.M;
    const frame = M.std('doorframe', 0x2a2a4a, { emissive: 0x3a3a7a, emissiveIntensity: 0.5 });
    this._box(chunk, x - 1.2, y, z, 0.3, 4.4, 0.3, frame);
    this._box(chunk, x + 1.2, y, z, 0.3, 4.4, 0.3, frame);
    this._box(chunk, x, y + 4.2, z, 2.7, 0.3, 0.3, frame);
    const portal = new THREE.Mesh(M.geo('portal', () => new THREE.PlaneGeometry(2.1, 4)), M.glow('portalglow', 0x9ff0ff, 1.6, { opacity: 0.6, transparent: true, side: THREE.DoubleSide }));
    portal.position.set(x, y + 2.1, z); chunk.group.add(portal);
    this._light(chunk, x, y + 2, z, 0x9ff0ff, 5, 14);
    this._relic(chunk, x, y + 2.1, z + 0.3, 0x9ff0ff, 'doubleDash', 'A Door to Nowhere');
    this._landmark(chunk, x, y, z, 'A Door to Nowhere', 'door');
  }

  // ---- FROZEN MONUMENT: an ice obelisk with a memory frozen inside ----
  frozenMonument(chunk, x, y, z) {
    const M = this.M;
    const ice = new THREE.MeshStandardMaterial({ color: 0xbdeeff, transparent: true, opacity: 0.6, emissive: 0x6fc0ff, emissiveIntensity: 0.6, roughness: 0.1 });
    const obelisk = new THREE.Mesh(M.geo('obelisk', () => new THREE.OctahedronGeometry(1, 0)), ice);
    obelisk.position.set(x, y + 6, z); obelisk.scale.set(3, 9, 3); chunk.group.add(obelisk);
    chunk.walls.push({ type: 'circle', x, z, r: 2.4 });
    this._light(chunk, x, y + 6, z, 0xbdeeff, 8, 22);
    // a ring of standing stones
    for (let i = 0; i < 6; i++) { const a = (i/6)*TAU; const sx=x+Math.cos(a)*7, sz=z+Math.sin(a)*7; const sy=this.world.groundHeight(sx,sz);
      this._box(chunk, sx, sy, sz, 1, 3+ (i%2), 0.6, M.std('icestone', 0x6a7aa0)); chunk.walls.push({type:'circle',x:sx,z:sz,r:0.6}); }
    this._relic(chunk, x, y + 2.0, z, 0xbdeeff, 'fastGrind', 'A Cold That Keeps');
    this._landmark(chunk, x, y, z, 'The Monument of Quiet', 'monument');
  }
}

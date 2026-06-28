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

  // ---- HAUNTED HOUSE: rooms downstairs, a stair, a memory in the attic ----
  hauntedHouse(chunk, x, y, z) {
    const M = this.M;
    const wallMat = M.std('housewall', 0x241a26, { roughness: 0.95 });
    const floorMat = M.std('housefloor', 0x2a2018, { roughness: 0.9 });
    const W = 18, D = 16, H = 4.4;
    // flat floor
    this._floor(chunk, x, y + 0.05, z, W, D, floorMat);
    this._floor(chunk, x, y + H + 0.05, z, W, D, floorMat); // upper floor
    // outer walls with a front doorway (gap in -z wall)
    this._wall(chunk, x, y, z - D / 2, W, H * 2, 0.4, wallMat);          // back
    // front wall split for a door
    this._wall(chunk, x - W / 4 - 1, y, z + D / 2, W / 2 - 2, H * 2, 0.4, wallMat);
    this._wall(chunk, x + W / 4 + 1, y, z + D / 2, W / 2 - 2, H * 2, 0.4, wallMat);
    this._wall(chunk, x, y + H * 1.4, z + D / 2, 4, H * 0.6, 0.4, wallMat); // lintel over door
    this._wall(chunk, x - W / 2, y, z, 0.4, H * 2, D, wallMat);          // left
    this._wall(chunk, x + W / 2, y, z, 0.4, H * 2, D, wallMat);          // right
    // an interior partition with a doorway
    this._wall(chunk, x - 3, y, z, 0.3, H, D / 2 - 2, wallMat);
    // pitched roof
    const roof = this._box(chunk, x, y + H * 2, z, W + 1, 0.4, D + 1, wallMat);
    // glowing windows
    for (const wx of [-W/2, W/2]) for (const wz of [-3, 3]) {
      const win = M.glow('hwin', 0xffcf85, 1.2, { opacity: 0.9, transparent: true });
      this._box(chunk, x + wx, y + 2.2, z + wz, 0.1, 1.4, 1.0, win, { shadow: false });
    }
    // furniture
    this._box(chunk, x + 4, y + 0.5, z - 3, 2.4, 1.0, 1.2, floorMat); // table
    this._box(chunk, x - 5, y + 0.7, z + 4, 1.2, 1.4, 1.2, wallMat);  // chair-ish
    // stair to the attic (along +x against right wall)
    this._steps(chunk, x + 2, y, z - 5, 3, 'x', 8, H / 8, 0.9, floorMat);
    // ambience
    this._light(chunk, x, y + 2.5, z, 0xffcf85, 4, 18);
    this._light(chunk, x, y + H + 2.0, z, 0x9a7dff, 3, 16);
    // the reward: a memory in the attic
    this._memory(chunk, x, y + H + 1.6, z - 4, 0xffd9a0);
    this._landmark(chunk, x, y, z, 'A House That Waited', 'house');
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

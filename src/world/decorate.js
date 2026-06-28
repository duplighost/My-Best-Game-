// decorate.js — what fills the world so it never feels empty. For each chunk we
// scatter biome-appropriate life: glassgrass and light-trees, crystal spires,
// snow pines, neon towers with grind-lines, dead trees and lanterns, sacred
// monoliths — plus the glimmers you collect and the doorways you can enter.
import * as THREE from 'three';
import { hash2, hashInt, pick, clamp, clamp01, lerp, TAU } from '../engine/util.js';
import { CHUNK } from './terrain.js';
import { WATER_LEVEL } from './biomes.js';
import { Rail } from './world.js';
import { Interiors } from './interiors.js';

export class Decorator {
  constructor(world) {
    this.world = world;
    this.M = world.materials;
    this.interiors = new Interiors(world, this);
  }

  decorate(chunk, cx, cz) {
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const W = this.world;
    // bucket transforms per kind so we can instance them
    const buckets = new Map(); // kind -> { geo, mat, mats:[], shadow }
    const addInst = (kind, geoFn, mat, m, shadow = false) => {
      let b = buckets.get(kind);
      if (!b) { b = { geo: this.M.geo(kind, geoFn), mat, mats: [], shadow }; buckets.set(kind, b); }
      b.mats.push(m.clone());
    };

    const sample = 9;                 // 9x9 scatter candidates
    const cellW = CHUNK / sample;
    const dummy = new THREE.Object3D();

    // ----- decide the landmark up front so scatter can clear a space for it -----
    const lmRoll = hash2(cx, cz, 7777);
    const ctrX = ox + CHUNK / 2, ctrZ = oz + CHUNK / 2;
    const lmCl = W.climate(ctrX, ctrZ);
    const lmY = W.groundHeight(ctrX, ctrZ);
    let landmark = null, clearR = 0;
    if (lmY > WATER_LEVEL + 0.5 && W.slope(ctrX, ctrZ) < 0.7) {
      const I = this.interiors, dom = lmCl.dom;
      if (dom === 'hollow') {
        if (lmRoll < 0.14) { landmark = () => I.hauntedHouse(chunk, ctrX, lmY, ctrZ); clearR = 22; }
        else if (lmRoll < 0.24) { landmark = () => I.forestCabin(chunk, ctrX, lmY, ctrZ); clearR = 14; }
      } else if (dom === 'forest') {
        if (lmRoll < 0.06) { landmark = () => I.greatTree(chunk, ctrX, lmY, ctrZ); clearR = 16; }
        else if (lmRoll < 0.15) { landmark = () => I.forestCabin(chunk, ctrX, lmY, ctrZ); clearR = 14; }
      } else if (dom === 'shrine' && lmRoll < 0.5) { landmark = () => I.shrineSanctum(chunk, ctrX, lmY, ctrZ); clearR = 16; }
      else if (dom === 'desert' && lmRoll < 0.08) { landmark = () => I.oasisRefuge(chunk, ctrX, lmY, ctrZ); clearR = 26; }
      else if (dom === 'city' && lmRoll < 0.12) { landmark = () => I.alienSpire(chunk, ctrX, lmY, ctrZ); clearR = 12; }
      else if (dom === 'meadow' && lmRoll < 0.04) { landmark = () => I.loneDoor(chunk, ctrX, lmY, ctrZ); clearR = 6; }
      else if (dom === 'snow' && lmRoll < 0.05) { landmark = () => I.frozenMonument(chunk, ctrX, lmY, ctrZ); clearR = 13; }
    }

    for (let gz = 0; gz < sample; gz++) {
      for (let gx = 0; gx < sample; gx++) {
        const r1 = hash2(ox + gx * 13, oz + gz * 7, 11);
        const r2 = hash2(ox + gx * 5, oz + gz * 17, 23);
        const r3 = hash2(ox + gx * 19, oz + gz * 29, 31);
        const x = ox + gx * cellW + (r1 - 0.5) * cellW * 1.4;
        const z = oz + gz * cellW + (r2 - 0.5) * cellW * 1.4;
        const y = W.groundHeight(x, z);
        if (y < WATER_LEVEL + 0.3) continue;        // skip water
        if (clearR > 0 && Math.hypot(x - ctrX, z - ctrZ) < clearR) continue; // keep the landmark clear
        const cl = W.climate(x, z);
        const slope = W.slope(x, z);
        if (slope > 1.3) continue;                   // skip cliffs
        const dom = cl.dom, dw = cl.domW;

        // ----- per biome scatter -----
        if (dom === 'meadow') {
          if (r3 < 0.7) { // glassgrass tuft
            dummy.position.set(x, y, z); dummy.rotation.set(0, r1 * TAU, 0);
            dummy.scale.setScalar(0.7 + r2 * 0.9); dummy.updateMatrix();
            addInst('tuft', () => new THREE.ConeGeometry(0.14, 1.1, 4), this.M.glow('grass-meadow', 0x6cf0d6, 1.1), dummy.matrix);
          } else if (r3 < 0.76) { // floating stone
            const fy = y + 1.5 + r1 * 2;
            dummy.position.set(x, fy, z); dummy.rotation.set(r1, r2 * TAU, r3); dummy.scale.setScalar(0.8 + r2);
            dummy.updateMatrix();
            addInst('floatstone', () => new THREE.IcosahedronGeometry(0.9, 0), this.M.std('stone-pale', 0x6a73a0, { roughness: 0.7 }), dummy.matrix, true);
          } else if (r3 < 0.82) this._glowpool(addInst, dummy, x, y, z, 0xff8a3c);
          else if (r3 < 0.88) this._bulbStalk(addInst, dummy, x, y, z, 0x8fc0ff);
          else if (r3 < 0.915) this._crystalCluster(addInst, dummy, x, y, z, r1);
          else if (r3 > 0.955) this._glimmer(chunk, x, y + 1.0, z, 'glimmer', 0x9ff0ff);
        } else if (dom === 'desert') {
          if (r3 < 0.16) { // rock spire
            const h = 2 + r1 * 4;
            dummy.position.set(x, y + h / 2, z); dummy.rotation.set(0, r2 * TAU, 0); dummy.scale.set(1 + r1, h, 1 + r2);
            dummy.updateMatrix();
            addInst('drock', () => new THREE.ConeGeometry(1, 1, 5), this.M.std('sandrock', 0xae8350, { roughness: 0.95 }), dummy.matrix, true);
            chunk.walls.push({ type: 'circle', x, z, r: 1 + r1 * 0.5 });
          } else if (r3 < 0.24) { // sun crystal
            const h = 1.2 + r2 * 2.4;
            dummy.position.set(x, y + h / 2, z); dummy.rotation.set(0, r1 * TAU, 0); dummy.scale.set(0.5, h, 0.5);
            dummy.updateMatrix();
            addInst('scrystal', () => new THREE.OctahedronGeometry(1, 0), this.M.glow('crystal-amber', 0xffce6a, 1.5), dummy.matrix);
          } else if (r3 < 0.34) { // icy crystal burst from the sand
            this._crystalCluster(addInst, dummy, x, y, z, r1, [0x9fe8ff, 0x63f7ff, 0xcfeeff]);
          } else if (r3 > 0.965) this._glimmer(chunk, x, y + 1.0, z, 'glimmer', 0xffd98a);
        } else if (dom === 'forest') {
          if (r3 < 0.5 && slope < 0.9) { // light-tree
            this._tree(chunk, addInst, dummy, x, y, z, r1, r2);
            chunk.walls.push({ type: 'circle', x, z, r: 0.7 });
          } else if (r3 < 0.72) { // glow mushroom
            const s = 0.5 + r1 * 1.2;
            dummy.position.set(x, y + 0.3 * s, z); dummy.rotation.set(0, r2 * TAU, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
            addInst('mush', () => new THREE.SphereGeometry(0.4, 8, 6, 0, TAU, 0, Math.PI / 2), this.M.glow('mush', 0x49ffce, 1.3), dummy.matrix);
          } else if (r3 < 0.9) { // fern tuft
            dummy.position.set(x, y, z); dummy.rotation.set(0, r1 * TAU, 0); dummy.scale.setScalar(0.6 + r2 * 0.7); dummy.updateMatrix();
            addInst('fern', () => new THREE.ConeGeometry(0.1, 0.9, 3), this.M.glow('fern', 0x2f8c7a, 0.6), dummy.matrix);
          } else if (r3 < 0.945) this._glowpool(addInst, dummy, x, y, z, 0xff9a3c);
          else if (r3 > 0.965) this._glimmer(chunk, x, y + 1.2, z, 'glimmer', 0x8effe0);
        } else if (dom === 'snow') {
          if (r3 < 0.34 && slope < 1.0) { // pine
            this._pine(chunk, addInst, dummy, x, y, z, r1, r2);
            chunk.walls.push({ type: 'circle', x, z, r: 0.8 });
          } else if (r3 < 0.46) { // ice shard
            const h = 1 + r1 * 3;
            dummy.position.set(x, y + h / 2, z); dummy.rotation.set(0, r2 * TAU, 0.2 * (r1 - 0.5)); dummy.scale.set(0.4, h, 0.4); dummy.updateMatrix();
            addInst('ice', () => new THREE.OctahedronGeometry(1, 0), this.M.glow('ice', 0xbdeeff, 1.0, { opacity: 0.9, transparent: true }), dummy.matrix);
          } else if (r3 < 0.5) { // boulder
            dummy.position.set(x, y + 0.4, z); dummy.rotation.set(r1, r2 * TAU, r3); dummy.scale.setScalar(0.8 + r1 * 1.4); dummy.updateMatrix();
            addInst('snowrock', () => new THREE.IcosahedronGeometry(1, 0), this.M.std('snowrock', 0x59648a, { roughness: 0.9 }), dummy.matrix, true);
          } else if (r3 > 0.965) this._glimmer(chunk, x, y + 1.0, z, 'glimmer', 0xd6f4ff);
        } else if (dom === 'hollow') {
          if (r3 < 0.46) { // dead tree — a denser, spookier wood
            this._deadTree(chunk, addInst, dummy, x, y, z, r1, r2);
            chunk.walls.push({ type: 'circle', x, z, r: 0.6 });
          } else if (r3 < 0.56) { // lantern (limited point lights handled by glow only)
            const h = 1.4 + r1;
            dummy.position.set(x, y + h, z); dummy.scale.setScalar(0.4); dummy.updateMatrix();
            addInst('lantern', () => new THREE.OctahedronGeometry(1, 0), this.M.glow('lantern', 0xffcf85, 2.0), dummy.matrix);
            // a thin post
            dummy.position.set(x, y + h / 2, z); dummy.scale.set(0.08, h, 0.08); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
            addInst('post', () => new THREE.CylinderGeometry(1, 1, 1, 5), this.M.std('post', 0x241b2e), dummy.matrix);
          } else if (r3 < 0.66) { // grave
            dummy.position.set(x, y + 0.5, z); dummy.rotation.set(0.05 * (r1 - 0.5), r2 * TAU, 0.06 * (r3 - 0.5)); dummy.scale.set(0.7, 1, 0.18); dummy.updateMatrix();
            addInst('grave', () => new THREE.BoxGeometry(1, 1, 1), this.M.std('grave', 0x3c3048, { roughness: 0.95 }), dummy.matrix, true);
          } else if (r3 < 0.74) this._glowpool(addInst, dummy, x, y, z, 0xffb060);
          else if (r3 > 0.95) this._glimmer(chunk, x, y + 1.0, z, 'glimmer', 0xc6a9ff);
        } else if (dom === 'shrine') {
          if (r3 < 0.12) { // monolith
            const h = 3 + r1 * 4;
            dummy.position.set(x, y + h / 2, z); dummy.rotation.set(0, r2 * TAU, 0); dummy.scale.set(0.8, h, 0.5); dummy.updateMatrix();
            addInst('monolith', () => new THREE.BoxGeometry(1, 1, 1), this.M.std('monolith', 0x4a416e, { roughness: 0.6, emissive: 0x2a2456, emissiveIntensity: 0.4 }), dummy.matrix, true);
            chunk.walls.push({ type: 'circle', x, z, r: 0.7 });
          } else if (r3 < 0.2) { // candle
            dummy.position.set(x, y + 0.6, z); dummy.scale.setScalar(0.25); dummy.updateMatrix();
            addInst('candle', () => new THREE.OctahedronGeometry(1, 0), this.M.glow('candle', 0xffe9a8, 2.2), dummy.matrix);
          } else if (r3 < 0.32) this._crystalCluster(addInst, dummy, x, y, z, r1);
          else if (r3 < 0.4) this._glowpool(addInst, dummy, x, y, z, 0xffd98a);
          else if (r3 > 0.95) this._glimmer(chunk, x, y + 1.2, z, 'memory', 0xffe9a8);
        } else if (dom === 'city') {
          // handled below as a structured district
        }
      }
    }

    // ----- city is structured (towers + rails + pads), not scattered -----
    if (this._cityWeightHigh(cx, cz)) this._buildCityBlock(chunk, cx, cz);

    // ----- build the landmark (interior) chosen above, into its cleared space -----
    if (landmark) landmark();

    // ----- realize instanced buckets -----
    for (const [kind, b] of buckets) {
      if (b.mats.length === 0) continue;
      const inst = new THREE.InstancedMesh(b.geo, b.mat, b.mats.length);
      for (let i = 0; i < b.mats.length; i++) inst.setMatrixAt(i, b.mats[i]);
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = b.shadow;
      inst.frustumCulled = true;
      // compute a bounding sphere big enough that it doesn't vanish early
      inst.geometry.computeBoundingSphere();
      chunk.group.add(inst);
    }
  }

  _tree(chunk, addInst, dummy, x, y, z, r1, r2) {
    const h = 4 + r1 * 6;
    dummy.position.set(x, y + h / 2, z); dummy.rotation.set(0, r2 * TAU, 0); dummy.scale.set(0.35 + r2 * 0.2, h, 0.35 + r2 * 0.2); dummy.updateMatrix();
    addInst('trunk', () => new THREE.CylinderGeometry(0.5, 0.9, 1, 6), this.M.std('trunk-forest', 0x1c2b26, { roughness: 0.95 }), dummy.matrix, true);
    const cy = y + h + 0.5;
    const variants = [0x49ffce, 0x2e6cff, 0x9a4dff];
    const col = variants[(r1 * 3) | 0];
    dummy.position.set(x, cy, z); dummy.rotation.set(0, r1 * TAU, 0); dummy.scale.setScalar(2.4 + r2 * 1.8); dummy.updateMatrix();
    addInst('canopy' + col, () => new THREE.IcosahedronGeometry(1, 1), this.M.glow('canopy' + col, col, 0.5, { roughness: 0.6 }), dummy.matrix);
  }

  _pine(chunk, addInst, dummy, x, y, z, r1, r2) {
    const h = 3.5 + r1 * 4;
    dummy.position.set(x, y + h * 0.32, z); dummy.scale.set(0.18, h * 0.5, 0.18); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    addInst('pinetrunk', () => new THREE.CylinderGeometry(0.6, 1, 1, 5), this.M.std('pinetrunk', 0x2a2438), dummy.matrix);
    for (let t = 0; t < 3; t++) {
      const ly = y + h * (0.45 + t * 0.22);
      const s = (2.2 - t * 0.55) * (0.8 + r2 * 0.3);
      dummy.position.set(x, ly, z); dummy.rotation.set(0, r1 * TAU, 0); dummy.scale.set(s, h * 0.26, s); dummy.updateMatrix();
      addInst('pinecone', () => new THREE.ConeGeometry(1, 1, 6), this.M.std('pineleaf', 0xc9dcff, { roughness: 0.85, emissive: 0x2a3a66, emissiveIntensity: 0.15 }), dummy.matrix, true);
    }
  }

  _deadTree(chunk, addInst, dummy, x, y, z, r1, r2) {
    const h = 3 + r1 * 4;
    dummy.position.set(x, y + h / 2, z); dummy.rotation.set(0.05 * (r1 - 0.5), r2 * TAU, 0.08 * (r2 - 0.5)); dummy.scale.set(0.22, h, 0.22); dummy.updateMatrix();
    addInst('deadtrunk', () => new THREE.CylinderGeometry(0.3, 0.7, 1, 5), this.M.std('deadtrunk', 0x1a1420), dummy.matrix, true);
    for (let b = 0; b < 3; b++) {
      const a = r1 * TAU + b * 2.1;
      const by = y + h * (0.5 + b * 0.15);
      dummy.position.set(x + Math.cos(a) * 0.7, by, z + Math.sin(a) * 0.7);
      dummy.rotation.set(0, a, 1.1); dummy.scale.set(0.1, 1.6, 0.1); dummy.updateMatrix();
      addInst('deadbranch', () => new THREE.CylinderGeometry(0.15, 0.4, 1, 4), this.M.std('deadtrunk', 0x1a1420), dummy.matrix);
    }
  }

  // a warm amber light-well set into the ground — the complement that makes the
  // cool world pop (and reads cleanly for any color vision).
  _glowpool(addInst, dummy, x, y, z, color) {
    dummy.position.set(x, y + 0.06, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1.6 + Math.random(), 1, 1.6 + Math.random());
    dummy.updateMatrix();
    addInst('glowpool' + color, () => new THREE.CylinderGeometry(1, 1, 0.12, 18), this.M.glow('gp' + color, color, 1.7, { roughness: 0.3 }), dummy.matrix);
    // a darker rim
    dummy.position.set(x, y + 0.04, z); dummy.scale.set(2.0 + Math.random(), 1, 2.0 + Math.random()); dummy.updateMatrix();
    addInst('glowrim', () => new THREE.TorusGeometry(1, 0.18, 6, 18), this.M.std('gprim', 0x2a2440, { roughness: 0.7 }), dummy.matrix);
  }

  // a burst of alien crystal — cyan, violet, amber shards of varying height.
  _crystalCluster(addInst, dummy, x, y, z, r1, palette) {
    const cols = palette || [0x63f7ff, 0xb070ff, 0xffb060];
    const n = 3 + ((r1 * 3) | 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + r1 * 6;
      const cx = x + Math.cos(a) * (0.3 + i * 0.25), cz = z + Math.sin(a) * (0.3 + i * 0.25);
      const h = 0.8 + Math.random() * 2.6;
      const col = cols[(Math.random() * cols.length) | 0];
      dummy.position.set(cx, y + h / 2, cz); dummy.rotation.set(0.2 * (Math.random() - 0.5), a, 0.15 * (Math.random() - 0.5));
      dummy.scale.set(0.3 + Math.random() * 0.2, h, 0.3 + Math.random() * 0.2); dummy.updateMatrix();
      addInst('xtl' + col, () => new THREE.OctahedronGeometry(1, 0), this.M.glow('xtl' + col, col, 1.4, { roughness: 0.25 }), dummy.matrix);
    }
  }

  // bulb-tipped light stalks (the soft blue flowers from the dream)
  _bulbStalk(addInst, dummy, x, y, z, color) {
    const h = 0.8 + Math.random() * 1.4;
    dummy.position.set(x, y + h / 2, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(0.05, h, 0.05); dummy.updateMatrix();
    addInst('stalk', () => new THREE.CylinderGeometry(1, 1, 1, 4), this.M.std('stalk', 0x2a3a5a), dummy.matrix);
    dummy.position.set(x, y + h, z); dummy.scale.setScalar(0.22 + Math.random() * 0.12); dummy.updateMatrix();
    addInst('bulb' + color, () => new THREE.SphereGeometry(1, 8, 6), this.M.glow('bulb' + color, color, 2.0), dummy.matrix);
  }

  _glimmer(chunk, x, y, z, kind, color) {
    const isMemory = kind === 'memory';
    const geo = this.M.geo('glimmer', () => new THREE.OctahedronGeometry(0.35, 0));
    const mesh = new THREE.Mesh(geo, this.M.glow('gl-' + color, color, isMemory ? 2.6 : 1.8));
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(isMemory ? 1.6 : 1);
    chunk.group.add(mesh);
    const c = { x, y, z, kind, color, mesh, taken: false, dashable: true, baseY: y, phase: hash2(x | 0, z | 0, 3) * TAU,
                value: isMemory ? 5 : 1 };
    if (isMemory) {
      const light = new THREE.PointLight(color, 8, 14, 2);
      light.position.set(x, y, z); chunk.group.add(light); c.light = light;
    }
    chunk.collectibles.push(c);
    chunk.poi.push(c);
  }

  _cityWeightHigh(cx, cz) {
    // is the chunk centre strongly city?
    const c = this.world.climate(cx * CHUNK + CHUNK / 2, cz * CHUNK + CHUNK / 2);
    return c.dom === 'city' && c.domW > 0.5;
  }

  _buildCityBlock(chunk, cx, cz) {
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const W = this.world, M = this.M;
    const winCols = [0x63f7ff, 0xff6ad5, 0x9a7dff, 0xffd06a];
    const towerCount = 2 + ((hash2(cx, cz, 21) * 3) | 0);
    const towerTops = [];
    for (let i = 0; i < towerCount; i++) {
      const r1 = hash2(cx * 31 + i, cz, 41), r2 = hash2(cx, cz * 31 + i, 43), r3 = hash2(cx + i, cz + i, 47);
      const bx = ox + 8 + r1 * (CHUNK - 16);
      const bz = oz + 8 + r2 * (CHUNK - 16);
      const by = W.groundHeight(bx, bz);
      if (by < WATER_LEVEL + 0.5) continue;
      const w = 4 + r3 * 4, d = 4 + r1 * 4, h = 14 + r2 * 40;
      const col = winCols[(r3 * winCols.length) | 0];
      // body
      const body = new THREE.Mesh(M.geo('tower', () => new THREE.BoxGeometry(1, 1, 1)),
        M.std('citybody', 0x161b30, { roughness: 0.5, metalness: 0.4 }));
      body.position.set(bx, by + h / 2, bz); body.scale.set(w, h, d); body.castShadow = true;
      chunk.group.add(body);
      // emissive window bands (instanced thin slabs)
      const bands = Math.min(10, Math.floor(h / 4));
      const bandGeo = M.geo('band', () => new THREE.BoxGeometry(1, 1, 1));
      const bandMat = M.glow('win' + col, col, 1.4);
      const inst = new THREE.InstancedMesh(bandGeo, bandMat, bands * 2);
      const d3 = new THREE.Object3D(); let bi = 0;
      for (let bnd = 0; bnd < bands; bnd++) {
        const yy = by + 3 + bnd * (h / bands);
        d3.position.set(bx, yy, bz + d / 2 + 0.02); d3.scale.set(w * 0.8, 0.5, 0.1); d3.updateMatrix(); inst.setMatrixAt(bi++, d3.matrix);
        d3.position.set(bx + w / 2 + 0.02, yy, bz); d3.scale.set(0.1, 0.5, d * 0.8); d3.rotation.set(0, 0, 0); d3.updateMatrix(); inst.setMatrixAt(bi++, d3.matrix);
      }
      inst.instanceMatrix.needsUpdate = true; chunk.group.add(inst);
      // collider + roof platform
      chunk.walls.push({ type: 'box', minx: bx - w / 2, maxx: bx + w / 2, minz: bz - d / 2, maxz: bz + d / 2 });
      chunk.platforms.push({ minx: bx - w / 2, maxx: bx + w / 2, minz: bz - d / 2, maxz: bz + d / 2, top: by + h });
      towerTops.push({ x: bx, y: by + h, z: bz });
      // a glimmer on the roof rewards going up
      if (r3 > 0.4) this._glimmer(chunk, bx, by + h + 1.2, bz, r1 > 0.85 ? 'memory' : 'glimmer', col);
    }
    // grind rails linking tower tops (the second layer)
    if (towerTops.length >= 2) {
      for (let i = 0; i < towerTops.length - 1; i++) {
        const a = towerTops[i], b = towerTops[i + 1];
        const mid = new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + 3, (a.z + b.z) / 2);
        const pts = [new THREE.Vector3(a.x, a.y + 1, a.z), mid, new THREE.Vector3(b.x, b.y + 1, b.z)];
        const rail = new Rail(pts, false, 0x63f7ff);
        chunk.rails.push(rail);
        this._railMesh(chunk, rail);
      }
      // air pad at the base of the first tower to launch you up
      const t0 = towerTops[0];
      const padY = W.groundHeight(t0.x, t0.z);
      chunk.airpads.push({ x: t0.x, z: t0.z, r: 2.2, y: padY, power: 17 });
      const pad = new THREE.Mesh(M.geo('pad', () => new THREE.CylinderGeometry(2.2, 2.2, 0.3, 16)), M.glow('pad', 0x63f7ff, 1.8));
      pad.position.set(t0.x, padY + 0.15, t0.z); chunk.group.add(pad);
    }
  }

  _railMesh(chunk, rail) {
    const curve = new THREE.CatmullRomCurve3(rail.points, rail.closed);
    const geo = new THREE.TubeGeometry(curve, Math.max(8, Math.ceil(rail.length / 2)), 0.16, 6, rail.closed);
    geo._unique = true;
    const mesh = new THREE.Mesh(geo, this.M.glow('rail', rail.color, 1.8));
    chunk.group.add(mesh);
    chunk.disposables.push(geo);
    // soft glow shell
    const shell = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: rail.color, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending }));
    shell.scale.setScalar(2.4); chunk.group.add(shell);
  }
}

// entities.js — everything that moves on its own. Gentle creatures that make
// the world feel inhabited (and scatter when you dash past), the strange eerie
// things that mean you harm, the glimmers you gather, and the combat juice that
// rewards flow: a homing dash that kills, a light-pulse, and combos that pour a
// sliver of light back into you.
import * as THREE from 'three';
import { clamp, clamp01, lerp, hash2, TAU } from '../engine/util.js';

const ENEMY = {
  husk: { name: 'Husk', color: 0xcfe0ff, body: 0x0c0a14, hp: 3, speed: 3.6, size: 1.0, hover: 0, contact: 12, ring: 'broken' },
  sentinel: { name: 'Sentinel', color: 0xff9adf, body: 0x18122a, hp: 4, speed: 2.2, size: 1.2, hover: 6, ranged: true, contact: 8, ring: 'eye' },
  chorus: { name: 'Chorus', color: 0xbfa0ff, body: 0x140f24, hp: 5, speed: 1.6, size: 0.9, hover: 3, orbits: 5, contact: 9, ring: 'cluster' },
  wraith: { name: 'Wraith', color: 0xffcf85, body: 0x0a0710, hp: 2, speed: 5.2, size: 0.9, hover: 0, contact: 14, ring: 'flame' },
};

const CREATURE = {
  driftjelly: { color: 0x8fd0ff, sky: true, size: 1.6 },
  grazer: { color: 0x9ff0c8, sky: false, size: 1.0 },
  school: { color: 0xbfe6ff, sky: true, size: 0.5, swarm: true },
};

export class Entities {
  constructor(ctx) {
    this.ctx = ctx; // { world, scene, fx, audio, rig, controller, hud, game }
    this.world = ctx.world;
    this.scene = ctx.scene;
    this.fx = ctx.fx;
    this.enemies = [];
    this.creatures = [];
    this.pBolts = [];   // player light bolts
    this.eBolts = [];   // enemy orbs
    this._spawnT = 0;
    this._creatureT = 0;
    this._pulseCd = 0;
    this._boltGeo = new THREE.SphereGeometry(0.25, 8, 6);
    this._orbGeo = new THREE.SphereGeometry(0.4, 10, 8);
    this.maxEnemies = 9;
    this.maxCreatures = 22;
    this.world.entities = this; // so dash homing can see enemies
  }

  // ---------- spawning ----------
  _biomeMood(pos) {
    const cl = this.world.climate(pos.x, pos.z);
    return cl.dom;
  }

  _spawnEnemy(playerPos) {
    if (this.enemies.length >= this.maxEnemies) return;
    const dom = this._biomeMood(playerPos);
    // peaceful biomes spawn fewer / none
    let pool;
    if (dom === 'hollow') pool = ['husk', 'wraith', 'husk'];
    else if (dom === 'city') pool = ['sentinel', 'chorus'];
    else if (dom === 'forest') pool = ['husk', 'chorus'];
    else if (dom === 'snow') pool = ['husk'];
    else if (dom === 'desert') pool = ['sentinel'];
    else if (dom === 'shrine') return;     // sacred ground is safe
    else pool = ['husk'];                  // meadow: rare lone husk
    if (dom === 'meadow' && Math.random() > 0.35) return;
    const type = pool[(Math.random() * pool.length) | 0];
    const a = Math.random() * TAU;
    const dist = 36 + Math.random() * 28;
    const x = playerPos.x + Math.cos(a) * dist;
    const z = playerPos.z + Math.sin(a) * dist;
    const gy = this.world.groundHeight(x, z);
    this._makeEnemy(type, x, gy, z);
  }

  _makeEnemy(typeKey, x, gy, z) {
    const def = ENEMY[typeKey];
    const M = this.world.materials;
    const group = new THREE.Group();
    const bodyMat = M.std('en-body-' + typeKey, def.body, { roughness: 0.6, emissive: def.body, emissiveIntensity: 0.2 });
    let body;
    if (typeKey === 'husk') {
      body = new THREE.Mesh(M.geo('en-husk', () => new THREE.CapsuleGeometry(0.45, 1.4, 4, 8)), bodyMat);
      const ringG = M.geo('en-husk-ring', () => new THREE.TorusGeometry(0.5, 0.08, 8, 16));
      const head = new THREE.Mesh(ringG, M.glow('en-husk-eye', def.color, 2.2));
      head.position.y = 1.3; head.rotation.x = Math.PI / 2; group.add(head); group._marker = head;
    } else if (typeKey === 'sentinel') {
      body = new THREE.Mesh(M.geo('en-sent', () => new THREE.OctahedronGeometry(0.9, 0)), bodyMat);
      const eye = new THREE.Mesh(M.geo('en-sent-eye', () => new THREE.SphereGeometry(0.32, 12, 10)), M.glow('en-sent-iris', def.color, 2.6));
      eye.position.z = 0.7; group.add(eye); group._marker = eye;
    } else if (typeKey === 'chorus') {
      body = new THREE.Mesh(M.geo('en-chorus', () => new THREE.IcosahedronGeometry(0.5, 0)), M.glow('en-chorus-core', def.color, 1.6));
    } else { // wraith
      body = new THREE.Mesh(M.geo('en-wraith', () => new THREE.ConeGeometry(0.6, 1.8, 6)), bodyMat);
      const flame = new THREE.Mesh(M.geo('en-wraith-eye', () => new THREE.SphereGeometry(0.3, 10, 8)), M.glow('en-wraith-fl', def.color, 2.6));
      flame.position.y = 0.6; group.add(flame); group._marker = flame;
    }
    body.castShadow = false; group.add(body);
    const e = {
      type: typeKey, def, group, body, hp: def.hp, maxHp: def.hp, alive: true,
      pos: new THREE.Vector3(x, gy + def.size + def.hover, z), vel: new THREE.Vector3(),
      cd: 1 + Math.random(), phase: Math.random() * TAU, hitFlash: 0, orbs: [],
      baseGy: gy,
    };
    if (typeKey === 'chorus') {
      for (let i = 0; i < def.orbits; i++) {
        const o = new THREE.Mesh(M.geo('en-chorus-orb', () => new THREE.SphereGeometry(0.18, 8, 6)), M.glow('en-chorus-orbm', def.color, 2.0));
        group.add(o); e.orbs.push({ mesh: o, a: (i / def.orbits) * TAU });
      }
    }
    group.position.copy(e.pos);
    this.scene.add(group);
    this.enemies.push(e);
    if (this.ctx.onSeen) this.ctx.onSeen('enemy', typeKey, def.name);
  }

  _spawnCreature(playerPos) {
    if (this.creatures.length >= this.maxCreatures) return;
    const dom = this._biomeMood(playerPos);
    const keys = Object.keys(CREATURE);
    let key = keys[(Math.random() * keys.length) | 0];
    if (dom === 'desert') key = Math.random() < 0.5 ? 'school' : 'driftjelly';
    const def = CREATURE[key];
    const M = this.world.materials;
    const a = Math.random() * TAU, dist = 20 + Math.random() * 40;
    const x = playerPos.x + Math.cos(a) * dist, z = playerPos.z + Math.sin(a) * dist;
    const gy = this.world.groundHeight(x, z);
    const group = new THREE.Group();
    let mesh;
    if (key === 'driftjelly') {
      mesh = new THREE.Mesh(M.geo('cr-jelly', () => new THREE.SphereGeometry(0.6, 12, 10, 0, TAU, 0, Math.PI * 0.6)),
        new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.9, transparent: true, opacity: 0.6, roughness: 0.3 }));
      for (let t = 0; t < 5; t++) { const ta = (t / 5) * TAU; const tent = new THREE.Mesh(M.geo('cr-tent', () => new THREE.CylinderGeometry(0.03, 0.01, 1.4, 4)), M.glow('cr-tentm', def.color, 0.8)); tent.position.set(Math.cos(ta) * 0.3, -0.8, Math.sin(ta) * 0.3); group.add(tent); }
    } else if (key === 'grazer') {
      mesh = new THREE.Mesh(M.geo('cr-grazer', () => new THREE.IcosahedronGeometry(0.5, 0)), M.glow('cr-grazerm', def.color, 0.7, { roughness: 0.6 }));
    } else { // school: a few orbs
      mesh = new THREE.Group();
      for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(M.geo('cr-school', () => new THREE.SphereGeometry(0.12, 6, 5)), M.glow('cr-schoolm', def.color, 1.4)); s.position.set((Math.random()-0.5)*1.5,(Math.random()-0.5)*1.5,(Math.random()-0.5)*1.5); mesh.add(s); }
    }
    group.add(mesh);
    const skyY = def.sky ? gy + 6 + Math.random() * 10 : gy + def.size * 0.5;
    const c = { key, def, group, mesh, pos: new THREE.Vector3(x, skyY, z), vel: new THREE.Vector3(), phase: Math.random() * TAU, baseY: skyY, gy, scatter: 0, wander: new THREE.Vector3((Math.random()-0.5), 0, (Math.random()-0.5)).normalize() };
    group.position.copy(c.pos);
    this.scene.add(group);
    this.creatures.push(c);
    if (this.ctx.onSeen) this.ctx.onSeen('creature', key, key);
  }

  // ---------- player attack ----------
  pulse(yaw, pitch, originY) {
    if (this._pulseCd > 0) return;
    this._pulseCd = 0.18;
    const M = this.world.materials;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
    const cam = this.ctx.rig.cam.position;
    const mesh = new THREE.Mesh(this._boltGeo, M.glow('pbolt', 0x9ff0ff, 2.6));
    mesh.position.copy(cam).addScaledVector(dir, 0.6);
    this.scene.add(mesh);
    this.pBolts.push({ mesh, vel: dir.clone().multiplyScalar(70), life: 1.1, pos: mesh.position });
    this.ctx.audio && this.ctx.audio.shoot();
    this.ctx.rig.addFovPunch(2.5);
  }

  // ---------- update ----------
  update(dt, realDt, playerPos, yaw) {
    this._pulseCd = Math.max(0, this._pulseCd - realDt);
    this._spawnT -= dt; this._creatureT -= dt;
    if (this._spawnT <= 0) { this._spawnT = 1.4 + Math.random() * 1.6; this._spawnEnemy(playerPos); }
    if (this._creatureT <= 0) { this._creatureT = 0.8 + Math.random(); this._spawnCreature(playerPos); }

    this._updateCollectibles(dt, playerPos);
    this._updateCreatures(dt, playerPos);
    this._updateEnemies(dt, playerPos, yaw);
    this._updateBolts(dt, realDt, playerPos);
  }

  _updateCollectibles(dt, playerPos) {
    const list = this.world.collectibles;
    const pull = 9;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.taken) continue;
      c.phase += dt * 2;
      const d = Math.hypot(c.x - playerPos.x, c.z - playerPos.z, );
      const dy = (playerPos.y + 1.4) - c.y;
      const dist3 = Math.sqrt(d * d + dy * dy);
      // bob
      if (c.mesh) {
        c.mesh.position.y = c.baseY + Math.sin(c.phase) * 0.25;
        c.mesh.rotation.y += dt * 1.5;
        if (dist3 < pull) {
          // attract toward player
          const k = clamp01((pull - dist3) / pull) * dt * 9;
          c.x = lerp(c.x, playerPos.x, k); c.z = lerp(c.z, playerPos.z, k);
          c.baseY = lerp(c.baseY, playerPos.y + 1.2, k);
          c.mesh.position.x = c.x; c.mesh.position.z = c.z;
          if (c.light) c.light.position.set(c.x, c.mesh.position.y, c.z);
        }
      }
      if (dist3 < 1.7) { this._collect(c); }
    }
  }

  _collect(c) {
    c.taken = true;
    if (c.mesh) { c.mesh.visible = false; }
    if (c.light) c.light.visible = false;
    this.fx.burst(c.x, c.baseY, c.z, c.color, c.kind === 'glimmer' ? 14 : 30, { up: 1, spread: c.kind === 'glimmer' ? 3 : 6, life: 0.9 });
    this.ctx.onCollect && this.ctx.onCollect(c);
  }

  _updateCreatures(dt, playerPos) {
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      c.phase += dt;
      const toP = Math.hypot(c.pos.x - playerPos.x, c.pos.z - playerPos.z);
      // scatter when player dashes nearby or gets close fast
      if (toP < 7 && (this.ctx.controller.dashing || this.ctx.controller.horizSpeed > 11)) c.scatter = 1;
      c.scatter = Math.max(0, c.scatter - dt * 0.8);
      if (c.def.sky) {
        c.pos.x += c.wander.x * dt * 1.5 + (playerPos.x - c.pos.x) * 0 ;
        c.pos.z += c.wander.z * dt * 1.5;
        c.pos.y = c.baseY + Math.sin(c.phase * 0.8) * 0.8;
        c.mesh.scale.setScalar(1 + Math.sin(c.phase * 1.6) * 0.08);
        if (c.scatter > 0) { const away = new THREE.Vector3(c.pos.x - playerPos.x, 1, c.pos.z - playerPos.z).normalize(); c.pos.addScaledVector(away, dt * 14 * c.scatter); }
      } else {
        // grazer wanders the ground
        if (Math.random() < dt * 0.4) c.wander.set((Math.random()-0.5), 0, (Math.random()-0.5)).normalize();
        let sp = 1.4;
        if (c.scatter > 0) { c.wander.set(c.pos.x - playerPos.x, 0, c.pos.z - playerPos.z).normalize(); sp = 10 * c.scatter + 1.4; }
        c.pos.x += c.wander.x * dt * sp; c.pos.z += c.wander.z * dt * sp;
        c.pos.y = this.world.groundHeight(c.pos.x, c.pos.z) + c.def.size * 0.5 + Math.abs(Math.sin(c.phase * 4)) * 0.15 * (c.scatter > 0 ? 3 : 1);
        c.group.rotation.y = Math.atan2(c.wander.x, c.wander.z);
      }
      c.group.position.copy(c.pos);
      if (toP > 130) { this.scene.remove(c.group); this.creatures.splice(i, 1); }
    }
  }

  _updateEnemies(dt, playerPos, yaw) {
    const ctrl = this.ctx.controller;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive) { this.scene.remove(e.group); this.enemies.splice(i, 1); continue; }
      e.phase += dt; e.cd -= dt; e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
      const toP = new THREE.Vector3(playerPos.x - e.pos.x, 0, playerPos.z - e.pos.z);
      const dist = toP.length();
      toP.normalize();
      const def = e.def;
      // face the player
      e.group.rotation.y = Math.atan2(toP.x, toP.z);

      if (def.ranged) {
        // keep distance, strafe, and fire telegraphed orbs
        const want = 16;
        const move = dist > want + 2 ? 1 : dist < want - 2 ? -1 : 0;
        e.pos.x += toP.x * move * def.speed * dt;
        e.pos.z += toP.z * move * def.speed * dt;
        e.pos.y = e.baseGy + def.hover + def.size + Math.sin(e.phase) * 0.5;
        if (e.cd <= 0 && dist < 40) { e.cd = 2.6; this._enemyFire(e, playerPos); }
      } else if (e.type === 'chorus') {
        e.pos.x += toP.x * def.speed * dt; e.pos.z += toP.z * def.speed * dt;
        e.pos.y = e.baseGy + def.hover + def.size + Math.sin(e.phase) * 0.4;
        for (const o of e.orbs) { o.a += dt * 2.2; o.mesh.position.set(Math.cos(o.a) * 1.3, Math.sin(o.a * 1.3) * 0.4, Math.sin(o.a) * 1.3); }
      } else {
        // husk / wraith: advance and lunge
        let sp = def.speed;
        if (dist < 6) sp *= 1.7;
        e.pos.x += toP.x * sp * dt; e.pos.z += toP.z * sp * dt;
        const gy = this.world.groundHeight(e.pos.x, e.pos.z);
        e.baseGy = gy;
        e.pos.y = gy + def.size + Math.abs(Math.sin(e.phase * 3)) * 0.2;
      }
      e.group.position.copy(e.pos);
      // hit flash tint
      if (e.body && e.body.material && e.body.material.emissive) {
        e.body.material.emissiveIntensity = (e.type === 'chorus' ? 1.6 : 0.2) + e.hitFlash * 2;
      }
      if (e.group._marker) e.group._marker.scale.setScalar(1 + Math.sin(e.phase * 4) * 0.12 + e.hitFlash);

      // contact damage to player (unless player has i-frames)
      const pd = Math.hypot(e.pos.x - playerPos.x, e.pos.z - playerPos.z);
      const pvy = Math.abs(e.pos.y - (playerPos.y + 1));
      if (pd < 1.5 && pvy < 2.4) {
        if (ctrl.iframes > 0 && (ctrl.dashing)) { this._damageEnemy(e, 2, playerPos); }
        else if (this.ctx.damagePlayer) this.ctx.damagePlayer(def.contact, e.pos);
      }
      // despawn far
      if (dist > 140) { this.scene.remove(e.group); this.enemies.splice(i, 1); }
    }
  }

  _enemyFire(e, playerPos) {
    const M = this.world.materials;
    const dir = new THREE.Vector3(playerPos.x - e.pos.x, (playerPos.y + 1) - e.pos.y, playerPos.z - e.pos.z).normalize();
    const mesh = new THREE.Mesh(this._orbGeo, M.glow('eorb', e.def.color, 2.2));
    mesh.position.copy(e.pos);
    this.scene.add(mesh);
    this.eBolts.push({ mesh, vel: dir.multiplyScalar(13), life: 3.5, pos: mesh.position });
    this.ctx.audio && this.ctx.audio.enemyShoot(e.pos);
  }

  _damageEnemy(e, amount, playerPos) {
    if (!e.alive) return;
    e.hp -= amount; e.hitFlash = 1;
    this.fx.burst(e.pos.x, e.pos.y + 0.5, e.pos.z, e.def.color, 8, { spread: 4, life: 0.5 });
    this.ctx.audio && this.ctx.audio.hit(e.pos);
    if (e.type === 'chorus' && e.orbs.length) {
      const o = e.orbs.pop(); e.group.remove(o.mesh);
    }
    if (e.hp <= 0) this._killEnemy(e, playerPos);
  }

  _killEnemy(e, playerPos) {
    e.alive = false;
    this.fx.burst(e.pos.x, e.pos.y + 0.6, e.pos.z, e.def.color, 28, { spread: 7, up: 2, life: 1.0 });
    this.fx.ring(e.pos.x, e.pos.y + 0.5, e.pos.z, e.def.color, 18, 0.6, 7);
    this.fx.addHitstop(0.06);
    this.ctx.audio && this.ctx.audio.kill(e.pos);
    // the light it hoarded spills out as glimmers
    const n = e.type === 'wraith' ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      this._dropGlimmer(e.pos.x + Math.cos(a) * 1.2, e.pos.y + 0.5, e.pos.z + Math.sin(a) * 1.2, e.def.color);
    }
    this.ctx.onKill && this.ctx.onKill(e);
  }

  _dropGlimmer(x, y, z, color) {
    const M = this.world.materials;
    const mesh = new THREE.Mesh(M.geo('glimmer', () => new THREE.OctahedronGeometry(0.35, 0)), M.glow('gl-' + color, color, 1.8));
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    const c = { x, y, z, kind: 'glimmer', color, mesh, taken: false, dashable: false, baseY: y, phase: 0, value: 1, _dropped: true };
    this.world.collectibles.push(c);
  }

  _updateBolts(dt, realDt, playerPos) {
    // player bolts
    for (let i = this.pBolts.length - 1; i >= 0; i--) {
      const b = this.pBolts[i];
      b.life -= realDt;
      b.pos.addScaledVector(b.vel, dt);
      let hit = false;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (b.pos.distanceTo(e.pos) < e.def.size + 0.6) { this._damageEnemy(e, 1, playerPos); hit = true; break; }
      }
      // terrain block
      if (!hit && b.pos.y < this.world.groundHeight(b.pos.x, b.pos.z)) hit = true;
      if (hit || b.life <= 0) { this.scene.remove(b.mesh); this.pBolts.splice(i, 1); }
    }
    // enemy orbs
    for (let i = this.eBolts.length - 1; i >= 0; i--) {
      const b = this.eBolts[i];
      b.life -= realDt;
      b.pos.addScaledVector(b.vel, dt);
      const ctrl = this.ctx.controller;
      const pd = b.pos.distanceTo(new THREE.Vector3(playerPos.x, playerPos.y + 1, playerPos.z));
      if (pd < 1.1) {
        if (!(ctrl.iframes > 0)) { this.ctx.damagePlayer && this.ctx.damagePlayer(8, b.pos); }
        else { this.fx.burst(b.pos.x, b.pos.y, b.pos.z, 0x9ff0ff, 8, { spread: 3, life: 0.4 }); }
        this.scene.remove(b.mesh); this.eBolts.splice(i, 1); continue;
      }
      if (b.life <= 0) { this.scene.remove(b.mesh); this.eBolts.splice(i, 1); }
    }
  }

  clear() {
    for (const e of this.enemies) this.scene.remove(e.group);
    for (const c of this.creatures) this.scene.remove(c.group);
    for (const b of this.pBolts) this.scene.remove(b.mesh);
    for (const b of this.eBolts) this.scene.remove(b.mesh);
    this.enemies.length = 0; this.creatures.length = 0; this.pBolts.length = 0; this.eBolts.length = 0;
  }
}

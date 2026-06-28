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
    this.magnetMul = 1;   // boon: wider light-pull
    this.pulseDmg = 1;    // boon: stronger light
    this.boss = null;
    this.bossWaves = [];
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
    const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();
    const cam = this.ctx.rig.cam.position;
    const mesh = new THREE.Mesh(this._boltGeo, M.glow('pbolt', 0x9ff0ff, 2.6));
    mesh.position.copy(cam).addScaledVector(dir, 0.6);
    this.scene.add(mesh);
    this.pBolts.push({ mesh, vel: dir.clone().multiplyScalar(70), life: 1.1, pos: mesh.position });
    this.ctx.audio && this.ctx.audio.shoot();
    this.ctx.rig.addFovPunch(2.5);
  }

  // ---------- sense: reveal what the world is hiding ----------
  sense(playerPos, radius) {
    let revealed = 0;
    for (const c of this.world.collectibles) {
      if (!c.hidden || c.taken) continue;
      const d = Math.hypot(c.x - playerPos.x, c.z - playerPos.z, c.baseY - (playerPos.y + 1));
      if (d <= radius) {
        c.hidden = false;
        if (c.mesh) c.mesh.visible = true;
        if (c.light) c.light.visible = true;
        this.fx.burst(c.x, c.baseY, c.z, c.color, 12, { spread: 3, up: 1, life: 0.8 });
        revealed++;
      }
    }
    this.fx.ring(playerPos.x, playerPos.y + 1, playerPos.z, 0xbfe6ff, 28, 1.0, 12);
    return revealed;
  }
  // is something still hidden nearby? (for the gentle "sense" hint)
  hiddenNear(playerPos, radius) {
    for (const c of this.world.collectibles) {
      if (!c.hidden || c.taken) continue;
      const d = Math.hypot(c.x - playerPos.x, c.z - playerPos.z);
      if (d <= radius) return true;
    }
    return false;
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
    this._updateBoss(dt, realDt, playerPos);
    this._updateBolts(dt, realDt, playerPos);
  }

  _updateCollectibles(dt, playerPos) {
    const list = this.world.collectibles;
    const pull = 9 * this.magnetMul;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.taken || c.hidden) continue;   // hidden vaults must be sensed first
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
        if (b.pos.distanceTo(e.pos) < e.def.size + 0.6) { this._damageEnemy(e, this.pulseDmg, playerPos); hit = true; break; }
      }
      // the boss: light strikes its lanterns, then its core
      if (!hit && this.boss && this.boss.alive) {
        const tmp = new THREE.Vector3();
        for (const ln of this.boss.lanterns) { if (!ln.alive) continue; ln.mesh.getWorldPosition(tmp); if (b.pos.distanceTo(tmp) < 1.5) { this._hitLantern(this.boss, ln); hit = true; break; } }
        if (!hit && this.boss.exposed) { this.boss.core.getWorldPosition(tmp); if (b.pos.distanceTo(tmp) < 1.9) { this._hitCore(this.boss, this.pulseDmg); hit = true; } }
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
      if (pd < (b.dmg ? 1.5 : 1.1)) {
        if (!(ctrl.iframes > 0)) { this.ctx.damagePlayer && this.ctx.damagePlayer(b.dmg || 8, b.pos); }
        else { // a dash through fire — perfect dodge, time leans back a moment
          this.fx.burst(b.pos.x, b.pos.y, b.pos.z, 0x9ff0ff, 8, { spread: 3, life: 0.4 });
          if (ctrl.dashing && this.fx._slowmo <= 0) { this.fx.addSlowmo(0.22); this.ctx.audio && this.ctx.audio.combo(2); }
        }
        this.scene.remove(b.mesh); this.eBolts.splice(i, 1); continue;
      }
      if (b.life <= 0) { this.scene.remove(b.mesh); this.eBolts.splice(i, 1); }
    }
  }

  // ===================== THE KEEPER (boss) =====================
  // A tall glass-and-shadow figure ringed by orbiting lanterns. Break the
  // lanterns (dash through them or strike them with light) to expose its core,
  // then dash the core to finish it. It sweeps the ground and lobs slow fire —
  // beautiful, sad, and pinball to fight.
  spawnBoss(x, gy, z) {
    if (this.boss) return;
    const M = this.world.materials;
    const group = new THREE.Group();
    // a dark robe gives it a silhouette against any sky; the glass within glows
    const robe = new THREE.MeshStandardMaterial({ color: 0x0a0713, roughness: 1, side: THREE.DoubleSide, emissive: 0x1a1330, emissiveIntensity: 0.35 });
    const shroud = new THREE.Mesh(M.geo('boss-shroud', () => new THREE.ConeGeometry(3.2, 9.5, 14, 1, true)), robe);
    shroud.position.y = 4.7; group.add(shroud);
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfd0ff, transparent: true, opacity: 0.6, emissive: 0x8fa8ff, emissiveIntensity: 1.5, roughness: 0.15, metalness: 0.1 });
    const body = new THREE.Mesh(M.geo('boss-body', () => new THREE.CapsuleGeometry(1.7, 5, 8, 16)), glass);
    body.position.y = 4.6; group.add(body);
    const head = new THREE.Mesh(M.geo('boss-head', () => new THREE.IcosahedronGeometry(1.5, 1)), glass);
    head.position.y = 9.0; group.add(head);
    const crown = new THREE.Mesh(M.geo('boss-crown', () => new THREE.TorusGeometry(1.4, 0.12, 6, 20)), M.glow('boss-crownm', 0xffcf85, 2.2));
    crown.position.y = 9.0; crown.rotation.x = Math.PI / 2; group.add(crown);
    const coreMat = M.glow('boss-core', 0xffd9a8, 0.5);
    const core = new THREE.Mesh(M.geo('boss-corem', () => new THREE.IcosahedronGeometry(0.95, 0)), coreMat);
    core.position.y = 4.6; group.add(core);
    const lanterns = [];
    const lcount = 6;
    for (let i = 0; i < lcount; i++) {
      const l = new THREE.Mesh(M.geo('boss-lan', () => new THREE.OctahedronGeometry(0.72, 0)), M.glow('boss-lanm', 0xffcf85, 3.0));
      group.add(l);
      lanterns.push({ mesh: l, a: (i / lcount) * TAU, alive: true, hp: 2 });
    }
    const halo = new THREE.PointLight(0xaec4ff, 20, 48, 2); halo.position.y = 6; group.add(halo);
    group.position.set(x, gy, z);
    this.scene.add(group);
    this.boss = {
      group, body, head, core, coreMat, lanterns, halo, name: 'The Keeper',
      pos: new THREE.Vector3(x, gy, z), gy, phase: 0, cd: 3.5, exposed: false,
      coreHp: 6, maxHp: lcount * 2 + 6, alive: true, flash: 0,
    };
    if (this.ctx.onBossSpawn) this.ctx.onBossSpawn(this.boss);
  }

  _bossFrac() {
    const B = this.boss; if (!B) return 0;
    let cur = B.coreHp;
    for (const l of B.lanterns) if (l.alive) cur += l.hp;
    return clamp01(cur / B.maxHp);
  }

  _updateBoss(dt, realDt, playerPos) {
    const B = this.boss;
    // shockwaves persist even past death animation
    for (let i = this.bossWaves.length - 1; i >= 0; i--) {
      const w = this.bossWaves[i];
      w.r += w.spd * dt; w.life -= dt;
      w.mesh.scale.set(w.r, w.r, w.r); w.mesh.material.opacity = clamp01(w.life) * 0.5;
      // damage if the player is on the ground in the ring and not dashing
      const d = Math.hypot(playerPos.x - w.x, playerPos.z - w.z);
      if (Math.abs(d - w.r) < 1.3 && this.ctx.controller.onGround && !(this.ctx.controller.iframes > 0) && !w.hitPlayer) {
        w.hitPlayer = true; this.ctx.damagePlayer && this.ctx.damagePlayer(12, { x: w.x, y: playerPos.y, z: w.z });
      }
      if (w.life <= 0) { this.scene.remove(w.mesh); this.bossWaves.splice(i, 1); }
    }
    if (!B || !B.alive) return;
    B.phase += dt; B.cd -= dt; B.flash = Math.max(0, B.flash - dt * 4);
    const to = new THREE.Vector3(playerPos.x - B.pos.x, 0, playerPos.z - B.pos.z);
    const dist = to.length(); to.normalize();
    const want = 13, mv = dist > want + 2 ? 1 : dist < want - 3 ? -1 : 0;
    B.pos.x += to.x * mv * 2.4 * dt; B.pos.z += to.z * mv * 2.4 * dt;
    B.gy = this.world.groundHeight(B.pos.x, B.pos.z); B.pos.y = B.gy;
    B.group.position.copy(B.pos);
    B.group.rotation.y = Math.atan2(to.x, to.z);
    const r = 4.2 + Math.sin(B.phase * 0.6) * 0.5;
    for (const ln of B.lanterns) {
      if (!ln.alive) continue;
      ln.a += dt * 1.0;
      ln.mesh.position.set(Math.cos(ln.a) * r, 4.6 + Math.sin(ln.a * 1.3 + B.phase) * 1.6, Math.sin(ln.a) * r);
    }
    B.exposed = B.lanterns.every((l) => !l.alive);
    B.coreMat.emissiveIntensity = (B.exposed ? 2.8 : 0.4) + B.flash * 2;
    B.core.scale.setScalar((B.exposed ? 1.5 : 0.9) + B.flash * 0.3);
    B.body.material.emissiveIntensity = 0.8 + B.flash * 1.5;

    if (B.cd <= 0) {
      B.cd = B.exposed ? 2.0 : 3.2;
      this._bossShockwave(B);
      for (let i = -1; i <= 1; i++) this._bossOrb(B, playerPos, i);
      this.ctx.audio && this.ctx.audio.bossCry();
    }

    // melee: dash through lanterns / core
    const ctrl = this.ctx.controller;
    const tmp = new THREE.Vector3();
    if (ctrl.dashing && ctrl.iframes > 0) {
      for (const ln of B.lanterns) { if (!ln.alive) continue; ln.mesh.getWorldPosition(tmp); if (tmp.distanceTo(ctrl.pos) < 1.8) this._hitLantern(B, ln); }
      if (B.exposed) { B.core.getWorldPosition(tmp); if (tmp.distanceTo(ctrl.pos) < 2.2) this._hitCore(B, 2); }
    }
    // body contact damage
    if (dist < 2.6 && !(ctrl.iframes > 0)) this.ctx.damagePlayer && this.ctx.damagePlayer(11, B.pos);

    if (this.ctx.onBossHp) this.ctx.onBossHp(B.name, this._bossFrac());
  }

  _hitLantern(B, ln) {
    ln.hp -= 1; B.flash = 1;
    const lp = new THREE.Vector3(); ln.mesh.getWorldPosition(lp);
    this.fx.burst(lp.x, lp.y, lp.z, 0xffcf85, 12, { spread: 4, life: 0.6 });
    this.ctx.audio && this.ctx.audio.hit(lp);
    if (ln.hp <= 0) {
      ln.alive = false; ln.mesh.visible = false;
      this.fx.ring(lp.x, lp.y, lp.z, 0xffcf85, 18, 0.6, 8);
      this.fx.addHitstop(0.05);
      this._dropGlimmer(lp.x, lp.y, lp.z, 0xffcf85);
    }
  }
  _hitCore(B, dmg) {
    if (!B.exposed) return;
    B.coreHp -= dmg; B.flash = 1;
    const cp = new THREE.Vector3(); B.core.getWorldPosition(cp);
    this.fx.burst(cp.x, cp.y, cp.z, 0xffe9a8, 16, { spread: 5, life: 0.7 });
    this.fx.addHitstop(0.06);
    this.ctx.audio && this.ctx.audio.kill(cp);
    if (B.coreHp <= 0) this._killBoss(B);
  }
  _killBoss(B) {
    B.alive = false;
    const c = B.pos;
    this.fx.burst(c.x, c.y + 4, c.z, 0xffe9a8, 60, { spread: 10, up: 4, life: 1.4 });
    this.fx.ring(c.x, c.y + 1, c.z, 0xffe9a8, 36, 1.0, 12);
    this.fx.addHitstop(0.12);
    for (let i = 0; i < 5; i++) { const a = Math.random() * TAU; this._dropGlimmer(c.x + Math.cos(a) * 2, c.y + 1, c.z + Math.sin(a) * 2, 0xffe9a8); }
    this.scene.remove(B.group);
    this.boss = null;
    if (this.ctx.onBossDeath) this.ctx.onBossDeath(c.clone());
  }
  _bossShockwave(B) {
    const geo = this.world.materials.geo('shockwave', () => new THREE.TorusGeometry(1, 0.12, 6, 32));
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8a4a, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat); mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(B.pos.x, B.gy + 0.3, B.pos.z); this.scene.add(mesh);
    this.bossWaves.push({ mesh, x: B.pos.x, z: B.pos.z, r: 1, spd: 11, life: 1.6, hitPlayer: false });
  }
  _bossOrb(B, playerPos, spread) {
    const M = this.world.materials;
    const dir = new THREE.Vector3(playerPos.x - B.pos.x, (playerPos.y + 1) - (B.pos.y + 4.6), playerPos.z - B.pos.z).normalize();
    const rot = spread * 0.26; const cs = Math.cos(rot), sn = Math.sin(rot);
    const dx = dir.x * cs - dir.z * sn, dz = dir.x * sn + dir.z * cs;
    const mesh = new THREE.Mesh(this._orbGeo, M.glow('borb', 0xffb060, 2.4)); mesh.scale.setScalar(1.6);
    mesh.position.set(B.pos.x, B.pos.y + 4.6, B.pos.z); this.scene.add(mesh);
    this.eBolts.push({ mesh, vel: new THREE.Vector3(dx, dir.y, dz).multiplyScalar(11), life: 4, pos: mesh.position, dmg: 12 });
  }

  clear() {
    if (this.boss) { this.scene.remove(this.boss.group); this.boss = null; }
    for (const w of this.bossWaves) this.scene.remove(w.mesh);
    this.bossWaves.length = 0;
    for (const e of this.enemies) this.scene.remove(e.group);
    for (const c of this.creatures) this.scene.remove(c.group);
    for (const b of this.pBolts) this.scene.remove(b.mesh);
    for (const b of this.eBolts) this.scene.remove(b.mesh);
    this.enemies.length = 0; this.creatures.length = 0; this.pBolts.length = 0; this.eBolts.length = 0;
  }
}

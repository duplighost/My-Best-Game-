// controller.js — first-person movement. This is the part that has to feel
// perfect: fast and smooth, with a dash that snaps, a slide that flows, a glide
// that lets you hang in the air over a giant world, and rails that carry your
// momentum. Built on Quake-style accelerate/friction so strafing feels alive.
import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, shortestAngle } from '../engine/util.js';

const EYE_STAND = 1.62;
const EYE_SLIDE = 0.85;
const RADIUS = 0.46;
const GRAVITY = 23;
const GLIDE_GRAVITY = 5.2;
const GLIDE_MAX_FALL = 4.2;
const WALK = 7.6;
const SPRINT = 12.8;
const ACCEL_GROUND = 92;
const ACCEL_AIR = 30;
const AIR_CAP = 1.7;
const FRICTION = 9.2;
const STOP_SPEED = 2.4;
const JUMP_VEL = 9.6;
const COYOTE = 0.12;
const JUMP_BUFFER = 0.12;
const DASH_SPEED = 27;
const DASH_TIME = 0.20;
const DASH_CD = 0.62;
const DASH_HOME_CONE = 0.62;   // cos of half-angle the dash will home within
const DASH_HOME_RANGE = 26;
const SLIDE_BOOST = 1.32;
const SLIDE_FRICTION = 2.4;
const SLIDE_MIN = 8.0;
const SLIDE_TIME = 0.9;
const STEP_UP = 0.62;
const GRIND_TARGET = 21;
const GRIND_BOOST = 30;
const GRIND_MIN = 14;
const GRIND_JUMP = 8.0;

export class Controller {
  constructor(world, rig) {
    this.world = world;
    this.rig = rig;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.eyeHeight = EYE_STAND;
    this.horizSpeed = 0;
    this.sprinting = false;
    this.sliding = false;
    this.gliding = false;
    this.grinding = false;
    this.dashing = false;
    this.grindBank = 0;
    this.iframes = 0;          // invulnerability window (dash)
    this._coyote = 0;
    this._jumpBuf = 0;
    this._dashCd = 0;
    this._dashT = 0;
    this._slideT = 0;
    this._grindCd = 0;
    this._grind = null;        // { rail, t, dir, speed }
    this._homeTarget = null;
    this._fall = 0;
    this.events = {};
    this._scratch = new THREE.Vector3();
    this._scratch2 = new THREE.Vector3();
    this.abilities = { doubleDash: false, longGlide: false, fastGrind: false };
    this._airDashes = 0;
    this.maxAirDash = 1;                                  // boons raise this
    this.tune = { dashCd: 1, jump: 1, glide: 0, rail: 1 }; // boon multipliers
  }

  reset(x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.onGround = false;
    this._grind = null;
    this.grinding = false;
  }

  get speed() { return this.vel.length(); }

  update(dt, input, yaw) {
    const ev = this.events = { landed: 0, stepped: false, dashed: false, jumped: false, glideStart: false, grindStart: false, grindEnd: false, launch: false };
    this._dashCd = Math.max(0, this._dashCd - dt);
    this._grindCd = Math.max(0, this._grindCd - dt);
    this.iframes = Math.max(0, this.iframes - dt);

    if (this._grind) { this._updateGrind(dt, input, yaw, ev); }
    else this._updateMove(dt, input, yaw, ev);

    this.horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    return ev;
  }

  _wishDir(input, yaw, out) {
    // camera-relative move direction on the XZ plane (forward = look direction)
    const f = this._scratch.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const r = this._scratch2.set(Math.cos(yaw), 0, -Math.sin(yaw));
    out.set(0, 0, 0).addScaledVector(f, input.move.z).addScaledVector(r, input.move.x);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  _accelerate(dt, wish, wishSpeed, accel) {
    const cur = this.vel.x * wish.x + this.vel.z * wish.z;
    const add = wishSpeed - cur;
    if (add <= 0) return;
    let a = accel * dt * wishSpeed;
    if (a > add) a = add;
    this.vel.x += wish.x * a;
    this.vel.z += wish.z * a;
  }
  _airAccelerate(dt, wish, wishSpeed, accel) {
    const cap = Math.min(wishSpeed, AIR_CAP);
    const cur = this.vel.x * wish.x + this.vel.z * wish.z;
    const add = cap - cur;
    if (add <= 0) return;
    let a = accel * dt * wishSpeed;
    if (a > add) a = add;
    this.vel.x += wish.x * a;
    this.vel.z += wish.z * a;
  }
  _friction(dt, drop) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp < 0.0001) { this.vel.x = 0; this.vel.z = 0; return; }
    const control = sp < STOP_SPEED ? STOP_SPEED : sp;
    let newSp = sp - control * drop * dt;
    if (newSp < 0) newSp = 0;
    newSp /= sp;
    this.vel.x *= newSp;
    this.vel.z *= newSp;
  }

  _updateMove(dt, input, yaw, ev) {
    const wish = this._wishDir(input, yaw, new THREE.Vector3());
    const moving = wish.lengthSq() > 0.001;
    this.sprinting = input.isDown('sprint') && this.onGround && moving && !this.sliding;

    // --- slide ---
    if (input.justPressed('slide') && this.onGround && this.horizSpeed > SLIDE_MIN && !this.sliding) {
      this.sliding = true; this._slideT = SLIDE_TIME;
      const s = Math.hypot(this.vel.x, this.vel.z) || 1;
      this.vel.x *= SLIDE_BOOST; this.vel.z *= SLIDE_BOOST;
      ev.slide = true;
    }
    if (this.sliding) {
      this._slideT -= dt;
      if (this._slideT <= 0 || !input.isDown('slide') || this.horizSpeed < 4.5 || !this.onGround) this.sliding = false;
    }
    this.eyeHeight = damp(this.eyeHeight, this.sliding ? EYE_SLIDE : EYE_STAND, 14, dt);

    // --- dash ---
    if (input.justPressed('dash') && this._dashCd <= 0 && (this.onGround || this._airDashes < this.maxAirDash)) {
      this._startDash(input, yaw, ev);
    }
    if (this.dashing) {
      this._dashT -= dt;
      // steer toward home target
      if (this._homeTarget) {
        const tx = this._homeTarget.x - this.pos.x, tz = this._homeTarget.z - this.pos.z;
        const tlen = Math.hypot(tx, tz);
        if (tlen > 0.5) {
          const desiredYaw = Math.atan2(tx, tz);
          const curYaw = Math.atan2(this.vel.x, this.vel.z);
          const da = shortestAngle(curYaw, desiredYaw);
          const steer = clamp(da, -3.5 * dt, 3.5 * dt);
          const cs = Math.cos(steer), sn = Math.sin(steer);
          const vx = this.vel.x, vz = this.vel.z;
          this.vel.x = vx * cs + vz * sn;
          this.vel.z = -vx * sn + vz * cs;
        }
      }
      if (this._dashT <= 0) { this.dashing = false; this._homeTarget = null; }
    }

    // --- acceleration ---
    const wishSpeed = this.sprinting ? SPRINT : WALK;
    if (this.onGround) {
      if (!this.dashing) {
        if (this.sliding) this._friction(dt, SLIDE_FRICTION);
        else this._friction(dt, FRICTION);
        this._accelerate(dt, wish, wishSpeed, this.sliding ? ACCEL_GROUND * 0.15 : ACCEL_GROUND);
      }
    } else {
      if (!this.dashing) this._airAccelerate(dt, wish, wishSpeed, ACCEL_AIR);
    }

    // --- jump ---
    if (input.justPressed('jump')) this._jumpBuf = JUMP_BUFFER;
    this._jumpBuf = Math.max(0, this._jumpBuf - dt);
    if (this._coyote > 0) this._coyote -= dt;
    if (this._jumpBuf > 0 && (this.onGround || this._coyote > 0)) {
      this.vel.y = JUMP_VEL * this.tune.jump;
      this.onGround = false; this._coyote = 0; this._jumpBuf = 0; this.sliding = false;
      ev.jumped = true;
    }
    // variable jump height: release early to cut the rise
    if (!input.isDown('jump') && this.vel.y > 0) this.vel.y *= Math.pow(0.0022, dt);

    // --- glide ---
    const wantGlide = !this.onGround && input.isDown('jump') && this.vel.y < 1.5 && this._jumpBuf <= 0;
    if (wantGlide && !this.gliding) ev.glideStart = true;
    this.gliding = wantGlide;

    // --- gravity ---
    const glideG = GLIDE_GRAVITY / (1 + 0.3 * this.tune.glide);
    const glideMaxFall = GLIDE_MAX_FALL / (1 + 0.18 * this.tune.glide);
    const g = this.gliding ? glideG : GRAVITY;
    this.vel.y -= g * dt;
    if (this.gliding && this.vel.y < -glideMaxFall) this.vel.y = -glideMaxFall;

    // air pad / launcher check at feet
    const pad = this.world.airPadAt ? this.world.airPadAt(this.pos.x, this.pos.z, this.pos.y) : null;
    if (pad && this.vel.y < pad) { this.vel.y = pad; this.onGround = false; ev.launch = true; }

    this._integrate(dt, ev);

    // try latch a rail
    if (this._grindCd <= 0 && !this.onGround && this.world.nearestRail) {
      const cand = this.world.nearestRail(this.pos, this.vel, this.horizSpeed);
      if (cand) this._enterGrind(cand, ev);
    }
  }

  _startDash(input, yaw, ev) {
    this.dashing = true; this._dashT = DASH_TIME; this._dashCd = DASH_CD * this.tune.dashCd;
    this.iframes = DASH_TIME + 0.06;
    if (!this.onGround) this._airDashes++;
    // dash direction: movement input if any, else look-flat
    let dx, dz;
    if (input.move.x !== 0 || input.move.z !== 0) {
      const f = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      dx = f * input.move.z + rx * input.move.x;
      dz = fz * input.move.z + rz * input.move.x;
    } else {
      dx = -Math.sin(yaw); dz = -Math.cos(yaw);
    }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    this.vel.x = dx * DASH_SPEED;
    this.vel.z = dz * DASH_SPEED;
    if (this.vel.y < 0) this.vel.y *= 0.3;
    this.sliding = false;
    // homing target
    this._homeTarget = null;
    if (this.world.dashTarget) {
      const t = this.world.dashTarget(this.pos, dx, dz, DASH_HOME_CONE, DASH_HOME_RANGE);
      if (t) this._homeTarget = t;
    }
    this.rig.addFovPunch(8);
    ev.dashed = true;
  }

  _integrate(dt, ev) {
    // horizontal move with wall push-out
    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;
    if (this.world.collide) {
      const r = this.world.collide(nx, nz, RADIUS, this.pos.y + this.eyeHeight * 0.5);
      if (r) {
        // kill velocity into the wall (slide along)
        if (r.hit) {
          // project velocity onto the allowed move
          const movedX = r.x - this.pos.x, movedZ = r.z - this.pos.z;
          nx = r.x; nz = r.z;
        } else { nx = r.x; nz = r.z; }
      }
    }
    this.pos.x = nx; this.pos.z = nz;

    // vertical
    this.pos.y += this.vel.y * dt;

    // ground resolution: highest of terrain or a platform top under the feet.
    // inside a cellar (a "pit") the terrain is ignored so you can go underground.
    const inPit = this.world.inPit && this.world.inPit(this.pos.x, this.pos.z);
    const terrain = (!inPit && this.world.groundHeight) ? this.world.groundHeight(this.pos.x, this.pos.z) : -Infinity;
    let ground = terrain;
    if (this.world.platformTop) {
      const top = this.world.platformTop(this.pos.x, this.pos.z, this.pos.y, this.vel.y);
      if (top > ground && top <= this.pos.y + STEP_UP + 0.05) ground = top;
    }
    if (ground === -Infinity) ground = this.pos.y - 100; // safety: never snap when unsupported in a pit

    const wasAir = !this.onGround;
    if (this.pos.y <= ground + 0.001 && this.vel.y <= 0.001) {
      if (wasAir && this._fall < -6) ev.landed = Math.min(1, -this._fall / 18);
      this.pos.y = ground;
      this.vel.y = 0;
      if (!this.onGround) { this.onGround = true; this._airDashes = 0; this.gliding = false; }
      this._coyote = COYOTE;
    } else {
      if (this.onGround) this._coyote = COYOTE;
      this.onGround = false;
    }
    this._fall = this.vel.y;

    // step-up assist: if grounded and moving, gently follow rising terrain
    if (this.onGround) {
      this.pos.y = damp(this.pos.y, ground, 22, dt);
    }
  }

  // ---- grind rails ----
  _enterGrind(c, ev) {
    const speedIn = clamp(Math.max(this.horizSpeed, GRIND_MIN), GRIND_MIN, GRIND_BOOST);
    this._grind = { rail: c.rail, t: c.t, dir: c.dir, speed: speedIn, ramp: 0 };
    this.grinding = true;
    this.onGround = false;
    this.gliding = false;
    ev.grindStart = true;
  }

  _updateGrind(dt, input, yaw, ev) {
    const g = this._grind;
    const rail = g.rail;
    g.ramp = Math.min(1, g.ramp + dt / 0.4);
    const targetSpeed = lerp(GRIND_BOOST, (this.abilities.fastGrind ? GRIND_TARGET + 5 : GRIND_TARGET) * this.tune.rail, g.ramp);
    g.speed = damp(g.speed, targetSpeed, 4, dt);

    const len = rail.length;
    g.t += (g.dir * g.speed * dt) / len;

    // banking from rail curvature for the camera
    const p0 = rail.pointAt(clamp01(g.t));
    const tan = rail.tangentAt(clamp01(g.t));
    this.grindBank = clamp(tan.x * g.dir * 0.0, -0.5, 0.5);

    this.pos.set(p0.x, p0.y, p0.z);
    this.vel.set(tan.x * g.speed * g.dir, tan.y * g.speed * g.dir, tan.z * g.speed * g.dir);

    // steer/eject if you push hard sideways
    const sideways = Math.abs(input.move.x);
    if (sideways > 0.65 && g.ramp > 0.25) { this._exitGrind(tan, g, ev, 1.0, true); return; }

    // jump off (perfect launch near the end of an open rail)
    if (input.justPressed('jump')) {
      const nearEnd = !rail.closed && (g.dir > 0 ? g.t > 0.82 : g.t < 0.18);
      this._exitGrind(tan, g, ev, nearEnd ? 1.18 : 1.0, false);
      return;
    }
    // reached the end of an open rail
    if (!rail.closed && (g.t >= 1 || g.t <= 0)) { this._exitGrind(tan, g, ev, 1.0, false); return; }
    if (rail.closed) { if (g.t > 1) g.t -= 1; if (g.t < 0) g.t += 1; }
  }

  _exitGrind(tan, g, ev, jumpMul, sideways) {
    this.vel.set(tan.x * g.speed * g.dir, tan.y * g.speed * g.dir, tan.z * g.speed * g.dir);
    if (!sideways) this.vel.y = Math.max(this.vel.y, 0) + GRIND_JUMP * jumpMul;
    else { this.vel.y += 3; }
    this._grind = null;
    this.grinding = false;
    this.grindBank = 0;
    this._grindCd = 0.34;
    if (jumpMul > 1) { ev.launch = true; this.rig.addFovPunch(6); }
    ev.grindEnd = true;
  }
}

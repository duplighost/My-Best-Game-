// camera.js — the camera rig owns where you look and all the little lies that
// make speed feel like speed: FOV that widens when you move, a bob in your
// step, a dip when you land, a lean into your strafe and a bank on the rails.
import * as THREE from 'three';
import { clamp, damp, lerp, spring, TAU } from '../engine/util.js';

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.baseFov = 82;
    this.fov = 82;
    this.fovPunch = 0;
    this.dip = 0;
    this.dipVel = 0;
    this.bobPhase = 0;
    this.trauma = 0; // 0..1 screen shake
    this.recoilPitch = 0;
    this.yawVel = 0;
    this._lastYaw = 0;
    this._shakeT = 0;
    this.reducedMotion = false;
  }

  processLook(look) {
    this.yaw -= look.dx;
    this.pitch -= look.dy;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = clamp(this.pitch, -lim, lim);
    if (this.yaw > Math.PI) this.yaw -= TAU;
    if (this.yaw < -Math.PI) this.yaw += TAU;
  }

  addShake(amount) { this.trauma = clamp(this.trauma + amount, 0, 1); }
  addFovPunch(a) { this.fovPunch = Math.min(this.fovPunch + a, 16); }
  addRecoil(p) { this.recoilPitch += p; }

  forward(out) {
    out.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    return out.normalize();
  }
  forwardFlat(out) {
    out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    return out.normalize();
  }

  update(dt, ctrl, input, fx) {
    const mul = this.reducedMotion ? 0.35 : 1;
    this.yawVel = (this.yaw - this._lastYaw) / Math.max(dt, 1e-4);
    this._lastYaw = this.yaw;

    // FOV: base + sprint + raw speed + grind + dash punch
    let targetFov = this.baseFov;
    const spd = ctrl.horizSpeed;
    targetFov += clamp((spd - 7.5) * 0.95, 0, 16);
    if (ctrl.sprinting) targetFov += 5;
    if (ctrl.grinding) targetFov += 8;
    if (ctrl.gliding) targetFov += 4;
    this.fov = damp(this.fov, targetFov, 9, dt) + this.fovPunch;
    this.fovPunch = damp(this.fovPunch, 0, 11, dt);
    this.cam.fov = this.fov;
    this.cam.updateProjectionMatrix();

    // head bob
    let bobX = 0, bobY = 0;
    if (ctrl.onGround && !ctrl.sliding) {
      this.bobPhase += spd * dt * 1.6;
      const amt = clamp(spd / 12, 0, 1) * (ctrl.sprinting ? 1.15 : 1) * mul;
      bobX = Math.cos(this.bobPhase) * 0.05 * amt;
      bobY = Math.abs(Math.sin(this.bobPhase)) * 0.07 * amt;
    }

    // landing dip (spring)
    [this.dip, this.dipVel] = spring(this.dip, 0, this.dipVel, 180, 17, dt);
    this.dip = clamp(this.dip, -0.06, 0.7);

    // roll: strafe lean + look-yaw lean + slide tilt + rail bank
    let targetRoll = -input.move.x * 0.04 - clamp(this.yawVel, -7, 7) * 0.004;
    if (ctrl.sliding) targetRoll += -input.move.x * 0.05 - 0.02;
    if (ctrl.grinding) targetRoll += ctrl.grindBank;
    this.roll = damp(this.roll, targetRoll * mul, 9, dt);

    // crouch/slide lowers the eye
    const eye = ctrl.eyeHeight;

    // assemble camera transform
    const p = ctrl.pos;
    this.cam.position.set(
      p.x + bobX * Math.cos(this.yaw),
      p.y + eye + bobY - this.dip,
      p.z - bobX * Math.sin(this.yaw)
    );

    // trauma shake
    this.trauma = damp(this.trauma, 0, 1.6, dt);
    let shakePitch = 0, shakeYaw = 0, shakeRoll = 0;
    if (this.trauma > 0.001 && !this.reducedMotion) {
      this._shakeT += dt * 40;
      const s = this.trauma * this.trauma;
      shakePitch = (Math.sin(this._shakeT * 1.7) ) * s * 0.05;
      shakeYaw = (Math.sin(this._shakeT * 2.3 + 1.1)) * s * 0.05;
      shakeRoll = (Math.sin(this._shakeT * 3.1 + 2.0)) * s * 0.06;
    }
    this.recoilPitch = damp(this.recoilPitch, 0, 10, dt);

    const e = new THREE.Euler(
      this.pitch + this.recoilPitch + shakePitch,
      this.yaw + shakeYaw,
      this.roll + shakeRoll,
      'YXZ'
    );
    this.cam.quaternion.setFromEuler(e);
  }
}

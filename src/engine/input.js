// input.js — one input surface for keyboard+mouse and touch. Desktop uses
// pointer lock; phone uses left-thumb stick to move and right-thumb drag to
// look, with a few big buttons. Two-thumb, anywhere — the way his phone games
// have always felt right.
import { clamp } from './util.js';

const KEYMAP = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyQ: 'dash', KeyE: 'interact', KeyF: 'pulse',
  ControlLeft: 'slide', ControlRight: 'slide', KeyC: 'slide',
  KeyJ: 'atlas', Tab: 'atlas', KeyM: 'map', Escape: 'pause', KeyP: 'pause',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.move = { x: 0, z: 0 };
    this.lookDX = 0;
    this.lookDY = 0;
    this.sensitivity = 0.0022;
    this.touchLookScale = 0.0040;
    this.invertY = false;

    this.held = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this._keyAxis = { fwd: 0, back: 0, left: 0, right: 0 };

    this.pointerLocked = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    // touch state
    this.touch = { moveId: null, lookId: null, mx: 0, mz: 0, lx: 0, ly: 0, ox: 0, oy: 0 };
    this._buttons = new Map(); // action -> bool held via on-screen buttons

    this._bindKeyboard();
    this._bindMouse();
    if (this.isTouch) this._bindTouch();
  }

  _setAction(action, down) {
    if (down) {
      if (!this.held.has(action)) this.pressed.add(action);
      this.held.add(action);
    } else {
      if (this.held.has(action)) this.released.add(action);
      this.held.delete(action);
    }
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (a === 'atlas' && e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this._setAction(a, true);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      this._setAction(a, false);
    });
    window.addEventListener('blur', () => {
      this.held.clear();
      this._keyAxis = { fwd: 0, back: 0, left: 0, right: 0 };
    });
  }

  _bindMouse() {
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.pointerLocked);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.lookDX += e.movementX * this.sensitivity;
      this.lookDY += e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      if (e.button === 0) this._setAction('pulse', true);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._setAction('pulse', false);
    });
  }

  requestLock() {
    if (this.isTouch || !this.canvas.requestPointerLock) return;
    if (document.pointerLockElement === this.canvas) return; // already locked
    try {
      const r = this.canvas.requestPointerLock();
      // newer browsers return a promise that can reject (no gesture / already locked) — swallow it
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (e) { /* pointer lock unavailable — non-fatal */ }
  }
  exitLock() {
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) { /* non-fatal */ }
  }

  _bindTouch() {
    const half = () => window.innerWidth * 0.5;
    const onStart = (e) => {
      for (const t of e.changedTouches) {
        // ignore touches that begin on a UI button (they handle themselves)
        if (t.target && t.target.closest && t.target.closest('.tbtn,.screen,.panel,.hud-btn')) continue;
        if (t.clientX < half() && this.touch.moveId === null) {
          this.touch.moveId = t.identifier;
          this.touch.ox = t.clientX; this.touch.oy = t.clientY;
          this.touch.mx = 0; this.touch.mz = 0;
          if (this.onStickStart) this.onStickStart(t.clientX, t.clientY);
        } else if (t.clientX >= half() && this.touch.lookId === null) {
          this.touch.lookId = t.identifier;
          this.touch.lx = t.clientX; this.touch.ly = t.clientY;
        }
      }
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.moveId) {
          const max = 64;
          let dx = t.clientX - this.touch.ox;
          let dy = t.clientY - this.touch.oy;
          const len = Math.hypot(dx, dy);
          if (len > max) { dx = dx / len * max; dy = dy / len * max; }
          this.touch.mx = dx / max;
          this.touch.mz = -dy / max;
          if (this.onStickMove) this.onStickMove(this.touch.ox + dx, this.touch.oy + dy);
        } else if (t.identifier === this.touch.lookId) {
          this.lookDX += (t.clientX - this.touch.lx) * this.touchLookScale;
          this.lookDY += (t.clientY - this.touch.ly) * this.touchLookScale * (this.invertY ? -1 : 1);
          this.touch.lx = t.clientX; this.touch.ly = t.clientY;
        }
      }
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.moveId) {
          this.touch.moveId = null; this.touch.mx = 0; this.touch.mz = 0;
          if (this.onStickEnd) this.onStickEnd();
        } else if (t.identifier === this.touch.lookId) {
          this.touch.lookId = null;
        }
      }
    };
    const opts = { passive: true };
    window.addEventListener('touchstart', onStart, opts);
    window.addEventListener('touchmove', onMove, opts);
    window.addEventListener('touchend', onEnd, opts);
    window.addEventListener('touchcancel', onEnd, opts);
  }

  // Wire an on-screen button element to an action (held while pressed).
  bindButton(el, action, tap = false) {
    if (!el) return;
    const down = (e) => { e.preventDefault(); el.classList.add('on'); this._setAction(action, true); if (tap) this._setAction(action, false); };
    const up = (e) => { e.preventDefault(); el.classList.remove('on'); if (!tap) this._setAction(action, false); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
  }

  // Called once per frame AFTER the game has consumed look/move.
  beginFrame() {
    // build move vector
    let x = 0, z = 0;
    if (this.held.has('right')) x += 1;
    if (this.held.has('left')) x -= 1;
    if (this.held.has('fwd')) z += 1;
    if (this.held.has('back')) z -= 1;
    if (this.isTouch) {
      x += this.touch.mx;
      z += this.touch.mz;
    }
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    this.move.x = x;
    this.move.z = z;
  }

  consumeLook() {
    const dx = this.lookDX, dy = this.lookDY;
    this.lookDX = 0; this.lookDY = 0;
    return { dx, dy };
  }

  isDown(a) { return this.held.has(a); }
  justPressed(a) { return this.pressed.has(a); }
  justReleased(a) { return this.released.has(a); }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }
}

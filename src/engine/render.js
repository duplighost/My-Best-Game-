// render.js — the look of the world. ACES tone-mapping + bloom gives the neon
// glow; a shader sky dome + starfield + aurora gives every biome its own
// gorgeous horizon; the light rig follows the player so an infinite world stays
// lit without infinite lights.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp, damp, lerp } from './util.js';

const QUALITY = {
  high:   { dpr: 1.5,  bloom: 0.62, bloomRes: 1,   shadows: true,  stars: 2600, anis: 8 },
  medium: { dpr: 1.0,  bloom: 0.5,  bloomRes: 0.5, shadows: false, stars: 1400, anis: 4 },
  low:    { dpr: 0.8,  bloom: 0.0,  bloomRes: 0.5, shadows: false, stars: 700,  anis: 2 },
};

const SKY_VERT = `
  varying vec3 vDir;
  void main(){
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // force to far plane
  }
`;
const SKY_FRAG = `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform float uSunSize;
  uniform float uTime;
  // cheap hash for star/dust grain on the dome
  float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  void main(){
    vec3 d = normalize(vDir);
    float up = d.y;
    // vertical gradient: ground -> horizon -> zenith
    vec3 col;
    float hr = smoothstep(-0.12, 0.32, up);
    col = mix(uHorizon, uZenith, pow(hr, 0.85));
    col = mix(uGround, col, smoothstep(-0.5, -0.02, up));
    // horizon band glow
    float band = exp(-abs(up) * 7.0) * 0.5;
    col += uHorizon * band;
    // sun + bloom-friendly halo
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.35, sd);
    float halo = pow(sd, 64.0) * 0.6 + pow(sd, 8.0) * 0.18;
    col += uSunCol * (disc * 3.2 + halo);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.q = QUALITY[quality] || QUALITY.high;
    this.quality = quality;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.dpr));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = this.q.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.anisotropy = this.q.anis;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x10131f, 0.0125);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 2200);

    // ---- lighting rig (follows player) ----
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x20161f, 1.15);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe6c0, 2.2);
    this.sun.position.set(60, 120, 40);
    if (this.q.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const c = this.sun.shadow.camera;
      c.near = 1; c.far = 320; c.left = -90; c.right = 90; c.top = 90; c.bottom = -90;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.5;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);
    // a soft fill so shadowed sides keep their color
    this.fill = new THREE.DirectionalLight(0x6f86ff, 0.35);
    this.fill.position.set(-40, 30, -60);
    scene.add(this.fill);

    // ---- sky dome ----
    this.skyUniforms = {
      uHorizon: { value: new THREE.Color(0x223a66) },
      uZenith: { value: new THREE.Color(0x0a0e1e) },
      uGround: { value: new THREE.Color(0x0a0c14) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.4) },
      uSunCol: { value: new THREE.Color(0xffe6b0) },
      uSunSize: { value: 0.0025 },
      uTime: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 16), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    scene.add(this.sky);

    this._buildStars(this.q.stars);
    this._buildAurora();
    this._buildCelestials();
    this._buildGodrays();
    this._buildRain();
    this._rainLevel = 0; this._rainTarget = 0;
    this._godrayTarget = 0;

    // ---- post ----
    const size = new THREE.Vector2(window.innerWidth * this.q.bloomRes, window.innerHeight * this.q.bloomRes);
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    if (this.q.bloom > 0) {
      this.bloom = new UnrealBloomPass(size, this.q.bloom, 0.65, 0.5);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());

    // animated sky colors (set by env each frame)
    this.targetHorizon = new THREE.Color(0x223a66);
    this.targetZenith = new THREE.Color(0x0a0e1e);
    this.targetGround = new THREE.Color(0x0a0c14);
    this.targetSunCol = new THREE.Color(0xffe6b0);
    this.targetFog = new THREE.Color(0x10131f);
    this.targetFogDensity = 0.0125;
    this.targetHemiSky = new THREE.Color(0xbfd6ff);
    this.targetHemiGround = new THREE.Color(0x20161f);
    this.targetSunIntensity = 2.2;
    this.targetHemiIntensity = 1.15;

    window.addEventListener('resize', () => this.resize());
  }

  _buildStars(count) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // upper hemisphere dome
      const u = Math.random();
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(0.04 + u * 0.96);
      const r = 1300;
      pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      pos[i * 3 + 1] = Math.cos(phi) * r * 0.9 + 20;
      pos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
      const hue = 0.52 + Math.random() * 0.22;
      c.setHSL(hue, 0.55, 0.6 + Math.random() * 0.35);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({
      size: 2.4, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.stars = new THREE.Points(g, m);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    this.scene.add(this.stars);
  }

  _buildAurora() {
    // tall, faint curtains arranged in a ring on the high horizon — northern
    // lights, not a ceiling. Barely there by day, luminous at night.
    const group = new THREE.Group();
    group.frustumCulled = false;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x3affc8, transparent: true, opacity: 0.0, depthWrite: false, vertexColors: true,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.auroraMat = mat;
    const count = 6, ringR = 760, HW = 210, HH = 160;
    for (let i = 0; i < count; i++) {
      const geo = new THREE.PlaneGeometry(420, 320, 16, 6);
      const p = geo.attributes.position;
      const col = new Float32Array(p.count * 3);
      for (let v = 0; v < p.count; v++) {
        const x = p.getX(v), yy = p.getY(v);
        p.setZ(v, Math.sin(x * 0.02 + i) * 40 + Math.cos(yy * 0.02) * 18);
        // fade edges to black so additive blending hides the rectangle; brighter
        // at the top, streaky vertically like real curtains
        const fx = 1 - Math.abs(x) / HW;
        const fyTop = (yy + HH) / (2 * HH); // 0 bottom .. 1 top
        const streak = 0.6 + 0.4 * Math.sin(x * 0.08 + i * 2);
        const f = Math.max(0, fx) * fyTop * streak;
        col[v * 3] = f; col[v * 3 + 1] = f; col[v * 3 + 2] = f;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      const a = (i / count) * Math.PI * 2;
      m.position.set(Math.cos(a) * ringR, 300, Math.sin(a) * ringR);
      m.lookAt(0, 300, 0);
      m.renderOrder = -998;
      group.add(m);
    }
    this.aurora = group;
    this.scene.add(group);
  }

  _softTex() {
    if (this._soft) return this._soft;
    const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    this._soft = new THREE.CanvasTexture(cv);
    return this._soft;
  }

  _celestialTexture(kind) {
    const s = 256;
    const cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    if (kind === 'moon') {
      ctx.fillStyle = '#cfd6e6'; ctx.fillRect(0, 0, s, s);
      // maria (cool patches) + craters
      for (let i = 0; i < 9; i++) {
        const x = Math.random() * s, y = Math.random() * s, r = 18 + Math.random() * 50;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(120,140,180,0.5)'); g.addColorStop(1, 'rgba(120,140,180,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
      for (let i = 0; i < 120; i++) {
        const x = Math.random() * s, y = Math.random() * s, r = 1 + Math.random() * 6;
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '90,100,130' : '230,236,250'},${0.15 + Math.random() * 0.3})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
    } else { // planet — soft alien marble
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, '#1b3f7a'); g.addColorStop(0.5, '#2f6fae'); g.addColorStop(1, '#16305e');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * s, y = Math.random() * s, r = 10 + Math.random() * 60;
        const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
        const col = Math.random() < 0.5 ? '220,235,255' : '90,150,120';
        gg.addColorStop(0, `rgba(${col},0.5)`); gg.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildCelestials() {
    // a giant moon (rises opposite the sun) and a distant planet — the awe in
    // the sky that makes a wanderer look up. Drawn in the sky layer so fog and
    // the world's hills never swallow them.
    const moonMat = new THREE.MeshBasicMaterial({ map: this._celestialTexture('moon'), fog: false, depthWrite: false, transparent: true, opacity: 1 });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 24), moonMat);
    this.moon.frustumCulled = false; this.moon.renderOrder = -996;
    this.scene.add(this.moon);
    // a soft halo around the moon
    const haloMat = new THREE.SpriteMaterial({ map: this._softTex(), color: 0xbfd0ff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.moonHalo = new THREE.Sprite(haloMat); this.moonHalo.scale.set(420, 420, 1); this.moonHalo.renderOrder = -997;
    this.scene.add(this.moonHalo);

    const planetMat = new THREE.MeshBasicMaterial({ map: this._celestialTexture('planet'), fog: false, depthWrite: false });
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 24), planetMat);
    this.planet.frustumCulled = false; this.planet.renderOrder = -996;
    this.scene.add(this.planet);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x9fb6ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.planetRing = new THREE.Mesh(new THREE.RingGeometry(240, 330, 64), ringMat);
    this.planetRing.frustumCulled = false; this.planetRing.renderOrder = -996;
    this.scene.add(this.planetRing);

    // a couple of small moonlets near the planet (the "many moons" sky)
    this.moonlets = [];
    const mlTex = this._celestialTexture('moon');
    for (const cfg of [{ r: 34, off: [-0.32, 0.16, 0.1] }, { r: 22, off: [0.26, -0.12, -0.08] }, { r: 16, off: [0.05, 0.3, 0.2] }]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(cfg.r, 20, 14), new THREE.MeshBasicMaterial({ map: mlTex, fog: false, depthWrite: false }));
      m.frustumCulled = false; m.renderOrder = -996; m.userData.off = cfg.off;
      this.scene.add(m); this.moonlets.push(m);
    }

    // soft clouds high in the day sky (fade out at night)
    this.clouds = new THREE.Group(); this.clouds.frustumCulled = false;
    const cloudMat = new THREE.SpriteMaterial({ map: this._softTex(), color: 0xeaf2ff, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.cloudMat = cloudMat;
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(cloudMat);
      const a = (i / 10) * Math.PI * 2 + (i % 3);
      const r = 700 + (i % 4) * 120;
      s.position.set(Math.cos(a) * r, 220 + (i % 5) * 60, Math.sin(a) * r);
      const sc = 260 + (i % 4) * 160;
      s.scale.set(sc, sc * 0.5, 1);
      s.renderOrder = -995;
      this.clouds.add(s);
    }
    this.scene.add(this.clouds);
  }

  _buildGodrays() {
    // warm light shafts that fall through a canopy by day. Soft-edged additive
    // planes, tilted toward the sun, clustered near the player.
    const group = new THREE.Group(); group.frustumCulled = false;
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff0cf, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, vertexColors: true });
    this.godrayMat = mat;
    for (let i = 0; i < 7; i++) {
      const geo = new THREE.PlaneGeometry(2.8, 46, 1, 1);
      const p = geo.attributes.position, col = new Float32Array(p.count * 3);
      for (let v = 0; v < p.count; v++) {
        const yy = p.getY(v); const f = (yy + 23) / 46; // 1 at top, 0 at bottom
        col[v*3] = f; col[v*3+1] = f; col[v*3+2] = f;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(geo, mat);
      const a = (i / 7) * Math.PI * 2 + i; const r = 10 + (i % 3) * 9;
      m.position.set(Math.cos(a) * r, 18, Math.sin(a) * r);
      m.rotation.set(0.32, a, 0.18);
      m.renderOrder = 2; group.add(m);
    }
    this.godrays = group; this.scene.add(group);
  }

  _buildRain() {
    const N = this.quality === 'low' ? 140 : 300;
    this._rainN = N;
    const geo = new THREE.BoxGeometry(0.025, 0.9, 0.025);
    const mat = new THREE.MeshBasicMaterial({ color: 0xbcd4ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.rainMat = mat;
    this.rain = new THREE.InstancedMesh(geo, mat, N);
    this.rain.frustumCulled = false; this.rain.renderOrder = 3;
    this._rainBase = new Float32Array(N * 2); // x,z offsets around player
    this._rainY = new Float32Array(N);
    this._rainSpd = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this._rainBase[i*2] = (Math.random() - 0.5) * 46;
      this._rainBase[i*2+1] = (Math.random() - 0.5) * 46;
      this._rainY[i] = Math.random() * 30;
      this._rainSpd[i] = 26 + Math.random() * 14;
    }
    this._rainDummy = new THREE.Object3D();
    this.scene.add(this.rain);
  }

  setWeather(rain, godray) {
    if (rain != null) this._rainTarget = rain;
    if (godray != null) this._godrayTarget = godray;
  }

  setSky(env) {
    // env: { horizon, zenith, ground, sunCol, fog, fogDensity, hemiSky, hemiGround, sunI, hemiI, aurora }
    if (env.horizon) this.targetHorizon.setHex(env.horizon);
    if (env.zenith) this.targetZenith.setHex(env.zenith);
    if (env.ground) this.targetGround.setHex(env.ground);
    if (env.sunCol) this.targetSunCol.setHex(env.sunCol);
    if (env.fog) this.targetFog.setHex(env.fog);
    if (env.fogDensity != null) this.targetFogDensity = env.fogDensity;
    if (env.hemiSky) this.targetHemiSky.setHex(env.hemiSky);
    if (env.hemiGround) this.targetHemiGround.setHex(env.hemiGround);
    if (env.sunI != null) this.targetSunIntensity = env.sunI;
    if (env.hemiI != null) this.targetHemiIntensity = env.hemiI;
    if (env.auroraTarget != null) this._auroraTarget = env.auroraTarget;
  }

  update(dt, time, playerPos, sunDir) {
    const k = clamp(dt * 2.4, 0, 1);
    this.skyUniforms.uHorizon.value.lerp(this.targetHorizon, k);
    this.skyUniforms.uZenith.value.lerp(this.targetZenith, k);
    this.skyUniforms.uGround.value.lerp(this.targetGround, k);
    this.skyUniforms.uSunCol.value.lerp(this.targetSunCol, k);
    this.skyUniforms.uTime.value = time;
    this.scene.fog.color.lerp(this.targetFog, k);
    this.scene.fog.density = damp(this.scene.fog.density, this.targetFogDensity, 2.4, dt);
    this.hemi.color.lerp(this.targetHemiSky, k);
    this.hemi.groundColor.lerp(this.targetHemiGround, k);
    this.hemi.intensity = damp(this.hemi.intensity, this.targetHemiIntensity, 2.4, dt);
    this.sun.intensity = damp(this.sun.intensity, this.targetSunIntensity, 2.4, dt);
    this.sun.color.lerp(this.targetSunCol, k * 0.6);

    // sun direction (day/night)
    this.skyUniforms.uSunDir.value.copy(sunDir);

    // keep sky + stars + aurora centered on the player (infinite world)
    this.sky.position.copy(playerPos);
    this.stars.position.copy(playerPos);
    this.stars.rotation.y = time * 0.005;
    this.aurora.position.set(playerPos.x, 0, playerPos.z);
    this.aurora.rotation.y = Math.sin(time * 0.02) * 0.12;
    if (this._auroraTarget != null) {
      this.auroraMat.opacity = damp(this.auroraMat.opacity, this._auroraTarget, 1.5, dt);
    }
    this.auroraMat.color.setHSL(0.45 + Math.sin(time * 0.05) * 0.08, 0.72, 0.6);

    // giant moon hangs low over the horizon, opposite the sun, and brightens at
    // night — the awe you look up for. (No Moon, but there is one.)
    const night = clamp(1 - (sunDir.y * 1.4 + 0.35), 0, 1);
    const sunAz = Math.atan2(sunDir.z, sunDir.x);
    const moonAz = sunAz + Math.PI;
    const el = 0.14 + night * 0.16;
    const moonDir = this._moonDir || (this._moonDir = new THREE.Vector3());
    moonDir.set(Math.cos(moonAz) * Math.cos(el), Math.sin(el), Math.sin(moonAz) * Math.cos(el)).normalize();
    this.moon.position.copy(playerPos).addScaledVector(moonDir, 1000);
    this.moon.rotation.y = time * 0.003;
    this.moon.material.opacity = 0.25 + night * 0.75;
    this.moonHalo.position.copy(this.moon.position);
    this.moonHalo.material.opacity = 0.1 + night * 0.5;
    if (this.planet) {
      const pd = this._planetDir || (this._planetDir = new THREE.Vector3(Math.cos(2.2) * 0.9, 0.42, Math.sin(2.2) * 0.9).normalize());
      this.planet.position.copy(playerPos).addScaledVector(pd, 1300);
      this.planet.rotation.y = time * 0.004;
      this.planetRing.position.copy(this.planet.position);
      this.planetRing.rotation.set(1.15, 0.5, 0.2);
      for (const m of this.moonlets) { const o = m.userData.off; m.position.copy(this.planet.position).add(new THREE.Vector3(o[0], o[1], o[2]).multiplyScalar(520)); m.rotation.y = time * 0.006; }
    }
    // clouds drift with the player, visible by day
    if (this.clouds) {
      this.clouds.position.set(playerPos.x, 0, playerPos.z);
      this.clouds.rotation.y = time * 0.004;
      const day = clamp(sunDir.y * 1.4 + 0.35, 0, 1);
      this.cloudMat.opacity = damp(this.cloudMat.opacity, day * 0.42, 1.5, dt);
    }

    // god-rays through the canopy (forest, by day)
    if (this.godrays) {
      this.godrayMat.opacity = damp(this.godrayMat.opacity, this._godrayTarget, 1.5, dt);
      this.godrays.position.set(playerPos.x, 0, playerPos.z);
      this.godrays.rotation.y = time * 0.02;
      this.godrays.visible = this.godrayMat.opacity > 0.004;
    }

    // rain (the hollow's weather)
    this._rainLevel = damp(this._rainLevel, this._rainTarget, 2.0, dt);
    if (this.rain) {
      this.rainMat.opacity = this._rainLevel * 0.5;
      if (this._rainLevel > 0.01) {
        this.rain.visible = true;
        const N = this._rainN, D = this._rainDummy;
        for (let i = 0; i < N; i++) {
          this._rainY[i] -= this._rainSpd[i] * dt;
          if (this._rainY[i] < -8) this._rainY[i] += 34;
          D.position.set(playerPos.x + this._rainBase[i*2], playerPos.y + this._rainY[i] - 6, playerPos.z + this._rainBase[i*2+1]);
          D.rotation.z = 0.12; D.updateMatrix();
          this.rain.setMatrixAt(i, D.matrix);
        }
        this.rain.instanceMatrix.needsUpdate = true;
      } else this.rain.visible = false;
    }

    // sun light position relative to player
    this.sun.position.copy(playerPos).addScaledVector(sunDir, 200);
    this.sun.target.position.copy(playerPos);
    this.fill.position.copy(playerPos).add(new THREE.Vector3(-60, 50, -80));
    this.fill.target = this.sun.target;
  }

  render() {
    this.composer.render();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    if (this.bloom) this.bloom.setSize(w * this.q.bloomRes, h * this.q.bloomRes);
  }
}

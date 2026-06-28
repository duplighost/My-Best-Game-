// materials.js — a shared palette so an infinite world reuses a handful of
// materials and geometries instead of allocating forever. Includes a little
// animated water shader because still water in a dream is a missed chance.
import * as THREE from 'three';

export class Materials {
  constructor(anisotropy = 4) {
    this.anis = anisotropy;
    this._geo = new Map();
    this._mat = new Map();
    this.time = { value: 0 };

    // terrain: vertex-colored, matte, receives light
    this.terrain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0 });

    // water shader (two travelling waves + glow + foam at the shore)
    this.waterUniforms = {
      uTime: this.time,
      uColor: { value: new THREE.Color(0x2bbfd6) },
      uDeep: { value: new THREE.Color(0x06314a) },
      uGlow: { value: new THREE.Color(0x6ff6ff) },
    };
    this.water = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, THREE.UniformsLib.fog, this.waterUniforms),
      transparent: true,
      fog: true,
      vertexShader: `
        uniform float uTime; varying float vH; varying vec2 vUv;
        #include <fog_pars_vertex>
        void main(){
          vUv = uv;
          vec3 p = position;
          float w = sin(p.x*0.25 + uTime*1.4) * 0.12 + cos(p.y*0.31 - uTime*1.1) * 0.12;
          p.z += w; vH = w;
          vec4 mvPosition = modelViewMatrix * vec4(p,1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform vec3 uDeep; uniform vec3 uGlow; uniform float uTime;
        varying float vH; varying vec2 vUv;
        #include <fog_pars_fragment>
        void main(){
          float t = clamp(vH*2.0+0.5,0.0,1.0);
          vec3 c = mix(uDeep, uColor, t);
          float spark = pow(max(sin(vUv.x*60.0+uTime*2.0)*sin(vUv.y*60.0-uTime*1.7),0.0), 8.0);
          c += uGlow * spark * 0.5;
          gl_FragColor = vec4(c, 0.82);
          #include <fog_fragment>
        }`,
    });

    this.waterPlaneGeo = new THREE.PlaneGeometry(1, 1, 12, 12);
  }

  geo(key, make) {
    let g = this._geo.get(key);
    if (!g) { g = make(); this._geo.set(key, g); }
    return g;
  }

  std(key, color, opts = {}) {
    let m = this._mat.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color, roughness: opts.roughness ?? 0.8, metalness: opts.metalness ?? 0.05,
        emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 0,
        transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1,
        side: opts.side ?? THREE.FrontSide, flatShading: opts.flat ?? false,
      });
      this._mat.set(key, m);
    }
    return m;
  }

  glow(key, color, intensity = 1.4, opts = {}) {
    let m = this._mat.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: intensity,
        roughness: opts.roughness ?? 0.4, metalness: 0.0,
        transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1,
        side: opts.side ?? THREE.FrontSide,
      });
      this._mat.set(key, m);
    }
    return m;
  }

  update(dt) { this.time.value += dt; }
}

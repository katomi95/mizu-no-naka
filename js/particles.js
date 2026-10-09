// 気泡と微粒子。どちらもインスタンス化した四角形をビュー空間でビルボードにする軽量な粒子。
// gl_PointSize を使わないので、XR の左右の目でも大きさ（メートル単位）が正しく出る。
// 粒の数は上限固定で、配列を使い回す（毎フレームの生成・破棄はしない）。
import * as THREE from '../vendor/three.module.min.js';

const VERT = /* glsl */`
attribute vec3 iPos;
attribute float iSize;
attribute float iAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(iPos, 1.0);
  // 目のすぐ前の粒は大きく見えて邪魔なので消す
  float d = distance(world.xyz, cameraPosition);
  vAlpha = iAlpha * smoothstep(0.22, 0.55, d);
  vec4 mv = viewMatrix * world;
  mv.xy += position.xy * iSize;
  gl_Position = projectionMatrix * mv;
}`;

// 気泡：縁が明るく中は透ける輪、左上に小さなハイライト
const FRAG_BUBBLE = /* glsl */`
uniform float uFade;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float d = length(q);
  if (d > 1.0) discard;
  float rim = smoothstep(0.55, 0.9, d) * (1.0 - smoothstep(0.9, 1.0, d));
  float hl = smoothstep(0.34, 0.0, length(q - vec2(-0.34, 0.38)));
  float a = (rim * 0.7 + 0.07 + hl * 0.85) * vAlpha * uFade;
  vec3 col = mix(vec3(0.78, 0.97, 1.0), vec3(1.0), hl);
  gl_FragColor = vec4(col * a, a * 0.8); // 乗算済みアルファ。少しだけ加算寄り
}`;

// 微粒子：ぼんやりした小さな点
const FRAG_DUST = /* glsl */`
uniform float uFade;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float d = length(vUv * 2.0 - 1.0);
  float a = vAlpha * uFade * pow(max(0.0, 1.0 - d), 1.6);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(0.85, 1.0, 0.97) * a, a * 0.5);
}`;

class Billboards {
  constructor(max, frag) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iSize', this.aSize);
    geo.setAttribute('iAlpha', this.aAlpha);
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: frag,
      uniforms: { uFade: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
  }
  commit(count) {
    this.geo.instanceCount = count;
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }
}

// ---------- 気泡 ----------
// 床の数か所（水草の根元など）と、周りのランダムな位置から湧いて、ゆらゆら上がり、水面の手前で消える。
export class Bubbles {
  constructor(max = 110) {
    this.max = max;
    this.bb = new Billboards(max, FRAG_BUBBLE);
    this.mesh = this.bb.mesh;
    this.count = 0;
    this.pos = new Float32Array(max * 3);   // 揺れを除いた中心位置
    this.vy = new Float32Array(max);
    this.size = new Float32Array(max);
    this.age = new Float32Array(max);
    this.wob = new Float32Array(max * 3);   // 揺れの振幅・周波数・位相
    this.top = new Float32Array(max);       // 消える高さ
    this.sources = [];                      // {x, z}
    this.acc = 0;
    this.burst = null;
    this.nextBurst = 3;
    this.surfaceY = 3;
    this.rand = Math.random;
  }

  reset(sources, surfaceY, rand) {
    this.sources = sources;
    this.surfaceY = surfaceY;
    this.rand = rand;
    this.count = 0;
    this.acc = 0;
    this.burst = null;
    this.nextBurst = 4;
    this.bb.commit(0);
  }

  spawn(x, z, small = false) {
    if (this.count >= this.max) return;
    const r = this.rand;
    const i = this.count++;
    // 小さい泡が多め。直径 6〜28mm
    const d = small ? 0.005 + r() * 0.008 : 0.006 + 0.022 * Math.pow(r(), 2.2);
    this.size[i] = d;
    this.vy[i] = 0.1 + d * 8 + r() * 0.05;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = 0.02 + r() * 0.06;
    this.pos[i * 3 + 2] = z;
    this.age[i] = 0;
    this.wob[i * 3] = 0.004 + r() * 0.016;
    this.wob[i * 3 + 1] = 1.5 + r() * 2.5;
    this.wob[i * 3 + 2] = r() * 6.28;
    this.top[i] = this.surfaceY - 0.05 - r() * 0.5;
  }

  _spawnOne() {
    const r = this.rand;
    if (this.sources.length && r() < 0.65) {
      const s = this.sources[Math.floor(r() * this.sources.length)];
      this.spawn(s.x + (r() - 0.5) * 0.08, s.z + (r() - 0.5) * 0.08);
    } else {
      // 周囲のランダムな位置（顔の真下 0.5m 以内は避ける）
      const a = r() * Math.PI * 2;
      const rad = 0.55 + r() * 2.6;
      this.spawn(Math.cos(a) * rad, Math.sin(a) * rad);
    }
  }

  update(dt, t, rate) {
    const r = this.rand;
    // 連続的な発生
    this.acc += rate * dt;
    while (this.acc >= 1) { this.acc -= 1; this._spawnOne(); }
    // ときどき、同じ場所からぷくぷくと続けて出る
    if (rate > 0.5 && this.sources.length) {
      if (!this.burst && t > this.nextBurst) {
        const s = this.sources[Math.floor(r() * this.sources.length)];
        this.burst = { x: s.x, z: s.z, n: 6 + Math.floor(r() * 6), gap: 0, };
      }
      if (this.burst) {
        this.burst.gap -= dt;
        if (this.burst.gap <= 0) {
          this.spawn(this.burst.x + (r() - 0.5) * 0.02, this.burst.z + (r() - 0.5) * 0.02, true);
          this.burst.gap = 0.07 + r() * 0.08;
          if (--this.burst.n <= 0) { this.burst = null; this.nextBurst = t + 4 + r() * 6; }
        }
      }
    }

    // 移動と、上まで着いた泡の削除（末尾と入れ替え）
    let i = 0;
    while (i < this.count) {
      if (this.pos[i * 3 + 1] >= this.top[i]) {
        const j = --this.count;
        if (i !== j) {
          this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.wob.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.vy[i] = this.vy[j]; this.size[i] = this.size[j];
          this.age[i] = this.age[j]; this.top[i] = this.top[j];
        }
        continue;
      }
      this.age[i] += dt;
      // 上がるにつれて少しだけ速くなる
      this.pos[i * 3 + 1] += this.vy[i] * (1 + Math.min(this.age[i], 8) * 0.03) * dt;
      i++;
    }

    const P = this.bb.aPos.array, S = this.bb.aSize.array, A = this.bb.aAlpha.array;
    for (let n = 0; n < this.count; n++) {
      const amp = this.wob[n * 3], f = this.wob[n * 3 + 1], ph = this.wob[n * 3 + 2];
      const age = this.age[n];
      P[n * 3] = this.pos[n * 3] + Math.sin(age * f + ph) * amp;
      P[n * 3 + 1] = this.pos[n * 3 + 1];
      P[n * 3 + 2] = this.pos[n * 3 + 2] + Math.cos(age * f * 0.83 + ph) * amp;
      S[n] = this.size[n];
      const y = this.pos[n * 3 + 1], top = this.top[n];
      A[n] = Math.min(1, age / 0.4) * Math.min(1, (top - y) / 0.3);
    }
    this.bb.commit(this.count);
  }

  setFade(f) {
    this.bb.material.uniforms.uFade.value = f;
    this.mesh.visible = f > 0.001;
  }
}

// ---------- 漂う微粒子 ----------
// 体の周り半径 r の円柱の中を、ゆっくり流れる。外に出たら反対側へ回り込ませる（数は固定）。
export class Dust {
  constructor(count = 140) {
    this.count = count;
    this.bb = new Billboards(count, FRAG_DUST);
    this.mesh = this.bb.mesh;
    this.base = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.ph = new Float32Array(count);
    this.radius = 3.5;
    this.height = 3;
  }

  reset(height, rand, radius = 3.5) {
    this.height = height;
    this.radius = radius;
    const S = this.bb.aSize.array, A = this.bb.aAlpha.array;
    for (let i = 0; i < this.count; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radius;
      this.base[i * 3] = Math.cos(a) * r;
      this.base[i * 3 + 1] = 0.1 + rand() * (height - 0.2);
      this.base[i * 3 + 2] = Math.sin(a) * r;
      this.vel[i * 3] = (rand() - 0.5) * 0.02;
      this.vel[i * 3 + 1] = (rand() - 0.4) * 0.012;
      this.vel[i * 3 + 2] = (rand() - 0.5) * 0.02;
      this.ph[i] = rand() * 6.28;
      S[i] = 0.003 + rand() * 0.007;
      A[i] = 0.18 + rand() * 0.3;
    }
  }

  update(dt, t) {
    const R = this.radius, H = this.height;
    const cx = 0.012 * Math.sin(t * 0.05), cz = 0.008 * Math.cos(t * 0.04); // ゆるい流れ
    const P = this.bb.aPos.array;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      let x = this.base[k] + (this.vel[k] + cx) * dt;
      let y = this.base[k + 1] + this.vel[k + 1] * dt;
      let z = this.base[k + 2] + (this.vel[k + 2] + cz) * dt;
      const rr = x * x + z * z;
      if (rr > R * R) { x = -x * 0.98; z = -z * 0.98; }
      if (y > H - 0.1) y = 0.1; else if (y < 0.1) y = H - 0.1;
      this.base[k] = x; this.base[k + 1] = y; this.base[k + 2] = z;
      const p = this.ph[i];
      P[k] = x + Math.sin(t * 0.3 + p) * 0.03;
      P[k + 1] = y + Math.sin(t * 0.23 + p * 1.7) * 0.02;
      P[k + 2] = z + Math.cos(t * 0.27 + p) * 0.03;
    }
    this.bb.commit(this.count);
  }

  setFade(f) {
    this.bb.material.uniforms.uFade.value = f;
    this.mesh.visible = f > 0.001;
  }
}

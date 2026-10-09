// 足元の水草と小石。
// 水草は細長い帯（葉）を全部ひとつのジオメトリにまとめ、頂点シェーダで揺らす（描画1回、物理演算なし）。
// 根元は固定、先端ほど大きく揺れる。現れるときは根元から伸びる。
import * as THREE from '../vendor/three.module.min.js';

const VERT = /* glsl */`
uniform float uTime;
uniform float uGrow;
attribute vec3 aRoot;
attribute vec4 aLeaf;   // x: 根元からの割合 t(0..1), y: 葉の長さ, z: 位相, w: 伸び始めの遅れ
attribute vec3 aColor;
attribute float aSide;  // 葉の幅方向 -1..1
varying vec3 vColor;
varying float vT;
varying float vSide;
void main() {
  float t = aLeaf.x;
  float h = aLeaf.y;
  float ph = aLeaf.z;
  // 伸びる：葉ごとに少しずつずらして、ゆっくり
  float g = clamp((uGrow - aLeaf.w) / 0.8, 0.0, 1.0);
  g = g * g * (3.0 - 2.0 * g);
  vec3 p = aRoot + (position - aRoot) * g;
  // 水の流れ：ゆっくりした大きな揺れ + 先端の小さな揺れ。先端ほど大きく（t^2）
  float sway = sin(uTime * 0.8 + ph + t * 1.6) * 0.6 + sin(uTime * 0.37 + ph * 1.7) * 0.4;
  float sway2 = sin(uTime * 0.63 + ph * 2.3 + t * 2.2) * 0.5;
  vec2 off = vec2(0.22 + sway, 0.08 + sway2) * t * t * h * 0.32 * g;
  p.xz += off;
  // 揺れた分だけ少し下がる（葉の長さがおおむね保たれるように）
  p.y -= dot(off, off) * 0.6;
  vColor = aColor;
  vT = t;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */`
uniform float uFade;
varying vec3 vColor;
varying float vT;
varying float vSide;
void main() {
  // 根元は暗く、先端は明るく透ける感じに。中央の葉脈を少し明るく
  vec3 col = vColor * mix(0.38, 1.15, vT);
  col *= 0.86 + 0.18 * (1.0 - abs(vSide));
  col += vec3(0.05, 0.12, 0.08) * smoothstep(0.6, 1.0, vT);
  if (!gl_FrontFacing) col *= 0.8;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Plants {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uGrow: { value: 0 }, uFade: { value: 1 } },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.stones = new THREE.Group();
    this.stoneGeo = new THREE.IcosahedronGeometry(1, 0);
    this.stoneMat = new THREE.MeshLambertMaterial({ color: 0x5f6a63, flatShading: true });
    this.clumps = [];
  }

  // 足元のまわり（半径 0.6〜1.5m）に数株を置く。rand は再現できる乱数
  build(rand) {
    const pos = [], root = [], leaf = [], color = [], side = [], index = [];
    const SEG = 10;
    const clumps = [];
    const nClumps = 7;
    for (let c = 0; c < nClumps; c++) {
      const a = (c / nClumps) * Math.PI * 2 + (rand() - 0.5) * 0.6;
      const r = 0.65 + rand() * 0.85;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      clumps.push({ x: cx, z: cz });
      // 株ごとの色（濃い緑〜黄緑）と背丈
      const hue = 0.27 + rand() * 0.1;
      const base = new THREE.Color().setHSL(hue, 0.55 + rand() * 0.2, 0.3 + rand() * 0.08);
      const tall = 0.45 + rand() * 0.7;
      const nLeaves = 7 + Math.floor(rand() * 5);
      const ribbon = rand() < 0.6; // 細長いリボン型か、少し幅広の葉か
      for (let l = 0; l < nLeaves; l++) {
        const rx = cx + (rand() - 0.5) * 0.12, rz = cz + (rand() - 0.5) * 0.12;
        const H = tall * (0.6 + rand() * 0.55);
        const W = ribbon ? 0.028 + rand() * 0.02 : 0.05 + rand() * 0.035;
        const yaw = rand() * Math.PI;
        const leanA = rand() * Math.PI * 2;
        const lean = 0.08 + rand() * 0.18;
        const twist = (rand() - 0.5) * 1.6;
        const ph = rand() * 6.28;
        const delay = rand() * 0.45;
        const col = base.clone().offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.06);
        const start = pos.length / 3;
        for (let s = 0; s <= SEG; s++) {
          const t = s / SEG;
          // 葉の形：根元は細く、3割くらいで一番太く、先はとがる
          const w = W * Math.sin(Math.min(1, t * 2.4 + 0.25) * Math.PI / 2) * (1 - Math.pow(t, 2.2));
          // 上に行くほど少しねじれて、少し傾く
          const tw = yaw + twist * t;
          const ex = Math.cos(tw), ez = Math.sin(tw);
          const lx = Math.cos(leanA) * lean * t * t * H;
          const lz = Math.sin(leanA) * lean * t * t * H;
          for (const sd of [-1, 1]) {
            pos.push(rx + lx + ex * sd * w * 0.5, t * H, rz + lz + ez * sd * w * 0.5);
            root.push(rx, 0, rz);
            leaf.push(t, H, ph, delay);
            color.push(col.r, col.g, col.b);
            side.push(sd);
          }
        }
        for (let s = 0; s < SEG; s++) {
          const i0 = start + s * 2;
          index.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aRoot', new THREE.Float32BufferAttribute(root, 3));
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf, 4));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    g.setIndex(index);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.clumps = clumps;

    // 株のいくつかの根元に小石
    this.stones.clear();
    for (let c = 0; c < clumps.length; c++) {
      if (rand() < 0.4) continue;
      const n = 1 + Math.floor(rand() * 2);
      for (let k = 0; k < n; k++) {
        const s = new THREE.Mesh(this.stoneGeo, this.stoneMat);
        const sz = 0.04 + rand() * 0.06;
        s.userData.scale = new THREE.Vector3(sz * (1 + rand() * 0.4), sz * (0.45 + rand() * 0.2), sz);
        s.position.set(clumps[c].x + (rand() - 0.5) * 0.25, 0, clumps[c].z + (rand() - 0.5) * 0.25);
        s.rotation.set(0, rand() * 6.28, 0);
        s.userData.delay = rand() * 0.3;
        s.scale.setScalar(0.0001);
        this.stones.add(s);
      }
    }
    return clumps;
  }

  update(t, grow) {
    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uGrow.value = grow;
    this.mesh.visible = grow > 0.001;
    for (const s of this.stones.children) {
      let k = THREE.MathUtils.clamp((grow - s.userData.delay) / 0.7, 0, 1);
      k = k * k * (3 - 2 * k);
      s.scale.copy(s.userData.scale).multiplyScalar(Math.max(k, 0.0001));
      s.visible = k > 0.001;
    }
  }
}

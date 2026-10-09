// 魚：基本図形を組み合わせて作る（外部モデルなし）。
//  - 体は横に平たい紡錘形（球を変形）、二又の尾びれ、背びれ・しりびれ・胸びれ、白目と黒目
//  - 色は頂点カラーで種類ごとに塗る（熱帯魚らしい縞や帯）
//  - 泳ぎは頂点シェーダで体の後ろ半分を左右にくねらせる。曲がるときは体も少し曲がる
// 魚の +Z が頭の向き。
import * as THREE from '../vendor/three.module.min.js';

const C = (hex) => new THREE.Color(hex);

// ---------- 種類 ----------
// len: 全長(m)  h,w: 体高・体幅（全長に対する比）  tail: 尾びれの長さ・高さ・切れ込み
// body(t, y, s): 体の色。t: 尾0〜頭1、y: 下-1〜上1、s: 体の横の向き(-1..1)
export const SPECIES = {
  // 小さな群れ：ネオンテトラ風
  neon: {
    len: 0.12, h: 0.27, w: 0.15, tailLen: 0.24, tailH: 0.6, fork: 0.55, dorsal: 0.09, anal: 0.07,
    body(t, y) {
      if (y > 0.05 && y < 0.38 && t > 0.18) return C(0x2ee6ff);     // 青く光る線
      if (y <= 0.05 && t < 0.62) return C(0xff2d2d);               // お腹の後ろ半分が赤
      if (y > 0.38) return C(0x5e6b4a);                            // 背中
      return C(0xe2ecef);                                           // お腹の前は銀
    },
    fin: C(0xcfe3e8), tailCol: C(0xd8e6ea),
  },
  // カクレクマノミ風
  clown: {
    len: 0.13, h: 0.42, w: 0.2, tailLen: 0.2, tailH: 0.55, fork: 1.05, dorsal: 0.2, anal: 0.16,
    body(t) {
      const band = (c, w) => Math.abs(t - c) < w;
      if (band(0.74, 0.055) || band(0.46, 0.06) || band(0.11, 0.035)) return C(0xffffff);
      if (band(0.74, 0.075) || band(0.46, 0.08) || band(0.11, 0.055)) return C(0x1a1410);
      return C(0xff7417);
    },
    fin: C(0xff8a2a), tailCol: C(0xff7a20), finEdge: C(0x1a1410),
  },
  // ナンヨウハギ風
  tang: {
    len: 0.17, h: 0.52, w: 0.15, tailLen: 0.22, tailH: 0.7, fork: 0.8, dorsal: 0.14, anal: 0.12,
    body(t, y) {
      // 背中側に黒いパレット模様
      const inMark = y > -0.05 && y < 0.82 && t > 0.2 && t < 0.86 &&
        !(y > 0.25 && y < 0.6 && t > 0.3 && t < 0.62);
      if (inMark && (y > 0.55 || (t > 0.62 && y > 0.05) || (t < 0.38 && y > 0.1) || t < 0.26)) return C(0x0d1838);
      return C(0x2160e8);
    },
    fin: C(0x0d1838), tailCol: C(0xffd21a),
  },
  // キイロハギ風
  yellow: {
    len: 0.15, h: 0.68, w: 0.13, tailLen: 0.2, tailH: 0.65, fork: 0.95, dorsal: 0.18, anal: 0.16,
    body(t, y) {
      if (t > 0.12 && t < 0.2 && Math.abs(y) < 0.18) return C(0xffffff);
      return C(0xffd400);
    },
    fin: C(0xffcf00), tailCol: C(0xffd800),
  },
  // ときどき横切る魚：タテジマキンチャクダイ風（縦縞）
  angel: {
    len: 0.2, h: 0.62, w: 0.14, tailLen: 0.18, tailH: 0.62, fork: 1.08, dorsal: 0.22, anal: 0.18,
    body(t, y) {
      const s = Math.sin(t * 34 + y * 2.2);
      if (t > 0.78 && y > -0.3 && y < 0.35) return C(0x14214f);    // 目のまわりの帯
      if (s > 0.55) return C(0xf2f6ff);
      if (s > 0.25) return C(0x2c4fb8);
      return C(0xffa21a);
    },
    fin: C(0x2c4fb8), tailCol: C(0xffb52a),
  },
  // 一度だけ現れる大きな魚：メガネモチノウオ（ナポレオンフィッシュ）風
  big: {
    len: 1.55, h: 0.36, w: 0.2, tailLen: 0.18, tailH: 0.55, fork: 1.12, dorsal: 0.08, anal: 0.08,
    hump: 0.12, eye: 0.6, segments: [28, 18],
    body(t, y) {
      // 細かい波線の模様、お腹は明るく
      const lines = Math.sin(t * 90 + Math.sin(y * 6) * 2.0);
      let c = C(0x2f8f86).lerp(C(0x93cbbb), THREE.MathUtils.smoothstep(-y, 0.1, 0.9));
      if (lines > 0.82 && y > -0.5) c.multiplyScalar(0.72);
      if (t > 0.86 && y > -0.1 && y < 0.25) c.lerp(C(0x1c4f4d), 0.6);  // 目の後ろの線
      return c;
    },
    fin: C(0x2a7c74), tailCol: C(0x2a7c74),
  },
};

// ---------- ジオメトリ ----------
const geoCache = new Map();

export function fishGeometry(kind) {
  if (geoCache.has(kind)) return geoCache.get(kind);
  const sp = SPECIES[kind];
  const L = sp.len, H = sp.h * L, W = sp.w * L;
  const pos = [], nor = [], col = [];

  // 体：単位球を Z 方向に伸ばし、尾の側を細くする。頭側 0.4L、尾側 0.6L
  const [ws, hs] = sp.segments || [20, 14];
  const sphere = new THREE.SphereGeometry(1, ws, hs).toNonIndexed();
  sphere.rotateX(Math.PI / 2); // 極を ±Z に
  const sp_ = sphere.getAttribute('position');
  const taper = (zn) => (zn >= 0 ? 1 : 1 - 0.68 * Math.pow(-zn, 1.4));
  const halfH = (zn) => Math.sqrt(Math.max(0, 1 - zn * zn)) * taper(zn) * H / 2;
  for (let i = 0; i < sp_.count; i++) {
    const x = sp_.getX(i), y = sp_.getY(i), zn = sp_.getZ(i);
    const g = taper(zn);
    const Z = zn >= 0 ? zn * 0.4 * L : zn * 0.6 * L;
    let Y = y * H / 2 * g;
    // おでこのこぶ（大きな魚だけ）
    if (sp.hump && y > 0) Y += sp.hump * H * y * THREE.MathUtils.smoothstep(zn, 0.2, 0.75) * (1 - THREE.MathUtils.smoothstep(zn, 0.85, 1.0));
    // 背中側を少し高く、お腹側を少し平らに
    Y += (y > 0 ? 0.04 : 0.02) * H * (1 - zn * zn);
    const X = x * W / 2 * g;
    pos.push(X, Y, Z);
    const n = new THREE.Vector3(x / (W * g + 1e-4), y / (H * g + 1e-4), zn / (zn >= 0 ? 0.4 * L : 0.6 * L) * 0.5).normalize();
    nor.push(n.x, n.y, n.z);
    const t = (Z / L) + 0.6; // 尾0〜頭1
    const c = sp.body(t, y, x);
    col.push(c.r, c.g, c.b);
  }

  const tri = (a, b, c, color, edge) => {
    // ひれ（両面描画する平らな三角形）。法線は横向き
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const [p, isTip] of [[a, false], [b, true], [c, true]]) {
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      const cc = isTip && edge ? edge : color;
      col.push(cc.r, cc.g, cc.b);
    }
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // 尾びれ（fork < 1 で二又、> 1 で丸みのある尾）
  const z0 = -0.5 * L;
  const tl = sp.tailLen * L, th = sp.tailH * H;
  const rootTop = V(0, 0.13 * H, z0), rootBot = V(0, -0.13 * H, z0);
  const tipTop = V(0, th, z0 - tl), tipBot = V(0, -th, z0 - tl);
  const notch = V(0, 0, z0 - tl * sp.fork);
  const tc = sp.tailCol;
  tri(rootTop, tipTop, notch, tc, sp.finEdge);
  tri(rootTop, notch, rootBot, tc);
  tri(rootBot, notch, tipBot, tc, sp.finEdge);

  // 背びれ
  const topAt = (Z) => {
    const zn = Z >= 0 ? Z / (0.4 * L) : Z / (0.6 * L);
    return halfH(zn) + 0.03 * H;
  };
  const dz0 = 0.12 * L, dz1 = -0.36 * L;
  const dh = sp.dorsal * L;
  tri(V(0, topAt(dz0) * 0.92, dz0), V(0, topAt(dz1 + 0.06 * L) + dh, dz1 + 0.04 * L), V(0, topAt(dz1) * 0.9, dz1), sp.fin);
  tri(V(0, topAt(dz0) * 0.92, dz0), V(0, topAt(-0.08 * L) + dh * 0.9, -0.08 * L), V(0, topAt(dz1 + 0.06 * L) + dh, dz1 + 0.04 * L), sp.fin);
  // しりびれ
  const az0 = -0.12 * L, az1 = -0.4 * L, ah = sp.anal * L;
  tri(V(0, -topAt(az0) * 0.9, az0), V(0, -topAt(az1) * 0.9, az1), V(0, -topAt(az1 + 0.05 * L) - ah, az1 + 0.02 * L), sp.fin);
  // 胸びれ（左右）
  for (const s of [-1, 1]) {
    const bx = s * W * 0.42, by = -0.12 * H, bz = 0.12 * L;
    tri(V(bx, by + 0.08 * H, bz), V(bx + s * 0.06 * L, by - 0.1 * H, bz - 0.16 * L), V(bx, by - 0.08 * H, bz - 0.02 * L), sp.fin);
  }

  // 目：白目と黒目（小さな球）
  const eye = (r, color, out) => {
    const g = new THREE.SphereGeometry(r, 8, 6).toNonIndexed();
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let s = -1; s <= 1; s += 2) {
      const ex = s * (W * 0.36 + out), ey = 0.1 * H, ez = 0.26 * L;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i) + ex, p.getY(i) + ey, p.getZ(i) + ez);
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
        col.push(color.r, color.g, color.b);
      }
    }
  };
  const es = sp.eye || 1;
  eye(H * 0.12 * es, C(0xf4f4ee), 0);
  eye(H * 0.075 * es, C(0x050505), H * 0.06 * es);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  geoCache.set(kind, geo);
  return geo;
}

// ---------- 材質：Lambert + 頂点シェーダでのくねり ----------
function fishMaterial() {
  const uniforms = {
    uPhase: { value: 0 },
    uAmp: { value: 0.1 },
    uBend: { value: 0 },
    uLen: { value: 0.1 },
  };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uPhase; uniform float uAmp; uniform float uBend; uniform float uLen;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float zn = transformed.z / uLen;                 // 頭 +0.4 〜 尾 -0.7
          float w = smoothstep(0.15, -0.75, zn);           // 頭はほぼ動かさず、尾ほど大きく
          transformed.x += sin(uPhase - zn * 5.5) * w * w * uAmp * uLen;
          transformed.x += uBend * zn * zn * uLen;         // 曲がるときの体のしなり
        }`);
  };
  mat.customProgramCacheKey = () => 'fish-swim';
  mat.userData.u = uniforms;
  return mat;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _zero = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

// 1匹の魚。位置と速度を毎フレーム与えると、向き・尾の動き・距離による透明度を整える。
export class Fish {
  constructor(kind, { freq = 1, amp = 0.11 } = {}) {
    this.kind = kind;
    this.sp = SPECIES[kind];
    this.material = fishMaterial();
    this.u = this.material.userData.u;
    this.u.uLen.value = this.sp.len;
    this.u.uAmp.value = amp;
    this.freq = freq;
    this.mesh = new THREE.Mesh(fishGeometry(kind), this.material);
    this.mesh.visible = false;
    this.phase = Math.random() * 10;
    this.started = false;
    this.bend = 0;
    this.prevDir = new THREE.Vector3(0, 0, 1);
    // 遠くでは水に溶けるように薄くする（パススルーの上でも自然に現れる・消える）
    this.fadeNear = 3.6;
    this.fadeFar = 5.4;
  }

  place(pos, vel, dt, camLocal, fade = 1) {
    const m = this.mesh;
    m.position.copy(pos);
    const speed = vel.length();
    if (speed > 1e-5) {
      _dir.copy(vel).multiplyScalar(1 / speed);
      // 真上・真下を向かないように（上下の傾きは控えめ）
      _dir.y = THREE.MathUtils.clamp(_dir.y, -0.45, 0.45);
      _dir.normalize();
      _m.lookAt(_dir, _zero, _up);
      _q.setFromRotationMatrix(_m);
      if (!this.started) {
        m.quaternion.copy(_q);
        this.prevDir.copy(_dir);
        this.started = true;
      } else {
        m.quaternion.slerp(_q, 1 - Math.exp(-dt * 4));
      }
      // 進む向きの変化（Y軸まわりの角速度）から体のしなりを決める。左に曲がるとき +X（魚の左）側へ
      if (dt > 0) {
        const p = this.prevDir;
        const turn = (p.z * _dir.x - p.x * _dir.z) / dt;
        const target = THREE.MathUtils.clamp(turn * 0.35, -0.22, 0.22);
        this.bend += (target - this.bend) * (1 - Math.exp(-dt * 3));
      }
      this.prevDir.copy(_dir);
    }
    // 尾を振る速さは泳ぐ速さ（体長あたり）に合わせる
    const beat = THREE.MathUtils.clamp(0.7 + 1.1 * speed / this.sp.len, 0.5, 4) * this.freq;
    this.phase += dt * beat * Math.PI * 2;
    this.u.uPhase.value = this.phase;
    this.u.uBend.value = this.bend;

    const d = pos.distanceTo(camLocal);
    const op = fade * (1 - THREE.MathUtils.smoothstep(d, this.fadeNear, this.fadeFar));
    this.material.opacity = op;
    m.visible = op > 0.01;
  }

  hide() {
    this.mesh.visible = false;
    this.started = false;
  }
}

// ---------- 泳ぎ方 ----------
// どれも「時刻 → 位置」の滑らかな関数にして、速度は少し前の時刻との差で求める。
// これで瞬間移動や急な方向転換が起きない。

const smooth = (x) => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// プレイヤーのまわりを巡る道すじ。最初は遠く（rFar）から渦を巻くように近づいてくる
export class OrbitPath {
  constructor(rand, { r0, y0, speed, tIn, inDur = 16, rFar = 6 }) {
    this.r0 = r0;
    this.rA = 0.25 + rand() * 0.45;
    this.rF = 0.05 + rand() * 0.07;
    this.y0 = y0;
    this.yA = 0.08 + rand() * 0.2;
    this.yF = 0.07 + rand() * 0.08;
    this.dir = rand() < 0.5 ? -1 : 1;
    this.w = speed / r0;
    this.wA = 0.25 + rand() * 0.3;
    this.wF = 0.06 + rand() * 0.06;
    this.th0 = rand() * Math.PI * 2;
    this.p1 = rand() * 6.28; this.p2 = rand() * 6.28; this.p3 = rand() * 6.28;
    this.tIn = tIn;
    this.inDur = inDur;
    this.rFar = rFar;
  }
  at(t, out) {
    const a = smooth((t - this.tIn) / this.inDur);
    let r = this.r0 + this.rA * Math.sin(t * this.rF + this.p1);
    r += (this.rFar - r) * (1 - a);
    const th = this.th0 + this.dir * (this.w * t + this.wA * Math.sin(t * this.wF + this.p2));
    const y = this.y0 + this.yA * Math.sin(t * this.yF + this.p3);
    return out.set(r * Math.cos(th), y, r * Math.sin(th));
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _v = new THREE.Vector3();
const _side = new THREE.Vector3();
const DT = 0.1;

// 1匹で巡回する魚
export class Orbiter {
  constructor(fish, path) {
    this.fish = fish;
    this.path = path;
  }
  update(t, dt, camLocal) {
    if (t < this.path.tIn) { this.fish.hide(); return; }
    this.path.at(t, _a);
    this.path.at(t - DT, _b);
    _v.subVectors(_a, _b).multiplyScalar(1 / DT);
    this.fish.place(_a, _v, dt, camLocal);
  }
}

// 小さな群れ：先頭の道すじを、少し遅れて・少し横にずれてついていく
export class School {
  constructor(fishes, path, rand) {
    this.fishes = fishes;
    this.path = path;
    this.members = fishes.map((f, i) => ({
      fish: f,
      delay: i === 0 ? 0 : 0.6 + rand() * 1.8,
      ox: (rand() - 0.5) * 0.28,
      oy: (rand() - 0.5) * 0.16,
      ph: rand() * 6.28,
    }));
  }
  memberAt(m, t, out) {
    const tt = t - m.delay;
    this.path.at(tt, out);
    this.path.at(tt - DT, _b);
    _v.subVectors(out, _b);
    _side.set(_v.z, 0, -_v.x).normalize();
    out.addScaledVector(_side, m.ox + 0.03 * Math.sin(t * 0.7 + m.ph));
    out.y += m.oy + 0.02 * Math.sin(t * 0.9 + m.ph * 1.3);
    return out;
  }
  update(t, dt, camLocal) {
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (const m of this.members) {
      if (t - m.delay < this.path.tIn) { m.fish.hide(); continue; }
      this.memberAt(m, t, p);
      this.memberAt(m, t - DT, q);
      _v.subVectors(p, q).multiplyScalar(1 / DT);
      m.fish.place(p, _v, dt, camLocal);
    }
  }
}

// ときどき単独で横切る魚：遠くから来て、プレイヤーの横を通り過ぎ、遠くへ去る。しばらくしてまた別の向きから
export class Crosser {
  constructor(fish, rand, { firstAt = 14, headY = 1.2 } = {}) {
    this.fish = fish;
    this.rand = rand;
    this.headY = headY;
    this.next = firstAt;
    this.active = false;
  }
  plan(t) {
    const r = this.rand;
    const a = r() * Math.PI * 2;
    const u = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const n = new THREE.Vector3(-u.z, 0, u.x);
    const d = (1.2 + r() * 1.0) * (r() < 0.5 ? -1 : 1);
    const half = 5.8;
    this.S = n.clone().multiplyScalar(d).addScaledVector(u, -half);
    this.E = n.clone().multiplyScalar(d).addScaledVector(u, half);
    this.n = n;
    this.bendAmt = (r() - 0.5) * 1.2;
    this.y0 = this.headY * (0.45 + r() * 0.6);
    this.y1 = this.headY * (0.45 + r() * 0.6);
    this.t0 = t;
    this.dur = (half * 2) / (0.22 + r() * 0.08);
    this.active = true;
  }
  posAt(t, out) {
    const s = THREE.MathUtils.clamp((t - this.t0) / this.dur, 0, 1);
    out.lerpVectors(this.S, this.E, s).addScaledVector(this.n, this.bendAmt * Math.sin(Math.PI * s));
    out.y = this.y0 + (this.y1 - this.y0) * smooth(s) + 0.05 * Math.sin(t * 0.6);
    return out;
  }
  update(t, dt, camLocal) {
    if (!this.active) {
      if (t >= this.next) this.plan(t);
      else { this.fish.hide(); return; }
    }
    if (t - this.t0 >= this.dur) {
      this.active = false;
      this.fish.hide();
      this.next = t + 6 + this.rand() * 10;
      return;
    }
    this.posAt(t, _a);
    this.posAt(t - DT, _b);
    _v.subVectors(_a, _b).multiplyScalar(1 / DT);
    this.fish.place(_a, _v, dt, camLocal);
  }
}

// 一度だけ現れる大きな魚：遠くの霞から現れ、プレイヤーのまわりを大きく弧を描いて悠然と横切り、去っていく
export class BigFish {
  constructor(fish) {
    this.fish = fish;
    this.fish.fadeNear = 4.4;
    this.fish.fadeFar = 6.6;
    this.state = 'waiting'; // 'waiting' | 'swimming' | 'done'
    this.speed = 0.38;
  }
  // camYaw：その時点でプレイヤーが向いている方角（root のローカル座標で）
  start(camYaw, headY) {
    const dirAt = (deg, r) => new THREE.Vector3(-Math.sin(camYaw + deg * Math.PI / 180) * r, 0, -Math.cos(camYaw + deg * Math.PI / 180) * r);
    // 左後方の遠く → 左前 → 正面を横切る → 右前 → 右後方の遠くへ
    const pts = [
      dirAt(115, 8.5).setY(headY + 0.35),
      dirAt(62, 3.6).setY(headY + 0.25),
      dirAt(8, 2.45).setY(headY + 0.1),
      dirAt(-50, 2.9).setY(headY),
      dirAt(-105, 8.5).setY(headY + 0.15),
    ];
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.length = this.curve.getLength();
    this.s = 0;
    this.state = 'swimming';
  }
  update(t, dt, camLocal) {
    if (this.state !== 'swimming') { this.fish.hide(); return; }
    this.s += (this.speed * dt) / this.length;
    if (this.s >= 1) {
      this.state = 'done';
      this.fish.hide();
      return;
    }
    this.curve.getPointAt(this.s, _a);
    this.curve.getTangentAt(this.s, _v).multiplyScalar(this.speed);
    this.fish.place(_a, _v, dt, camLocal);
  }
}

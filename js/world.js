// 水中の世界：すべての演出をまとめ、開始からの時間に沿ってゆっくり現れさせる。
// XR でも PC プレビューでも同じものを使う。
//
// 座標：root グループの中で考える。原点は開始時の頭の真下の床、-Z が開始時の正面、y=0 が床。
import * as THREE from '../vendor/three.module.min.js';
import { makeCausticTexture, WaterTint, WaterSurface, LightShafts, FloorCaustics, PlaneCaustics } from './water.js';
import { Bubbles, Dust } from './particles.js';
import { Plants } from './plants.js';
import { Fish, OrbitPath, Orbiter, School, Crosser, BigFish } from './fish.js';

export const CONFIG = {
  surfaceAboveHead: 1.6,    // 水面の高さ（開始時の頭から上へ m）
  bubbleRate: 4.5,          // 気泡の発生数（毎秒）
  bigFishAt: [32, 42],      // 大きな魚が現れる時刻（秒）の範囲
  // 開始からの演出の順番（秒）：[始まり, かける時間]
  timeline: {
    bubbles: [1.0, 3.0],
    tint: [2.0, 6.0],
    dust: [3.0, 5.0],
    surface: [3.5, 6.0],
    shafts: [5.0, 6.0],
    caustics: [5.5, 6.0],
    fish: [6.0, 6.0],       // 最初の魚が来始める時刻と、全員が出そろうまでのずらし幅
    plants: [8.0, 6.0],
  },
};

// 再現できる乱数（毎回同じ配置になると確認しやすい）
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ramp = (t, [start, dur]) => {
  const x = THREE.MathUtils.clamp((t - start) / dur, 0, 1);
  return x * x * (3 - 2 * x);
};

const _cam = new THREE.Vector3();
const _camLocal = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Aquarium {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);

    // 水中らしい光：上から明るい水色、下から暗い青緑の照り返し
    this.lights = new THREE.Group();
    this.lights.add(new THREE.HemisphereLight(0xc8f4ff, 0x123c40, 2.4));
    const sun = new THREE.DirectionalLight(0xe8fff8, 1.5);
    sun.position.set(0.4, 3, 0.6);
    this.lights.add(sun);
    this.root.add(this.lights);

    this.causticTex = makeCausticTexture();
    this.tint = new WaterTint();
    scene.add(this.tint.mesh); // 頭の位置に合わせるのでワールド直下
    this.surface = new WaterSurface(this.causticTex);
    this.shafts = new LightShafts(5);
    this.floorCaustics = new FloorCaustics(this.causticTex);
    this.planeCaustics = new PlaneCaustics(scene, this.causticTex);
    this.bubbles = new Bubbles(110);
    this.dust = new Dust(140);
    this.plants = new Plants();
    this.root.add(this.surface.mesh, this.shafts.mesh, this.floorCaustics.mesh,
      this.bubbles.mesh, this.dust.mesh, this.plants.mesh, this.plants.stones);

    // 遠くのCGがかすむ水中フォグ（CGだけにかかる。パススルーには効かない）
    this.fog = new THREE.Fog(0x2a7c84, 1.2, 10);

    // 魚：群れ5匹 + 巡回3匹 + 横切る1匹 = 小魚9匹、それと大きな魚1匹
    this.fishes = [];
    this.schoolFish = [0, 1, 2, 3, 4].map(() => this._addFish('neon', { freq: 1.1, amp: 0.13 }));
    this.soloFish = ['clown', 'tang', 'yellow'].map((k) => this._addFish(k));
    this.crossFish = this._addFish('angel', { freq: 0.9 });
    this.bigFishMesh = this._addFish('big', { freq: 0.55, amp: 0.07 });

    this.t = 0;
    this.active = false;
  }

  _addFish(kind, opts) {
    const f = new Fish(kind, opts);
    this.root.add(f.mesh);
    this.fishes.push(f);
    return f;
  }

  // 体験の開始。headH：床からの頭の高さ。startT：途中から始める（確認用）
  begin({ headH, seed = 7, startT = 0 }) {
    const rand = mulberry32(seed);
    this.headH = THREE.MathUtils.clamp(headH, 0.9, 2.0);
    this.surfaceY = this.headH + CONFIG.surfaceAboveHead;
    this.surface.mesh.position.set(0, this.surfaceY, 0);
    this.shafts.build(this.surfaceY, rand);
    const clumps = this.plants.build(rand);
    // 気泡の湧き出し口：水草の根元いくつかと、床の2か所（エアストーンのつもり）
    const sources = clumps.filter(() => rand() < 0.6).map((c) => ({ x: c.x, z: c.z }));
    for (let i = 0; i < 2; i++) {
      const a = rand() * Math.PI * 2, r = 1.0 + rand() * 1.2;
      sources.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
    this.bubbles.reset(sources, this.surfaceY, rand);
    this.dust.reset(this.surfaceY - 0.1, rand);
    // 平面検出の座標はワールドなので、床と水面の高さもワールドで渡す
    const floorWorldY = this.root.position.y;
    this.planeCaustics.setLevels(floorWorldY, floorWorldY + this.surfaceY);

    // 泳ぎ方
    const tl = CONFIG.timeline.fish;
    const h = this.headH;
    const schoolPath = new OrbitPath(rand, { r0: 1.9, y0: h * 0.85, speed: 0.2, tIn: tl[0], inDur: 16 });
    this.school = new School(this.schoolFish, schoolPath, rand);
    this.orbiters = this.soloFish.map((f, i) => new Orbiter(f, new OrbitPath(rand, {
      r0: 1.25 + i * 0.55 + rand() * 0.4,
      y0: h * (0.55 + rand() * 0.6),
      speed: 0.13 + rand() * 0.07,
      tIn: tl[0] + 1.5 + (i / 2) * tl[1],
      inDur: 15 + rand() * 4,
    })));
    this.crosser = new Crosser(this.crossFish, rand, { firstAt: 16, headY: h });
    this.bigFish = new BigFish(this.bigFishMesh);
    const [b0, b1] = CONFIG.bigFishAt;
    this.bigFishAt = b0 + rand() * (b1 - b0);
    for (const f of this.fishes) f.hide();

    this.t = startT;
    this.active = true;
    this.root.visible = true;
    this.scene.fog = this.fog;
    this.audio.start();
  }

  end() {
    this.active = false;
    this.root.visible = false;
    this.tint.mesh.visible = false;
    this.planeCaustics.clear();
    this.scene.fog = null;
    this.audio.stop();
  }

  // camera：描画に使うカメラ（XR中は three.js が頭の位置に合わせている）
  update(dt, camera, frame = null, refSpace = null) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const TL = CONFIG.timeline;

    camera.getWorldPosition(_cam);
    _camLocal.copy(_cam);
    this.root.worldToLocal(_camLocal);

    const fTint = ramp(t, TL.tint);
    this.tint.update(fTint, _cam);
    this.surface.update(t, ramp(t, TL.surface));
    this.shafts.update(t, ramp(t, TL.shafts));
    const fC = ramp(t, TL.caustics);
    this.floorCaustics.update(t, fC);
    if (frame) this.planeCaustics.update(frame, refSpace, t, fC);
    this.fog.near = 1.2 + (1 - fTint) * 20;
    this.fog.far = 10 + (1 - fTint) * 40;

    const fB = ramp(t, TL.bubbles);
    this.bubbles.setFade(Math.min(1, fB * 3));
    this.bubbles.update(dt, t, CONFIG.bubbleRate * fB);
    this.dust.setFade(ramp(t, TL.dust));
    this.dust.update(dt, t);
    this.plants.update(t, ramp(t, TL.plants) * 1.5);

    this.school.update(t, dt, _camLocal);
    for (const o of this.orbiters) o.update(t, dt, _camLocal);
    this.crosser.update(t, dt, _camLocal);

    // 大きな魚：一度だけ。現れる瞬間のプレイヤーの向きを基準に、視界の外の遠くから入ってくる
    if (this.bigFish.state === 'waiting' && t >= this.bigFishAt) {
      camera.getWorldQuaternion(_q);
      _fwd.set(0, 0, -1).applyQuaternion(_q);
      this.root.getWorldQuaternion(_q);
      _fwd.applyQuaternion(_q.invert());
      const yaw = Math.atan2(-_fwd.x, -_fwd.z);
      this.bigFish.start(yaw, Math.max(0.9, _camLocal.y - 0.05));
      this.audio.swell(26);
    }
    this.bigFish.update(t, dt, _camLocal);

    this.audio.update(fB);
  }
}

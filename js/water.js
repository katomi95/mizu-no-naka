// 水そのものの表現：うっすら青緑の色かぶり、頭上の水面、差し込む光、床と壁のコースティクス。
// パススルー映像そのものには手を加えられない（ポストエフェクト不可）ので、
// どれも「空間に置いた半透明のCG」として作る。視界全体を歪ませたり明滅させたりはしない。
import * as THREE from '../vendor/three.module.min.js';

// ---------- コースティクス模様のテクスチャ（起動時に一度だけ計算。画像ファイル不要） ----------
// セル（ボロノイ）ノイズの「いちばん近い点との距離 F1 と2番目 F2 の差」が小さいところ＝セルの境目を
// 明るい線にすると、水底に揺れる光の網目に似た模様になる。端が継ぎ目なくつながるよう、格子を周期的に扱う。
// 動きはシェーダで2枚を別方向に流して重ねることで出す。
export function makeCausticTexture(N = 256) {
  // 再現できる乱数
  let seed = 12345;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const layer = (G) => {
    const pts = new Float32Array(G * G * 2);
    for (let i = 0; i < G * G; i++) { pts[i * 2] = rand(); pts[i * 2 + 1] = rand(); }
    const out = new Float32Array(N * N);
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const x = (px + 0.5) / N * G, y = (py + 0.5) / N * G;
        const cx = Math.floor(x), cy = Math.floor(y);
        let f1 = 9, f2 = 9;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const gx = cx + ox, gy = cy + oy;
            const wx = ((gx % G) + G) % G, wy = ((gy % G) + G) % G;
            const k = (wy * G + wx) * 2;
            const dx = gx + pts[k] - x, dy = gy + pts[k + 1] - y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
          }
        }
        const e = Math.max(0, 1 - (f2 - f1) / 0.42);
        out[py * N + px] = Math.pow(e, 2.6);
      }
    }
    return out;
  };
  const a = layer(6), b = layer(11);
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const v = Math.min(1, a[i] * 0.8 + b[i] * 0.4);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.round(v * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// コースティクスを2層流して重ねる共通の GLSL
const CAUSTIC_GLSL = /* glsl */`
uniform sampler2D uCaustic;
uniform float uTime;
float caustic(vec2 p) {
  float a = texture2D(uCaustic, p + vec2(0.021, 0.013) * uTime).r;
  float b = texture2D(uCaustic, p * 1.37 + vec2(-0.017, 0.024) * uTime + 0.31).r;
  return min(a, b) * 0.6 + a * b * 0.6;
}`;

// ---------- 色かぶり：頭を包む球の内側。上は明るい水色、下は深い青緑 ----------
// 視点に追従して位置だけ合わせる（回転はさせない）。
// CGより先に（パススルー／プレビューの部屋のすぐ後に）深度テストなしで描き、現実の部屋だけを水の色に沈める。
// 魚の色は鮮やかなまま残し、CGの遠近のかすみはフォグで出す。
export class WaterTint {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uOpacity;
        varying vec3 vDir;
        void main() {
          float y = normalize(vDir).y;
          vec3 deep = vec3(0.0, 0.2, 0.26);
          vec3 light = vec3(0.2, 0.72, 0.76);
          vec3 col = mix(deep, light, smoothstep(-0.7, 0.9, y));
          float a = uOpacity * mix(0.4, 0.22, smoothstep(-0.9, 0.8, y));
          gl_FragColor = vec4(col, a);
        }`,
      side: THREE.BackSide,
      // 不透明扱いにして描画順の先頭に置く（ブレンドは CustomBlending で明示）
      transparent: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      // アルファは One で書く。パススルー（クリア時アルファ0）の上で a² に薄まらないように
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4, 24, 16), this.material);
    this.mesh.renderOrder = -900; // プレビューの部屋(-1000)の後、ほかのすべてのCGより前
    this.mesh.frustumCulled = false;
  }
  update(opacity, cameraWorldPos) {
    this.material.uniforms.uOpacity.value = opacity;
    this.mesh.visible = opacity > 0.001;
    this.mesh.position.copy(cameraWorldPos);
  }
}

// ---------- 頭上の水面 ----------
// 水中から見上げた水面らしく、真上付近（スネルの窓）は明るく、斜めに見るほど深い青緑になる。
export class WaterSurface {
  constructor(causticTex) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCaustic: { value: causticTex },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        varying vec2 vLocal;
        void main() {
          vLocal = position.xy;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: CAUSTIC_GLSL + /* glsl */`
        uniform float uOpacity;
        varying vec3 vWorld;
        varying vec2 vLocal;
        void main() {
          vec3 v = normalize(vWorld - cameraPosition);
          float win = smoothstep(0.58, 0.74, v.y);           // 真上 ±48°くらいが明るい窓
          vec2 p = vWorld.xz * 0.42;
          p += 0.06 * vec2(sin(vWorld.z * 1.3 + uTime * 0.55), cos(vWorld.x * 1.1 + uTime * 0.47));
          float c = caustic(p);
          float edge = 1.0 - smoothstep(3.5, 9.0, length(vLocal));
          vec3 deep = vec3(0.06, 0.38, 0.45);
          vec3 bright = vec3(0.62, 0.95, 1.0);
          vec3 col = mix(deep, bright, win * 0.85) + vec3(0.75, 1.0, 1.0) * c * (0.35 + 0.65 * win);
          float a = (mix(0.2, 0.36, win) + c * 0.34) * edge * uOpacity;
          gl_FragColor = vec4(col, a);
        }`,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    const geo = new THREE.CircleGeometry(9.5, 64);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.rotation.x = Math.PI / 2; // 下向きの面（下から見上げる）
    this.mesh.renderOrder = 10;
  }
  update(t, opacity) {
    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uOpacity.value = opacity;
    this.mesh.visible = opacity > 0.001;
  }
}

// ---------- 水面から差し込む光の筋 ----------
// 縦長の板をY軸まわりだけカメラに向けて（円柱ビルボード）、加算でうっすら重ねる。数本だけ。
export class LightShafts {
  constructor(count = 5) {
    this.count = count;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */`
        attribute vec3 aTop;
        attribute vec3 aBot;
        attribute vec3 aInfo; // x: 横位置(-1..1), y: 高さ方向(0上..1下), z: 幅
        attribute float aPhase;
        varying vec2 vQ;
        varying float vPhase;
        varying float vNear;
        void main() {
          vec3 c = mix(aTop, aBot, aInfo.y);
          vec3 wc = (modelMatrix * vec4(c, 1.0)).xyz;
          vec3 axis = normalize((modelMatrix * vec4(aBot - aTop, 0.0)).xyz);
          vec3 toCam = normalize(cameraPosition - wc);
          vec3 right = normalize(cross(axis, toCam));
          float w = aInfo.z * (0.7 + 0.6 * aInfo.y);
          vec3 p = wc + right * aInfo.x * w * 0.5;
          vQ = aInfo.xy;
          vPhase = aPhase;
          vNear = smoothstep(0.35, 1.0, length(cameraPosition.xz - wc.xz));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform float uOpacity;
        varying vec2 vQ;
        varying float vPhase;
        varying float vNear;
        void main() {
          float across = 1.0 - vQ.x * vQ.x;
          float along = smoothstep(0.0, 0.12, vQ.y) * (1.0 - smoothstep(0.35, 1.0, vQ.y));
          float breathe = 0.65 + 0.35 * sin(uTime * 0.33 + vPhase);
          float a = across * across * along * breathe * vNear * uOpacity * 0.11;
          gl_FragColor = vec4(vec3(0.7, 1.0, 0.95), a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  // 水面の高さが決まってから配置する
  build(surfaceY, rand) {
    const SEG = 6;
    const top = [], bot = [], info = [], phase = [], index = [];
    const slant = new THREE.Vector2(0.35, 0.18); // 光は少し斜めに差す
    for (let i = 0; i < this.count; i++) {
      const ang = (i / this.count) * Math.PI * 2 + rand() * 0.9;
      const r = 1.1 + rand() * 2.2;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const w = 0.25 + rand() * 0.4;
      const ph = rand() * 6.28;
      const base = top.length / 3;
      for (let s = 0; s <= SEG; s++) {
        const v = s / SEG;
        for (const side of [-1, 1]) {
          top.push(x, surfaceY, z);
          bot.push(x + slant.x * surfaceY, 0.15, z + slant.y * surfaceY);
          info.push(side, v, w);
          phase.push(ph);
        }
      }
      for (let s = 0; s < SEG; s++) {
        const a = base + s * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    // position は使わないが、three.js の描画には必要なのでダミーを入れる
    g.setAttribute('position', new THREE.Float32BufferAttribute(top.slice(), 3));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 3));
    g.setAttribute('aBot', new THREE.Float32BufferAttribute(bot, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    g.setIndex(index);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }

  update(t, opacity) {
    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uOpacity.value = opacity;
    this.mesh.visible = opacity > 0.001;
  }
}

// ---------- 床のコースティクス（仮想の円盤。開始位置の足元を中心に置く） ----------
export class FloorCaustics {
  constructor(causticTex, radius = 3.2) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uCaustic: { value: causticTex }, uTime: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec2 vLocal;
        varying vec3 vWorld;
        void main() {
          vLocal = position.xy;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: CAUSTIC_GLSL + /* glsl */`
        uniform float uOpacity;
        varying vec2 vLocal;
        varying vec3 vWorld;
        void main() {
          float c = caustic(vWorld.xz * 0.55);
          float fade = 1.0 - smoothstep(${(radius * 0.45).toFixed(2)}, ${radius.toFixed(2)}, length(vLocal));
          float a = c * fade * uOpacity * 0.5;
          gl_FragColor = vec4(vec3(0.72, 1.0, 0.95), a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.004;
    this.mesh.renderOrder = 5;
  }
  update(t, opacity) {
    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uOpacity.value = opacity;
    this.mesh.visible = opacity > 0.001;
  }
}

// ---------- 現実の壁・天井のコースティクス（WebXR 平面検出が使えたときだけ） ----------
// 平面は XR の基準空間の座標で届くので、ワールド（scene 直下）に置く。
// 使えない・許可されない・部屋のスキャンが無いときは、何も出さないだけ。
export class PlaneCaustics {
  constructor(scene, causticTex, max = 24) {
    this.scene = scene;
    this.max = max;
    this.planes = new Map(); // XRPlane -> { mesh, changed }
    this.floorY = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCaustic: { value: causticTex },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uFloorY: { value: 0 },
        uTopY: { value: 2.4 },
      },
      vertexShader: /* glsl */`
        varying vec2 vPlane;
        varying vec3 vWorld;
        void main() {
          vPlane = position.xz;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: CAUSTIC_GLSL + /* glsl */`
        uniform float uOpacity;
        uniform float uFloorY;
        uniform float uTopY;
        varying vec2 vPlane;
        varying vec3 vWorld;
        void main() {
          float c = caustic(vPlane * 0.5 + vec2(0.0, uTime * 0.004));
          // 水面に近い上の方ほど明るく、床に近いほど弱く
          float h = smoothstep(uFloorY + 0.3, uTopY, vWorld.y);
          float a = c * uOpacity * (0.12 + 0.3 * h);
          gl_FragColor = vec4(vec3(0.7, 1.0, 0.96), a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }

  setLevels(floorY, topY) {
    this.material.uniforms.uFloorY.value = floorY;
    this.material.uniforms.uTopY.value = topY;
    this.floorY = floorY;
  }

  _build(plane) {
    const pts = plane.polygon.map((p) => new THREE.Vector2(p.x, p.z));
    if (pts.length < 3) return null;
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    if (!tris.length) return null;
    const pos = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 2] = p.y; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(tris.flat());
    g.computeBoundingSphere();
    return g;
  }

  update(frame, refSpace, t, opacity) {
    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uOpacity.value = opacity;
    const detected = frame && frame.detectedPlanes;
    if (!detected || !refSpace) return;

    for (const [plane, entry] of this.planes) {
      if (!detected.has(plane)) {
        this._remove(plane, entry);
      }
    }
    for (const plane of detected) {
      let entry = this.planes.get(plane);
      if (!entry) {
        if (this.planes.size >= this.max) continue;
        entry = { mesh: null, changed: -1, skip: false };
        this.planes.set(plane, entry);
      }
      if (entry.skip) continue;
      const pose = frame.getPose(plane.planeSpace, refSpace);
      if (!pose) continue;
      if (entry.changed !== plane.lastChangedTime) {
        entry.changed = plane.lastChangedTime;
        // 床（およびそれに近い低い水平面）は仮想の床コースティクスがあるので使わない
        const y = pose.transform.position.y;
        const label = plane.semanticLabel || '';
        if (label === 'floor' || (plane.orientation === 'horizontal' && label !== 'ceiling' && y < this.floorY + 0.2)) {
          entry.skip = true;
          continue;
        }
        const g = this._build(plane);
        if (!g) continue;
        if (entry.mesh) {
          entry.mesh.geometry.dispose();
          entry.mesh.geometry = g;
        } else {
          entry.mesh = new THREE.Mesh(g, this.material);
          entry.mesh.matrixAutoUpdate = false;
          entry.mesh.renderOrder = 6;
          this.scene.add(entry.mesh);
        }
      }
      if (entry.mesh) {
        entry.mesh.matrix.fromArray(pose.transform.matrix);
        entry.mesh.matrixWorldNeedsUpdate = true;
        entry.mesh.visible = opacity > 0.001;
      }
    }
  }

  _remove(plane, entry) {
    if (entry.mesh) {
      entry.mesh.geometry.dispose();
      entry.mesh.removeFromParent();
    }
    this.planes.delete(plane);
  }

  clear() {
    for (const [plane, entry] of this.planes) this._remove(plane, entry);
  }
}

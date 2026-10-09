// 起動・モード切替・メインループ。
//  - XRモード：Quest Browser の immersive-ar（パススルー）。現実の部屋の中に水中の世界を重ねる。
//  - プレビューモード：PCブラウザ。簡単な仮想の部屋を表示し、マウスドラッグで見回す。
// 水中の演出（world.js）は両モード共通。
import * as THREE from '../vendor/three.module.min.js';
import { Aquarium } from './world.js';
import { Ambient } from './audio.js';
import { EndButton, makeRay } from './endbutton.js';

const $ = (id) => document.getElementById(id);
const titleEl = $('title');
const startBtn = $('btn-start');
const previewBtn = $('btn-preview');
const backBtn = $('btn-back');
const statusEl = $('xr-status');
const hintEl = $('hint');

// 確認用の URL パラメータ：?t=30（30秒目から始める）、?planes=0（平面検出を使わない）
const params = new URLSearchParams(location.search);
const START_T = Math.max(0, parseFloat(params.get('t')) || 0);
const USE_PLANES = params.get('planes') !== '0';

// ---------- レンダラーとシーン ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.03, 60);
scene.add(camera);

const ambient = new Ambient();
const world = new Aquarium(scene, ambient);
const endButton = new EndButton();
world.root.add(endButton.mesh);

let mode = 'title'; // 'title' | 'xr' | 'preview'

// ---------- PCプレビュー用の仮想の部屋 ----------
// パススルーの代わり。XR と同じ見え方になるよう、深度を書かず一番最初に描く
// （CGはいつも部屋の手前に重なる。現実の壁の向こうへ泳いでいく魚も見える、という XR の見え方と同じ）。
const room = new THREE.Group();
{
  const W = 6.4, D = 6.4, H = 2.5;
  const mat = (c) => new THREE.MeshBasicMaterial({ color: c, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const add = (geo, color, x, y, z, rx = 0, ry = 0) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    m.renderOrder = -1000;
    room.add(m);
    return m;
  };
  add(new THREE.PlaneGeometry(W, D), 0x9b8063, 0, 0, 0, -Math.PI / 2);          // 床
  add(new THREE.PlaneGeometry(W, D), 0xe9e6df, 0, H, 0, Math.PI / 2);           // 天井
  add(new THREE.PlaneGeometry(W, H), 0xd8d2c6, 0, H / 2, -D / 2);               // 正面の壁
  add(new THREE.PlaneGeometry(W, H), 0xcfc8ba, 0, H / 2, D / 2, 0, Math.PI);    // 後ろの壁
  add(new THREE.PlaneGeometry(D, H), 0xc8c1b3, -W / 2, H / 2, 0, 0, Math.PI / 2);
  add(new THREE.PlaneGeometry(D, H), 0xd2cbbd, W / 2, H / 2, 0, 0, -Math.PI / 2);
  // 窓・ソファ・棚・ローテーブル（距離感の目安）
  add(new THREE.PlaneGeometry(1.6, 1.1), 0xbfdcec, 0.9, 1.45, -D / 2 + 0.01);
  // 家具は面ごとの明暗が分かるよう Lambert（裏面は描かない：深度を書かないので）
  const box = (w, h, d, color, x, z, y = h / 2) => {
    const m = add(new THREE.BoxGeometry(w, h, d), color, x, y, z);
    m.material = new THREE.MeshLambertMaterial({ color, depthWrite: false, fog: false });
    return m;
  };
  box(1.9, 0.42, 0.85, 0x5d7480, -1.6, -2.7);
  box(1.9, 0.3, 0.2, 0x4f6470, -1.6, -3.05, 0.6);
  box(0.8, 1.7, 0.35, 0x8a6a48, 2.6, -3.0);
  box(0.9, 0.38, 0.5, 0x7a5c40, -0.2, -1.6);
  // 床の目地（奥行きの手がかり）
  const grid = new THREE.GridHelper(W, 16, 0x8a7055, 0x8a7055);
  grid.material.depthWrite = false;
  grid.material.fog = false;
  grid.renderOrder = -999;
  grid.position.y = 0.002;
  room.add(grid);
}
room.visible = false;
scene.add(room);

// ---------- タイトル画面：XR 対応状況の確認 ----------
function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function checkXR() {
  if (!window.isSecureContext) {
    setStatus('WebXR は HTTPS（または localhost）でのみ動きます。GitHub Pages の https:// のURLで開いてください。PCではプレビューで見られます。', true);
    return;
  }
  if (!('xr' in navigator)) {
    setStatus('このブラウザは WebXR に対応していません。Meta Quest 3 のブラウザで開いてください。PCではプレビューで見られます。', true);
    return;
  }
  let ok = false;
  try {
    ok = await navigator.xr.isSessionSupported('immersive-ar');
  } catch (e) {
    console.warn(e);
  }
  if (ok) {
    startBtn.disabled = false;
    setStatus('パススルーMRで体験できます。「はじめる」を押すと現実の部屋が映ります。');
  } else {
    setStatus('この環境はパススルーMR（immersive-ar）に対応していません。Meta Quest 3 のブラウザで開いてください。PCではプレビューで見られます。', true);
  }
}
checkXR();

// ---------- XR（Quest 3） ----------
const controllers = [];
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  c.userData.hover = false;
  c.userData.connected = false;
  const ray = makeRay();
  c.add(ray);
  c.userData.ray = ray;
  c.addEventListener('connected', () => { c.userData.connected = true; });
  c.addEventListener('disconnected', () => { c.userData.connected = false; c.userData.hover = false; ray.visible = false; });
  // ボタンを指したままトリガーを引き切ったら終了（select は押して離したときに1回だけ届く）
  c.addEventListener('select', () => {
    if (mode === 'xr' && c.userData.hover) endXR();
  });
  scene.add(c);
  controllers.push(c);
}

let xrPlaced = false;
let xrRefIsFloor = true;

async function startXR() {
  ambient.init(); // ボタン操作の中で音を有効化しておく
  startBtn.disabled = true;
  setStatus('起動中…');
  let session;
  try {
    // 必須の機能は指定しない。床基準と平面検出は「使えたら使う」
    const optionalFeatures = ['local-floor'];
    if (USE_PLANES) optionalFeatures.push('plane-detection');
    session = await navigator.xr.requestSession('immersive-ar', { optionalFeatures });
  } catch (e) {
    console.error(e);
    setStatus(`パススルーMRを開始できませんでした（${e.name || 'Error'}: ${e.message || e}）。許可ダイアログで拒否した場合は、ページを再読み込みしてもう一度お試しください。`, true);
    startBtn.disabled = false;
    return;
  }

  // 床基準が使えるか確認。使えなければ 'local'（開始時の頭の位置が原点）で、床の高さは推定する
  let refType = 'local-floor';
  try {
    await session.requestReferenceSpace('local-floor');
  } catch (e) {
    refType = 'local';
  }
  xrRefIsFloor = refType === 'local-floor';
  renderer.xr.setReferenceSpaceType(refType);
  try {
    await renderer.xr.setSession(session);
  } catch (e) {
    console.error(e);
    setStatus(`XRの初期化に失敗しました（${e.message || e}）。`, true);
    startBtn.disabled = false;
    session.end().catch(() => {});
    return;
  }
  session.addEventListener('end', onXREnd);

  mode = 'xr';
  titleEl.hidden = true;
  backBtn.hidden = true;
  hintEl.hidden = true;
  // パススルーを見せるため、背景は完全に透明にする
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  room.visible = false;
  xrPlaced = false; // 最初のフレームで頭の位置が分かってから世界を置く
}

// XR の最初のフレームで、頭の位置と向きを基準に水中の世界を置く
const _p = new THREE.Vector3();
const _qh = new THREE.Quaternion();
const _f = new THREE.Vector3();
function placeXR(frame) {
  const ref = renderer.xr.getReferenceSpace();
  const pose = frame && ref && frame.getViewerPose(ref);
  if (!pose) return false;
  const { position: p, orientation: o } = pose.transform;
  _p.set(p.x, p.y, p.z);
  _qh.set(o.x, o.y, o.z, o.w);
  _f.set(0, 0, -1).applyQuaternion(_qh);
  const yaw = Math.atan2(-_f.x, -_f.z);
  let floorY, headH;
  if (xrRefIsFloor) {
    floorY = 0;
    headH = _p.y;
  } else {
    headH = 1.3; // 床の高さが分からないので、座った〜立った人の目の高さの間くらいと仮定
    floorY = _p.y - headH;
  }
  world.root.position.set(_p.x, floorY, _p.z);
  world.root.rotation.set(0, yaw, 0);
  world.root.updateMatrixWorld(true);
  world.begin({ headH, startT: START_T });
  endButton.place(world.headH);
  return true;
}

function endXR() {
  const s = renderer.xr.getSession();
  if (s) s.end().catch(() => {});
}

function onXREnd() {
  world.end();
  endButton.hide();
  for (const c of controllers) { c.userData.hover = false; c.userData.ray.visible = false; }
  backToTitle();
}

// コントローラーの光線と「おわる」ボタンの当たり判定
const raycaster = new THREE.Raycaster();
const _rot = new THREE.Matrix4();
const _bp = new THREE.Vector3();
function updatePointers() {
  if (!endButton.mesh.visible) return;
  let any = false;
  endButton.mesh.getWorldPosition(_bp);
  for (const c of controllers) {
    const ray = c.userData.ray;
    if (!c.userData.connected) { ray.visible = false; c.userData.hover = false; continue; }
    c.updateMatrixWorld(true);
    _rot.identity().extractRotation(c.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_rot);
    const hit = raycaster.intersectObject(endButton.mesh, false)[0];
    c.userData.hover = !!hit;
    any = any || !!hit;
    // ボタンの方をだいたい指しているときだけ光線を見せる（ふだんは何も出さない）
    const toBtn = _bp.clone().sub(raycaster.ray.origin);
    const dist = toBtn.length();
    const near = toBtn.normalize().dot(raycaster.ray.direction) > Math.cos(THREE.MathUtils.degToRad(22));
    ray.visible = near;
    ray.scale.z = hit ? hit.distance : Math.min(dist, 1.2);
  }
  endButton.setHover(any);
}

// ---------- PCプレビュー ----------
const look = { yaw: 0, pitch: -0.08, down: false, x: 0, y: 0, moved: 0, id: null };
const PREVIEW_HEAD = 1.2; // 座った人の目の高さくらい
let hintTimer = 0;

function applyLook() {
  camera.position.set(0, PREVIEW_HEAD, 0);
  camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
}

function startPreview() {
  ambient.init();
  mode = 'preview';
  titleEl.hidden = true;
  backBtn.hidden = false;
  hintEl.hidden = false;
  hintEl.classList.remove('fade');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.add('fade'), 5000);
  document.body.classList.add('preview');
  scene.background = new THREE.Color(0x222222);
  renderer.setClearColor(0x222222, 1);
  room.visible = true;
  look.yaw = 0;
  look.pitch = -0.08;
  applyLook();
  world.root.position.set(0, 0, 0);
  world.root.rotation.set(0, 0, 0);
  world.root.updateMatrixWorld(true);
  world.begin({ headH: PREVIEW_HEAD, startT: START_T });
  endButton.place(world.headH);
}

function backToTitle() {
  mode = 'title';
  world.end();
  endButton.hide();
  room.visible = false;
  document.body.classList.remove('preview');
  backBtn.hidden = true;
  hintEl.hidden = true;
  titleEl.hidden = false;
  startBtn.disabled = true;
  checkXR();
}

const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'preview' || e.button !== 0) return;
  look.down = true;
  look.x = e.clientX;
  look.y = e.clientY;
  look.moved = 0;
  look.id = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (mode !== 'preview' || !look.down || e.pointerId !== look.id) return;
  const dx = e.clientX - look.x, dy = e.clientY - look.y;
  look.x = e.clientX;
  look.y = e.clientY;
  look.moved += Math.abs(dx) + Math.abs(dy);
  const k = 0.0042;
  look.yaw += dx * k;
  look.pitch = THREE.MathUtils.clamp(look.pitch + dy * k, -1.45, 1.45);
  applyLook();
});
const endDrag = (e) => {
  if (!look.down) return;
  look.down = false;
  // ほとんど動かさずに離したらクリック扱い：3D の「おわる」ボタンも試せる
  if (mode === 'preview' && look.moved < 6 && e.type === 'pointerup') {
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.intersectObject(endButton.mesh, false).length) backToTitle();
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

startBtn.addEventListener('click', startXR);
previewBtn.addEventListener('click', startPreview);
backBtn.addEventListener('click', backToTitle);

// ---------- メインループ（XR でも PC でも同じ setAnimationLoop） ----------
const clock = new THREE.Clock();

renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mode === 'title') return;

  if (mode === 'xr') {
    if (!xrPlaced) {
      xrPlaced = placeXR(frame);
    }
    if (xrPlaced) {
      world.update(dt, camera, frame, renderer.xr.getReferenceSpace());
      updatePointers();
    }
  } else {
    world.update(dt, camera);
  }

  renderer.render(scene, camera);
});

// デバッグ・自動確認用
// lookAt(x, y, z)：プレビューのカメラをその点（ワールド座標）に向ける
function lookAtPoint(x, y, z) {
  const d = new THREE.Vector3(x, y, z).sub(camera.position).normalize();
  look.yaw = Math.atan2(-d.x, -d.z);
  look.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  applyLook();
}
window.__mizu = { renderer, world, camera, look, applyLook, lookAtPoint, startPreview, backToTitle, endButton };

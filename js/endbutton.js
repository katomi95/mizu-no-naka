// XR 中の唯一の操作：「おわる」ボタン。
// 開始時の正面・少し下（見下ろすと見える位置）に置き、空間に固定する（頭について来ない）。
// コントローラー（または手）で指してトリガー（ピンチ）で終了。指していないときは控えめに表示する。
import * as THREE from '../vendor/three.module.min.js';

const FONT = '"Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif';

function drawButton(hover) {
  const W = 320, H = 120;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const r = H / 2 - 6;
  ctx.beginPath();
  ctx.moveTo(6 + r, 6);
  ctx.arcTo(W - 6, 6, W - 6, H - 6, r);
  ctx.arcTo(W - 6, H - 6, 6, H - 6, r);
  ctx.arcTo(6, H - 6, 6, 6, r);
  ctx.arcTo(6, 6, W - 6, 6, r);
  ctx.closePath();
  ctx.fillStyle = hover ? 'rgba(200,250,245,0.92)' : 'rgba(8,40,48,0.6)';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = hover ? 'rgba(255,255,255,1)' : 'rgba(190,245,240,0.7)';
  ctx.stroke();
  ctx.fillStyle = hover ? '#06323a' : '#e2fbf8';
  ctx.font = `500 ${Math.round(H * 0.42)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('おわる', W / 2, H / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class EndButton {
  constructor() {
    this.texIdle = drawButton(false);
    this.texHover = drawButton(true);
    this.material = new THREE.MeshBasicMaterial({ map: this.texIdle, transparent: true, depthWrite: false, opacity: 0.75, fog: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.06), this.material);
    this.mesh.renderOrder = 200; // 色かぶりより後（水の色に沈まないように）
    this.mesh.visible = false;
    this.hover = false;
  }

  // root（水中の世界）のローカル座標で、頭の高さ headH を基準に置く。root の子になっていること
  place(headH) {
    const root = this.mesh.parent;
    this.mesh.position.set(0.12, headH - 0.55, -0.5);
    root.updateMatrixWorld(true);
    this.mesh.lookAt(root.localToWorld(new THREE.Vector3(0, headH, 0))); // lookAt はワールド座標
    this.mesh.visible = true;
  }

  setHover(on) {
    if (on === this.hover) return;
    this.hover = on;
    this.material.map = on ? this.texHover : this.texIdle;
    this.material.opacity = on ? 1 : 0.75;
  }

  hide() {
    this.mesh.visible = false;
    this.setHover(false);
  }
}

// コントローラーごとの細い光線（ボタンの近くを指したときだけ見せる）
export function makeRay() {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd8fffb, transparent: true, opacity: 0.6, depthWrite: false }));
  line.renderOrder = 200;
  line.visible = false;
  return line;
}

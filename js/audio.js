// 水中の環境音。すべて WebAudio で合成する（音声ファイルなし）。
//  - こもった低いゴーッという音（ブラウンノイズを低域に絞り、ゆっくり揺らす）
//  - 少し高めの、遠くの水の動きのようなさざめき
//  - ときどき小さな「ぽこっ」という泡の音（左右に散らす）
// AudioContext はブラウザの制約上、ボタンを押したタイミングで init() すること。
export class Ambient {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.nextBlip = 0;
  }

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);

      // ブラウンノイズ（4秒ループ）
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let last = 0;
        for (let i = 0; i < len; i++) {
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          d[i] = last * 3.5;
        }
        // ループの継ぎ目でプツッと鳴らないよう端をなじませる
        const f = 2000;
        for (let i = 0; i < f; i++) {
          const k = i / f;
          d[len - f + i] = d[len - f + i] * (1 - k) + d[i] * k;
        }
      }
      const rumble = ctx.createBufferSource();
      rumble.buffer = buf;
      rumble.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      lp.Q.value = 0.6;
      // カットオフをとてもゆっくり揺らす（うねり）
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.06;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 140;
      lfo.connect(lfoGain).connect(lp.frequency);
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0.55;
      rumble.connect(lp).connect(rumbleGain).connect(this.master);

      // さざめき：同じノイズを帯域通過、音量をゆっくり揺らす
      const shimmer = ctx.createBufferSource();
      shimmer.buffer = buf;
      shimmer.loop = true;
      shimmer.playbackRate.value = 1.7;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.8;
      const shGain = ctx.createGain();
      shGain.gain.value = 0.05;
      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = 0.11;
      const lfo2Gain = ctx.createGain();
      lfo2Gain.gain.value = 0.03;
      lfo2.connect(lfo2Gain).connect(shGain.gain);
      shimmer.connect(bp).connect(shGain).connect(this.master);

      // 大きな魚が近くを通るときのうねり（ふだんは無音）
      this.swellGain = ctx.createGain();
      this.swellGain.gain.value = 0;
      const lp2 = ctx.createBiquadFilter();
      lp2.type = 'lowpass';
      lp2.frequency.value = 160;
      const swell = ctx.createBufferSource();
      swell.buffer = buf;
      swell.loop = true;
      swell.playbackRate.value = 0.6;
      swell.connect(lp2).connect(this.swellGain).connect(this.master);

      rumble.start();
      shimmer.start();
      swell.start();
      lfo.start();
      lfo2.start();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // 数秒かけてフェードイン
  start() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.setTargetAtTime(0.9, t + 0.8, 2.5);
    this.running = true;
    this.nextBlip = t + 3;
  }

  stop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.25);
    this.swellGain.gain.cancelScheduledValues(t);
    this.swellGain.gain.setTargetAtTime(0, t, 0.25);
    this.running = false;
  }

  // 大きな魚のうねり：数秒かけて上がり、ゆっくり引いていく
  swell(duration = 24) {
    if (!this.ctx || !this.running) return;
    const g = this.swellGain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.5, t + duration * 0.45);
    g.linearRampToValueAtTime(0, t + duration);
  }

  // 毎フレーム呼ぶ。泡の音をときどき鳴らす（level 0..1 で頻度を調整）
  update(level) {
    if (!this.ctx || !this.running || level <= 0.05) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now < this.nextBlip) return;
    this.nextBlip = now + (0.5 + Math.random() * 2.2) / level;
    const n = Math.random() < 0.25 ? 2 + Math.floor(Math.random() * 3) : 1;
    const pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < n; i++) this.blip(now + i * (0.08 + Math.random() * 0.07), pan);
  }

  blip(t, pan) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    const f0 = 380 + Math.random() * 520;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.6 + Math.random() * 0.6), t + 0.07);
    const vol = 0.025 + Math.random() * 0.03;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    let node = o.connect(g);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(this.master);
    o.start(t);
    o.stop(t + 0.14);
  }
}

import type { MatchEvent } from '../match';

/**
 * Procedural sound. Every effect is synthesised on the spot from oscillators
 * and one buffer of white noise - there is not a single audio file in the
 * project, which keeps the "original assets only" rule trivially true.
 *
 * Browsers refuse to start audio before a user gesture, so the context is
 * created lazily on the first key or click. Until then everything is silent.
 */

const STORAGE_KEY = 'worms.volume';

/** Where the listener is: the middle of the view, and half its world width. */
export interface Listener {
  x: number;
  y: number;
  halfWidth: number;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;
  /** Last time each kind of sound played, to stop a rolling grenade machine-gunning clacks. */
  private lastPlayed = new Map<string, number>();

  volume = 0.7;
  muted = false;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (saved && typeof saved.volume === 'number') {
        this.volume = Math.min(1, Math.max(0, saved.volume));
        this.muted = !!saved.muted;
      }
    } catch {
      // No storage (private window, blocked site data): keep the defaults.
    }
    const unlock = () => this.unlock();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  private unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext();
      // A compressor on the bus lets five cluster shards go off at once
      // without clipping into a crackle.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.ratio.value = 8;
      limiter.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.connect(limiter);

      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      this.ctx = ctx;
      this.applyVolume();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // --- volume -------------------------------------------------------------

  changeVolume(delta: number): void {
    this.volume = Math.round(Math.min(1, Math.max(0, this.volume + delta)) * 10) / 10;
    this.muted = false;
    this.applyVolume();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.applyVolume();
  }

  private applyVolume(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: this.volume, muted: this.muted }));
    } catch {
      // Not persisted; the setting still holds for this session.
    }
    if (!this.ctx) return;
    // Squared so the steps feel even to the ear rather than bunched at the top.
    const level = this.muted ? 0 : this.volume * this.volume;
    this.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.02);
  }

  // --- events -------------------------------------------------------------

  play(events: readonly MatchEvent[], listener: Listener): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    for (const e of events) {
      const at = 'x' in e ? this.place(e.x, e.y, listener) : { gain: 1, pan: 0 };
      if (at.gain < 0.03) continue;
      this.voice(e, at.gain, at.pan);
    }
  }

  /** Quieter with distance from the view, and panned toward its side. */
  private place(x: number, y: number, l: Listener): { gain: number; pan: number } {
    const dist = Math.hypot(x - l.x, (y - l.y) * 1.3);
    const beyond = Math.max(0, dist - l.halfWidth * 0.8);
    return {
      gain: 1 / (1 + (beyond / l.halfWidth) * 2.5),
      pan: Math.max(-1, Math.min(1, (x - l.x) / l.halfWidth)) * 0.75,
    };
  }

  /** True if this kind of sound played within `ms`; records it otherwise. */
  private throttled(key: string, ms: number): boolean {
    const now = performance.now();
    if (now - (this.lastPlayed.get(key) ?? -1e9) < ms) return true;
    this.lastPlayed.set(key, now);
    return false;
  }

  private voice(e: MatchEvent, g: number, pan: number): void {
    switch (e.kind) {
      case 'explode': {
        // Radius 8 (a shard) to 60+ (holy) maps onto a small pop to a deep boom.
        const size = Math.min(1, Math.max(0.15, (e.radius - 6) / 50));
        if (e.holy) this.hallelujah(g);
        this.boom(size, g, pan, e.holy ? 1.1 : 0);
        break;
      }
      case 'launch':
        this.launch(e.weapon, g, pan);
        break;
      case 'shot':
        this.noiseBurst({ gain: 0.55 * g, pan, dur: 0.09, filter: 'highpass', from: 1400, to: 900 });
        this.tone({ type: 'square', from: 180, to: 60, dur: 0.05, gain: 0.25 * g, pan });
        break;
      case 'swing':
        this.noiseBurst({ gain: 0.3 * g, pan, dur: 0.18, filter: 'bandpass', from: 500, to: 2200, q: 1.5 });
        if (e.hit) {
          const bat = e.weapon === 'bat';
          this.tone({ type: bat ? 'triangle' : 'sine', from: bat ? 520 : 160, to: bat ? 300 : 55, dur: 0.14, gain: 0.7 * g, pan, delay: 0.05 });
          this.noiseBurst({ gain: 0.5 * g, pan, dur: 0.08, filter: 'lowpass', from: 2400, to: 400, delay: 0.05 });
        }
        break;
      case 'bounce':
        if (e.speed < 0.5 || this.throttled('bounce', 70)) break;
        this.tone({ type: 'triangle', from: 420, to: 190, dur: 0.06, gain: Math.min(0.5, e.speed * 0.12) * g, pan });
        break;
      case 'mineTrigger':
        for (let i = 0; i < 4; i++) {
          this.tone({ type: 'square', from: 1480, to: 1480, dur: 0.07, gain: 0.18 * g, pan, delay: i * 0.18 });
        }
        break;
      case 'splash':
        if (this.throttled('splash', 60)) break;
        this.noiseBurst({ gain: (e.big ? 0.6 : 0.35) * g, pan, dur: e.big ? 0.7 : 0.4, filter: 'bandpass', from: 1800, to: 250, q: 0.9 });
        for (let i = 0; i < (e.big ? 5 : 2); i++) {
          const f = 500 + Math.random() * 700;
          this.tone({ type: 'sine', from: f, to: f * 1.8, dur: 0.06, gain: 0.12 * g, pan, delay: 0.15 + Math.random() * 0.4 });
        }
        break;
      case 'jump':
        this.tone({ type: 'sine', from: e.backflip ? 380 : 300, to: e.backflip ? 900 : 640, dur: 0.11, gain: 0.22 * g, pan });
        break;
      case 'hurtLanding':
        this.tone({ type: 'sine', from: 140, to: 45, dur: 0.18, gain: 0.7 * g, pan });
        this.noiseBurst({ gain: 0.3 * g, pan, dur: 0.1, filter: 'lowpass', from: 900, to: 200 });
        break;
      case 'death':
        this.tone({ type: 'square', from: 520, to: 70, dur: 0.6, gain: 0.16 * g, pan });
        break;
      case 'ropeShot':
        this.noiseBurst({ gain: 0.25 * g, pan, dur: 0.16, filter: 'highpass', from: 2500, to: 5000 });
        this.tone({ type: 'triangle', from: 500, to: 1400, dur: 0.12, gain: 0.12 * g, pan });
        break;
      case 'ropeCatch':
        this.tone({ type: 'triangle', from: 2100, to: 1700, dur: 0.09, gain: 0.3 * g, pan });
        this.tone({ type: 'sine', from: 3200, to: 3000, dur: 0.05, gain: 0.12 * g, pan });
        break;
      case 'ropeRelease':
        this.noiseBurst({ gain: 0.12 * g, pan, dur: 0.12, filter: 'bandpass', from: 900, to: 1600, q: 2 });
        break;
      case 'torch':
        // A steady roar: short overlapping bursts, one every few ticks.
        if (this.throttled('torch', 90)) break;
        this.noiseBurst({ gain: 0.22 * g, pan, dur: 0.16, filter: 'bandpass', from: 700, to: 1100, q: 0.8 });
        break;
      case 'girder':
        // Steel dropped into place: a clang with a ringing overtone.
        this.tone({ type: 'triangle', from: 330, to: 300, dur: 0.35, gain: 0.35 * g, pan });
        this.tone({ type: 'sine', from: 1250, to: 1210, dur: 0.5, gain: 0.12 * g, pan });
        this.noiseBurst({ gain: 0.3 * g, pan, dur: 0.06, filter: 'highpass', from: 2000, to: 3000 });
        break;
      case 'select':
        this.tone({ type: 'square', from: 1250, to: 1250, dur: 0.03, gain: 0.12 });
        break;
      case 'turnStart':
        this.tone({ type: 'triangle', from: 660, to: 660, dur: 0.12, gain: 0.2 });
        this.tone({ type: 'triangle', from: 990, to: 990, dur: 0.2, gain: 0.2, delay: 0.1 });
        break;
      case 'countdown':
        this.tone({ type: 'square', from: 880, to: 880, dur: 0.06, gain: e.seconds <= 1 ? 0.2 : 0.13 });
        break;
      case 'timeUp':
        this.tone({ type: 'square', from: 700, to: 700, dur: 0.14, gain: 0.18 });
        this.tone({ type: 'square', from: 470, to: 470, dur: 0.3, gain: 0.18, delay: 0.15 });
        break;
      case 'suddenDeath':
        [392, 370, 294, 196].forEach((f, i) =>
          this.tone({ type: 'sawtooth', from: f, to: f, dur: 0.4, gain: 0.16, delay: i * 0.28, lowpass: 1600 }),
        );
        break;
      case 'gameOver':
        (e.draw ? [523, 440, 349] : [523, 659, 784, 1047]).forEach((f, i) =>
          this.tone({ type: 'square', from: f, to: f, dur: 0.22, gain: 0.14, delay: i * 0.16, lowpass: 3000 }),
        );
        break;
    }
  }

  /** The launch noise of each weapon family. */
  private launch(weapon: string, g: number, pan: number): void {
    switch (weapon) {
      case 'bazooka':
      case 'homing':
      case 'mortar':
        this.noiseBurst({ gain: 0.6 * g, pan, dur: 0.45, filter: 'bandpass', from: 300, to: 2600, q: 1.2 });
        this.tone({ type: 'sine', from: 110, to: 50, dur: 0.12, gain: 0.5 * g, pan });
        break;
      case 'airstrike':
        // A long low drone as the bomber crosses the sky.
        this.tone({ type: 'sawtooth', from: 72, to: 64, dur: 2.6, gain: 0.12 * g, pan, lowpass: 420, attack: 0.6 });
        this.noiseBurst({ gain: 0.2 * g, pan, dur: 2.6, filter: 'lowpass', from: 500, to: 300, attack: 0.6 });
        break;
      case 'dynamite':
        // The fuse fizzes as it is lit.
        this.noiseBurst({ gain: 0.18 * g, pan, dur: 0.6, filter: 'highpass', from: 4000, to: 5000 });
        break;
      case 'mine':
        this.tone({ type: 'triangle', from: 300, to: 220, dur: 0.08, gain: 0.3 * g, pan });
        break;
      default:
        // Anything thrown: a short whoosh off the hand.
        this.noiseBurst({ gain: 0.3 * g, pan, dur: 0.22, filter: 'bandpass', from: 700, to: 1800, q: 2 });
    }
  }

  private boom(size: number, g: number, pan: number, delay: number): void {
    const dur = 0.35 + size * 1.3;
    this.noiseBurst({ gain: (0.45 + size * 0.55) * g, pan, dur, filter: 'lowpass', from: 900 + size * 2600, to: 90, delay });
    this.tone({ type: 'sine', from: 120 - size * 50, to: 28, dur: dur * 0.7, gain: (0.5 + size * 0.5) * g, pan, delay });
    // A crackle of debris trailing the blast.
    this.noiseBurst({ gain: 0.2 * size * g, pan, dur: dur * 0.8, filter: 'highpass', from: 2500, to: 1200, delay: delay + 0.05 });
  }

  /** The Blessed Grenade's choir: a swelling, vibrato A-major chord. */
  private hallelujah(g: number): void {
    for (const f of [220, 277.2, 329.6, 440, 554.4]) {
      for (const detune of [-6, 6]) {
        this.tone({ type: 'sawtooth', from: f, to: f, dur: 1.1, gain: 0.05 * g, detune, lowpass: 1800, attack: 0.35, vibrato: 5 });
      }
    }
  }

  // --- the power bar ------------------------------------------------------

  /** A tone that climbs with the charge; null silences it. */
  charge(level: number | null): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (level === null) {
      if (this.chargeOsc) {
        this.chargeGain!.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
        this.chargeOsc.stop(ctx.currentTime + 0.1);
        this.chargeOsc = null;
        this.chargeGain = null;
      }
      return;
    }
    if (!this.chargeOsc) {
      this.chargeOsc = ctx.createOscillator();
      this.chargeOsc.type = 'square';
      this.chargeGain = ctx.createGain();
      this.chargeGain.gain.value = 0;
      this.chargeGain.gain.setTargetAtTime(0.07, ctx.currentTime, 0.02);
      this.chargeOsc.connect(this.chargeGain).connect(this.master);
      this.chargeOsc.start();
    }
    this.chargeOsc.frequency.setTargetAtTime(160 + level * 700, ctx.currentTime, 0.02);
  }

  // --- building blocks ----------------------------------------------------

  private out(pan: number): AudioNode {
    const ctx = this.ctx!;
    if (pan === 0) return this.master;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master);
    return p;
  }

  private envelope(gain: GainNode, peak: number, start: number, dur: number, attack: number): void {
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  }

  private tone(o: {
    type: OscillatorType;
    from: number;
    to: number;
    dur: number;
    gain: number;
    pan?: number;
    delay?: number;
    detune?: number;
    lowpass?: number;
    attack?: number;
    vibrato?: number;
  }): void {
    const ctx = this.ctx!;
    const start = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.detune.value = o.detune ?? 0;
    osc.frequency.setValueAtTime(o.from, start);
    if (o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(o.to, start + o.dur);

    const gain = ctx.createGain();
    this.envelope(gain, o.gain, start, o.dur, o.attack ?? 0.005);

    let node: AudioNode = osc;
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      node = node.connect(f);
    }
    node.connect(gain).connect(this.out(o.pan ?? 0));

    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = o.vibrato;
      depth.gain.value = o.from * 0.012;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + o.dur + 0.05);
    }
    osc.start(start);
    osc.stop(start + o.dur + 0.05);
  }

  private noiseBurst(o: {
    gain: number;
    dur: number;
    filter: BiquadFilterType;
    from: number;
    to: number;
    q?: number;
    pan?: number;
    delay?: number;
    attack?: number;
  }): void {
    const ctx = this.ctx!;
    const start = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    // A random read offset keeps two identical blasts from sounding cloned.
    const offset = Math.random() * 0.9;

    const f = ctx.createBiquadFilter();
    f.type = o.filter;
    f.Q.value = o.q ?? 0.7;
    f.frequency.setValueAtTime(o.from, start);
    f.frequency.exponentialRampToValueAtTime(o.to, start + o.dur);

    const gain = ctx.createGain();
    this.envelope(gain, o.gain, start, o.dur, o.attack ?? 0.004);

    src.connect(f).connect(gain).connect(this.out(o.pan ?? 0));
    src.start(start, offset);
    src.stop(start + o.dur + 0.05);
  }
}

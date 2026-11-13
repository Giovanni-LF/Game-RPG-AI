import { ActiveSkillId, WeaponKind } from '../types/game';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private tone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0
  ) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, freqStart), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), now + duration);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private noise(duration: number, filterFreq: number, volume: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
  }

  playSwing(kind: WeaponKind) {
    if (kind === 'daggers') {
      this.noise(0.08, 1800, 0.09);
      this.tone(420, 220, 0.07, 'triangle', 0.05);
    } else if (kind === 'staff') {
      this.tone(540, 290, 0.14, 'sine', 0.08);
      this.tone(820, 420, 0.11, 'triangle', 0.04);
    } else {
      this.noise(0.14, 720, 0.11);
      this.tone(240, 95, 0.13, 'sawtooth', 0.06);
    }
  }

  playHit(isCrit: boolean) {
    if (isCrit) {
      this.tone(180, 58, 0.16, 'sawtooth', 0.13);
      this.tone(680, 340, 0.12, 'triangle', 0.09);
      this.noise(0.11, 1200, 0.12);
    } else {
      this.tone(145, 65, 0.09, 'triangle', 0.09);
      this.noise(0.06, 900, 0.07);
    }
  }

  playDash() {
    this.noise(0.16, 1300, 0.1);
    this.tone(320, 140, 0.14, 'sine', 0.06);
  }

  playSkill(skillId: ActiveSkillId) {
    switch (skillId) {
      case 'whirlwind':
        this.noise(0.26, 950, 0.13);
        this.tone(260, 120, 0.24, 'sawtooth', 0.08);
        break;
      case 'aegis':
        this.tone(280, 560, 0.25, 'triangle', 0.1);
        this.tone(420, 840, 0.22, 'sine', 0.07, 0.04);
        break;
      case 'shadow_step':
        this.noise(0.14, 2400, 0.09);
        this.tone(620, 180, 0.16, 'sine', 0.08);
        break;
      case 'dagger_fan':
        this.noise(0.12, 2200, 0.1);
        this.tone(760, 380, 0.11, 'triangle', 0.06);
        break;
      case 'abyss_lance':
        this.tone(460, 140, 0.28, 'sawtooth', 0.09);
        this.tone(690, 260, 0.22, 'sine', 0.07);
        break;
      case 'eclipse_nova':
        this.tone(180, 480, 0.34, 'triangle', 0.11);
        this.tone(360, 120, 0.36, 'sawtooth', 0.07, 0.05);
        break;
    }
  }

  playPlayerHurt() {
    this.tone(130, 52, 0.2, 'sawtooth', 0.14);
    this.noise(0.12, 500, 0.1);
  }

  playPickup(isRare = false) {
    if (isRare) {
      this.tone(523, 659, 0.14, 'triangle', 0.09);
      this.tone(659, 987, 0.18, 'sine', 0.09, 0.08);
    } else {
      this.tone(580, 860, 0.09, 'sine', 0.06);
    }
  }

  playLevelUp() {
    this.tone(392, 392, 0.15, 'triangle', 0.1, 0);
    this.tone(493.88, 493.88, 0.15, 'triangle', 0.1, 0.09);
    this.tone(587.33, 587.33, 0.18, 'triangle', 0.11, 0.18);
    this.tone(783.99, 783.99, 0.32, 'sine', 0.12, 0.27);
  }

  playChestOpen() {
    this.tone(330, 440, 0.15, 'triangle', 0.09, 0);
    this.tone(440, 660, 0.24, 'sine', 0.09, 0.1);
  }

  playShrine() {
    this.tone(293.66, 440, 0.32, 'sine', 0.09, 0);
    this.tone(440, 587.33, 0.35, 'triangle', 0.08, 0.12);
  }

  playFlask() {
    this.tone(380, 720, 0.2, 'sine', 0.08);
    this.noise(0.08, 1500, 0.04);
  }

  playBossRoar() {
    this.tone(110, 48, 0.55, 'sawtooth', 0.15);
    this.tone(146, 62, 0.5, 'triangle', 0.1, 0.05);
  }

  playVictory() {
    const notes = [392, 493.88, 587.33, 783.99];
    notes.forEach((n, idx) => {
      this.tone(n, n * 1.01, 0.3, 'triangle', 0.11, idx * 0.12);
    });
  }
}

export const sfx = new SoundEngine();

import { sfx } from './sfx';

export type MusicMode = 'title' | 'crypt' | 'boss' | 'victory' | 'gameover';

interface MusicConfig {
  mode: MusicMode;
  floorNumber: number;
  paused: boolean;
}

const MUSIC_STORAGE_KEY = 'criptas_music_enabled';

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// D Dorian / Minor title progression (64 steps = 4 bars of 16th notes)
const TITLE_BASS = [38, 0, 0, 0, 38, 0, 0, 0, 46, 0, 0, 0, 43, 0, 45, 0];
const TITLE_CHORDS: number[][] = [
  [50, 53, 57], // Dm
  [46, 50, 53], // Bb
  [43, 46, 50], // Gm
  [45, 49, 52], // A
];
const TITLE_ARP = [
  62, 0, 65, 0, 69, 0, 65, 0, 62, 0, 65, 0, 72, 0, 69, 0,
  58, 0, 62, 0, 65, 0, 62, 0, 58, 0, 62, 0, 69, 0, 65, 0,
  55, 0, 58, 0, 62, 0, 58, 0, 55, 0, 62, 0, 67, 0, 62, 0,
  57, 0, 61, 0, 64, 0, 69, 0, 64, 0, 61, 0, 57, 0, 0, 0,
];

// Crypt exploration: D Harmonic / Phrygian tension (64 steps)
const CRYPT_BASS = [
  38, 0, 38, 0, 0, 38, 0, 41, 38, 0, 38, 0, 44, 0, 43, 0,
  38, 0, 38, 0, 0, 38, 0, 41, 36, 0, 39, 0, 43, 0, 45, 0,
];
const CRYPT_ARP = [
  62, 0, 65, 69, 0, 65, 62, 0, 61, 0, 64, 69, 0, 64, 61, 0,
  62, 0, 65, 70, 0, 65, 62, 0, 60, 0, 63, 67, 0, 65, 64, 0,
  62, 0, 69, 74, 0, 69, 65, 0, 61, 0, 67, 73, 0, 67, 64, 0,
  62, 0, 65, 69, 74, 0, 70, 0, 69, 0, 65, 0, 64, 0, 61, 0,
];

// Boss battle: intense driving gothic rhythm (64 steps)
const BOSS_BASS = [
  38, 38, 50, 38, 38, 38, 50, 38, 41, 41, 53, 41, 40, 40, 52, 40,
  38, 38, 50, 38, 38, 38, 50, 38, 44, 44, 56, 44, 45, 45, 57, 45,
];
const BOSS_LEAD = [
  62, 0, 65, 0, 69, 68, 65, 0, 62, 0, 69, 0, 74, 0, 73, 0,
  70, 0, 69, 0, 65, 64, 62, 0, 61, 0, 64, 69, 73, 0, 69, 0,
  62, 0, 65, 69, 74, 0, 73, 70, 69, 0, 65, 64, 62, 0, 61, 0,
  58, 0, 62, 65, 69, 0, 70, 0, 69, 0, 73, 0, 74, 0, 76, 0,
];

function loadMusicEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = localStorage.getItem(MUSIC_STORAGE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

class MusicEngine {
  private masterGain: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private musicEnabled = loadMusicEnabled();
  private config: MusicConfig = {
    mode: 'title',
    floorNumber: 1,
    paused: false,
  };

  private timerId: number | null = null;
  private nextStepTime = 0;
  private stepIndex = 0;
  private unlockBound = false;

  constructor() {
    this.bindGestureUnlock();
  }

  private bindGestureUnlock() {
    if (typeof window === 'undefined' || this.unlockBound) return;
    this.unlockBound = true;
    const onGesture = () => {
      this.unlock();
    };
    window.addEventListener('pointerdown', onGesture, { passive: true });
    window.addEventListener('keydown', onGesture, { passive: true });
    window.addEventListener('touchstart', onGesture, { passive: true });
  }

  isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    try {
      localStorage.setItem(MUSIC_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // Ignore storage error
    }
    this.syncMixerAndLoop();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.syncMixerAndLoop();
  }

  setState(next: Partial<MusicConfig>) {
    const modeChanged = next.mode !== undefined && next.mode !== this.config.mode;
    this.config = { ...this.config, ...next };
    if (modeChanged) {
      this.stepIndex = 0;
      const ctx = sfx.getAudioContext(false);
      if (ctx) {
        this.nextStepTime = ctx.currentTime + 0.05;
      }
    }
    this.syncMixerAndLoop();
  }

  unlock() {
    if (this.muted || !this.musicEnabled) return;
    const ctx = sfx.getAudioContext(false);
    if (!ctx) return;
    this.ensureGraph(ctx);
    this.startScheduler(ctx);
    this.updateMixTargets(ctx);
  }

  private ensureGraph(ctx: AudioContext) {
    if (this.masterGain && this.filterNode) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    filter.connect(gain);
    gain.connect(ctx.destination);

    this.filterNode = filter;
    this.masterGain = gain;

    const len = Math.floor(ctx.sampleRate * 0.14);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    this.noiseBuffer = buf;
  }

  private syncMixerAndLoop() {
    if (this.muted || !this.musicEnabled) {
      this.stopScheduler();
      const ctx = sfx.getAudioContext(true);
      if (ctx && this.masterGain) {
        this.masterGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
      }
      return;
    }

    const ctx = sfx.getAudioContext(false);
    if (!ctx) return;
    this.ensureGraph(ctx);
    this.updateMixTargets(ctx);
    if (ctx.state === 'running') {
      this.startScheduler(ctx);
    }
  }

  private updateMixTargets(ctx: AudioContext) {
    if (!this.masterGain || !this.filterNode) return;
    const now = ctx.currentTime;
    const baseGain =
      this.config.mode === 'boss'
        ? 0.24
        : this.config.mode === 'crypt'
        ? 0.2
        : 0.17;
    const targetGain = this.config.paused ? baseGain * 0.42 : baseGain;
    const targetCutoff = this.config.paused
      ? 540
      : this.config.mode === 'boss'
      ? 4200
      : 2800;

    this.masterGain.gain.setTargetAtTime(targetGain, now, 0.14);
    this.filterNode.frequency.setTargetAtTime(targetCutoff, now, 0.16);
  }

  private startScheduler(ctx: AudioContext) {
    if (this.timerId !== null || typeof window === 'undefined') return;
    this.nextStepTime = Math.max(this.nextStepTime, ctx.currentTime + 0.05);
    this.timerId = window.setInterval(() => {
      this.tickScheduler();
    }, 80);
  }

  private stopScheduler() {
    if (this.timerId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private getStepDurationSec(): number {
    const f = Math.max(1, this.config.floorNumber);
    let bpm = 76;
    if (this.config.mode === 'crypt') {
      bpm = 98 + Math.min(20, (f - 1) * 3);
    } else if (this.config.mode === 'boss') {
      bpm = 132 + Math.min(22, (f - 1) * 4);
    } else if (this.config.mode === 'victory') {
      bpm = 84;
    } else if (this.config.mode === 'gameover') {
      bpm = 64;
    }
    return 60 / bpm / 4; // 16th-note step
  }

  private tickScheduler() {
    if (this.muted || !this.musicEnabled) return;
    const ctx = sfx.getAudioContext(false);
    if (!ctx || ctx.state !== 'running') return;
    this.ensureGraph(ctx);
    this.updateMixTargets(ctx);

    const lookAhead = 0.22;
    const stepDur = this.getStepDurationSec();

    if (this.nextStepTime < ctx.currentTime - 0.5) {
      this.nextStepTime = ctx.currentTime + 0.04;
    }

    while (this.nextStepTime < ctx.currentTime + lookAhead) {
      this.scheduleStep(ctx, this.stepIndex, this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.stepIndex = (this.stepIndex + 1) % 64;
    }
  }

  private scheduleNote(
    ctx: AudioContext,
    time: number,
    midi: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    attack = 0.015,
    detune = 0
  ) {
    if (!this.filterNode || midi <= 0) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(midiToHz(midi), time);
    if (detune !== 0) osc.detune.setValueAtTime(detune, time);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(attack + 0.03, duration));

    osc.connect(gain);
    gain.connect(this.filterNode);
    osc.start(time);
    osc.stop(time + duration + 0.04);
  }

  private scheduleKick(ctx: AudioContext, time: number, volume: number) {
    if (!this.filterNode) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(118, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.14);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

    osc.connect(gain);
    gain.connect(this.filterNode);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private schedulePercHat(ctx: AudioContext, time: number, volume: number, cutoff = 3200) {
    if (!this.filterNode || !this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.filterNode);
    src.start(time);
  }

  private scheduleStep(ctx: AudioContext, step: number, time: number, stepDur: number) {
    const mode = this.config.mode;
    const floorBoost = Math.min(0.06, Math.max(0, this.config.floorNumber - 1) * 0.012);

    if (mode === 'title') {
      const bassNote = TITLE_BASS[step % TITLE_BASS.length];
      if (bassNote) {
        this.scheduleNote(ctx, time, bassNote, stepDur * 4, 'triangle', 0.2, 0.04);
      }
      if (step % 16 === 0) {
        const chord = TITLE_CHORDS[Math.floor(step / 16) % TITLE_CHORDS.length];
        for (const n of chord) {
          this.scheduleNote(ctx, time, n, stepDur * 15.5, 'sine', 0.075, 0.28);
        }
      }
      const arpNote = TITLE_ARP[step];
      if (arpNote) {
        this.scheduleNote(ctx, time, arpNote, stepDur * 2.8, 'triangle', 0.085, 0.015);
      }
      return;
    }

    if (mode === 'crypt') {
      const bassNote = CRYPT_BASS[step % CRYPT_BASS.length];
      if (bassNote) {
        this.scheduleNote(ctx, time, bassNote, stepDur * 2.2, 'sawtooth', 0.085 + floorBoost * 0.4, 0.012);
        this.scheduleNote(ctx, time, bassNote, stepDur * 2.5, 'triangle', 0.14, 0.015);
      }
      if (step % 16 === 0) {
        const chord = TITLE_CHORDS[Math.floor(step / 16) % TITLE_CHORDS.length];
        for (const n of chord) {
          this.scheduleNote(ctx, time, n, stepDur * 14, 'sine', 0.06, 0.22);
        }
      }
      const arpNote = CRYPT_ARP[step];
      if (arpNote) {
        this.scheduleNote(ctx, time, arpNote, stepDur * 2.1, 'triangle', 0.08, 0.01);
        if (this.config.floorNumber >= 3 && step % 8 === 0) {
          this.scheduleNote(ctx, time, arpNote + 12, stepDur * 1.8, 'sine', 0.04, 0.02);
        }
      }
      // Subtle heartbeat dungeon pulse
      if (step % 8 === 0) {
        this.scheduleKick(ctx, time, 0.14 + floorBoost * 0.6);
      }
      if (step % 8 === 4) {
        this.schedulePercHat(ctx, time, 0.035 + floorBoost * 0.3, 2800);
      }
      return;
    }

    if (mode === 'boss') {
      // Driving war percussion
      if (step % 4 === 0) {
        this.scheduleKick(ctx, time, 0.28);
      }
      if (step % 8 === 4) {
        this.schedulePercHat(ctx, time, 0.12, 1600);
      } else if (step % 2 === 1) {
        this.schedulePercHat(ctx, time, 0.045, 3600);
      }

      const bassNote = BOSS_BASS[step % BOSS_BASS.length];
      if (bassNote) {
        this.scheduleNote(ctx, time, bassNote, stepDur * 0.95, 'sawtooth', 0.13, 0.008);
        this.scheduleNote(ctx, time, bassNote - 12, stepDur * 1.1, 'triangle', 0.15, 0.01);
      }

      if (step % 16 === 0) {
        const chord = TITLE_CHORDS[Math.floor(step / 16) % TITLE_CHORDS.length];
        for (const n of chord) {
          this.scheduleNote(ctx, time, n, stepDur * 12, 'sawtooth', 0.032, 0.08, -6);
          this.scheduleNote(ctx, time, n, stepDur * 12, 'triangle', 0.055, 0.08, 6);
        }
      }

      const leadNote = BOSS_LEAD[step];
      if (leadNote) {
        this.scheduleNote(ctx, time, leadNote, stepDur * 1.9, 'sawtooth', 0.065, 0.01);
        this.scheduleNote(ctx, time, leadNote, stepDur * 2.1, 'triangle', 0.09, 0.012);
      }
      return;
    }

    if (mode === 'victory') {
      const victoryArp = [62, 66, 69, 74, 0, 69, 74, 78];
      if (step % 4 === 0) {
        const n = victoryArp[Math.floor(step / 4) % victoryArp.length];
        if (n) this.scheduleNote(ctx, time, n, stepDur * 3.8, 'triangle', 0.1, 0.02);
      }
      if (step % 32 === 0) {
        for (const n of [50, 54, 57]) {
          this.scheduleNote(ctx, time, n, stepDur * 28, 'sine', 0.075, 0.2);
        }
      }
      return;
    }

    // gameover
    if (step % 16 === 0) {
      const somber = step < 32 ? [50, 53, 57] : [45, 48, 52];
      for (const n of somber) {
        this.scheduleNote(ctx, time, n, stepDur * 15, 'sine', 0.07, 0.3);
      }
    }
    if (step % 8 === 0) {
      this.scheduleNote(ctx, time, step % 16 === 0 ? 62 : 60, stepDur * 6, 'triangle', 0.055, 0.04);
    }
  }
}

export const music = new MusicEngine();

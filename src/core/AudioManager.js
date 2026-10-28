/*
 * Copyright 2026 Julien Bombled
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { configRegistry } from './ConfigRegistry.js';

const CONTEXT_STATES = Object.freeze({
  RUNNING: 'running',
  SUSPENDED: 'suspended'
});

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.output = null;
    this.muted = false;
    this.reducedMotion = false;
    this.config = null;
    // Each playing oscillator mapped to the gain node it plays through, so stopAll can
    // fade the voice out instead of cutting it mid-wave.
    this.activeOscillators = new Map();
    this.lastEffectTimes = new Map();
    this.lastHapticTime = -Infinity;
    this.visibilityBound = false;
    this.clock = () => performance.now();
  }

  init(initialMuted = false, initialReducedMotion = false) {
    this.config = configRegistry.get('audio');
    this.muted = initialMuted;
    this.reducedMotion = Boolean(initialReducedMotion);
    this.bindVisibility();
  }

  bindVisibility() {
    if (this.visibilityBound || typeof document === 'undefined') {
      return;
    }
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', () => this.syncContextState());
  }

  isDocumentHidden() {
    return typeof document !== 'undefined' && document.hidden === true;
  }

  /**
   * Suspends the audio context while muted or hidden and resumes it otherwise. A context
   * only exists once a sound was requested from a user gesture, so nothing starts here.
   * A refused suspend or resume (a closed context, a browser blocking playback) leaves the
   * context as it was; the next visibility or mute change tries again.
   */
  syncContextState() {
    if (!this.ctx) {
      return;
    }
    if (this.muted || this.isDocumentHidden()) {
      if (this.ctx.state === CONTEXT_STATES.RUNNING) {
        Promise.resolve(this.ctx.suspend()).catch(() => {});
      }
    } else if (this.ctx.state === CONTEXT_STATES.SUSPENDED) {
      Promise.resolve(this.ctx.resume()).catch(() => {});
    }
  }

  setReducedMotion(reduced) {
    this.reducedMotion = Boolean(reduced);
  }

  triggerHaptic(durationMs) {
    if (this.muted || this.reducedMotion || !durationMs) {
      return;
    }
    const nowMs = this.clock();
    if (nowMs - this.lastHapticTime < this.config.hapticMinIntervalMs) {
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      this.lastHapticTime = nowMs;
      try {
        navigator.vibrate(durationMs);
      } catch {
        // Ignore haptic errors on unsupported browsers
      }
    }
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.output = this.createLimiter(this.ctx);
      }
    }
    this.syncContextState();
  }

  /**
   * Builds the master limiter every voice goes through, so stacked voices compress
   * instead of clipping at the destination.
   */
  createLimiter(ctx) {
    const lim = this.config.limiter;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(lim.thresholdDb, ctx.currentTime);
    compressor.knee.setValueAtTime(lim.kneeDb, ctx.currentTime);
    compressor.ratio.setValueAtTime(lim.ratio, ctx.currentTime);
    compressor.attack.setValueAtTime(lim.attackSec, ctx.currentTime);
    compressor.release.setValueAtTime(lim.releaseSec, ctx.currentTime);
    compressor.connect(ctx.destination);
    return compressor;
  }

  /**
   * Silences every playing voice. Each one fades to the minimum gain over stopRampSec before
   * it stops: cutting a wave mid-cycle clicks. The voice disconnects itself once it ends
   * (see playTone), so the fade is heard in full.
   */
  stopAll() {
    if (this.ctx && this.activeOscillators.size > 0) {
      const now = this.ctx.currentTime;
      const stopTime = now + this.config.stopRampSec;
      const minGain = this.config.minGain;
      for (const [osc, gain] of this.activeOscillators) {
        try {
          const param = gain.gain;
          const currentGain = Math.max(param.value, minGain);
          param.cancelScheduledValues(now);
          param.setValueAtTime(currentGain, now);
          param.exponentialRampToValueAtTime(minGain, stopTime);
          osc.stop(stopTime);
        } catch {
          // Ignore already-stopped oscillators
        }
      }
    }
    this.activeOscillators.clear();
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) {
      this.stopAll();
    }
    this.syncContextState();
  }

  isMuted() {
    return this.muted;
  }

  getActiveVoiceCount() {
    return this.activeOscillators.size;
  }

  playTone(type, startFreq, endFreq, duration, startOffset = 0, gainScale = 1.0) {
    if (this.muted || !this.config) {
      return;
    }
    this.ensureContext();
    if (!this.ctx || this.activeOscillators.size >= this.config.maxVoices) {
      return;
    }

    const startTime = this.ctx.currentTime + startOffset;
    const stopTime = startTime + duration;
    const minFreq = this.config.minFrequency;
    const minGain = this.config.minGain;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(startFreq, minFreq), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, minFreq), stopTime);

    gain.gain.setValueAtTime(this.config.masterGain * gainScale, startTime);
    gain.gain.exponentialRampToValueAtTime(minGain, stopTime);

    osc.connect(gain);
    gain.connect(this.output);

    this.activeOscillators.set(osc, gain);
    osc.onended = () => {
      this.activeOscillators.delete(osc);
      gain.disconnect();
    };

    osc.start(startTime);
    osc.stop(stopTime);
  }

  /**
   * Returns false when the same effect already played within the configured minimum
   * interval, so a burst of identical events (an anvil crushing a row) plays once.
   */
  acceptEffect(effectName) {
    const nowMs = this.clock();
    const last = this.lastEffectTimes.get(effectName);
    if (last !== undefined && nowMs - last < this.config.effectMinIntervalMs) {
      return false;
    }
    this.lastEffectTimes.set(effectName, nowMs);
    return true;
  }

  playEffect(effectName, comboIndex = 0) {
    if (this.muted || !this.config) {
      return;
    }
    const fx = this.config.effects[effectName];
    if (!fx || !this.acceptEffect(effectName)) {
      return;
    }
    this.triggerHaptic(fx.hapticMs);

    if (effectName === 'match') {
      const freq = fx.baseFreq + comboIndex * fx.pitchStep;
      const endFreq = freq * fx.endFreqMultiplier;
      this.playTone(fx.type, freq, endFreq, fx.duration);
      if (fx.harmonic) {
        this.playTone(
          this.config.arpeggioWaveType,
          freq * this.config.harmonicRatio,
          endFreq * this.config.harmonicRatio,
          fx.duration,
          0,
          this.config.harmonicGainRatio
        );
      }
      return;
    }

    if (Array.isArray(fx.notes)) {
      if (effectName === 'victory' || effectName === 'gameOver') {
        this.stopAll();
      }
      const waveType = this.config.arpeggioWaveType;
      const stepRatio = this.config.arpeggioStepRatio;
      fx.notes.forEach((note, index) => {
        const offset = index * fx.noteDuration * stepRatio;
        this.playTone(waveType, note, note, fx.noteDuration, offset);
      });
      return;
    }

    this.playTone(fx.type, fx.startFreq, fx.endFreq, fx.duration);
    if (fx.harmonic) {
      this.playTone(
        this.config.arpeggioWaveType,
        fx.startFreq * this.config.harmonicRatio,
        fx.endFreq * this.config.harmonicRatio,
        fx.duration,
        0,
        this.config.harmonicGainRatio
      );
    }
  }
}

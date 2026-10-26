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

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.reducedMotion = false;
    this.config = null;
    this.activeOscillators = new Set();
  }

  init(initialMuted = false, initialReducedMotion = false) {
    this.config = configRegistry.get('audio');
    this.muted = initialMuted;
    this.reducedMotion = Boolean(initialReducedMotion);
  }

  setReducedMotion(reduced) {
    this.reducedMotion = Boolean(reduced);
  }

  triggerHaptic(durationMs) {
    if (this.muted || this.reducedMotion || !durationMs) {
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
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
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  stopAll() {
    for (const osc of this.activeOscillators) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // Ignore already-stopped oscillators
      }
    }
    this.activeOscillators.clear();
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) {
      this.stopAll();
    }
  }

  isMuted() {
    return this.muted;
  }

  playTone(type, startFreq, endFreq, duration, startOffset = 0, gainScale = 1.0) {
    if (this.muted || !this.config) {
      return;
    }
    this.ensureContext();
    if (!this.ctx) {
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
    gain.connect(this.ctx.destination);

    this.activeOscillators.add(osc);
    osc.onended = () => {
      this.activeOscillators.delete(osc);
      gain.disconnect();
    };

    osc.start(startTime);
    osc.stop(stopTime);
  }

  playEffect(effectName, comboIndex = 0) {
    if (this.muted || !this.config) {
      return;
    }
    const fx = this.config.effects[effectName];
    if (!fx) {
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

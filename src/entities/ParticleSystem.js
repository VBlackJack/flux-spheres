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

import { MATH_CONSTANTS } from '../core/Constants.js';

export class ParticleSystem {
  constructor(juiceConfig) {
    this.juiceConfig = juiceConfig;
    this.cfg = juiceConfig.particles;
    this.particles = [];
    this.trailParticles = [];
    this.shockwaves = [];
    this.floatingTexts = [];
    this.lightningBolts = [];
    this.particlePool = [];
    this.trailPool = [];
    this.shockwavePool = [];
    this.textPool = [];
    this.shakeIntensity = 0;
    this.reducedMotion = false;
  }

  setReducedMotion(enabled) {
    this.reducedMotion = Boolean(enabled);
    if (this.reducedMotion) {
      this.shakeIntensity = 0;
    }
  }

  clear() {
    while (this.particles.length > 0) {
      this.particlePool.push(this.particles.pop());
    }
    while (this.trailParticles.length > 0) {
      this.trailPool.push(this.trailParticles.pop());
    }
    while (this.shockwaves.length > 0) {
      this.shockwavePool.push(this.shockwaves.pop());
    }
    while (this.floatingTexts.length > 0) {
      this.textPool.push(this.floatingTexts.pop());
    }
    this.lightningBolts.length = 0;
    this.shakeIntensity = 0;
  }

  removeAt(list, index, pool = null) {
    const removed = list[index];
    const lastIndex = list.length - 1;
    if (index !== lastIndex) {
      list[index] = list[lastIndex];
    }
    list.pop();
    if (pool && removed) {
      pool.push(removed);
    }
  }

  addScreenShake(amount, maxOffset = this.juiceConfig.maxShakeOffset) {
    if (this.reducedMotion) {
      return;
    }
    this.shakeIntensity = Math.min(maxOffset, this.shakeIntensity + amount);
  }

  spawnTrail(x, y, radius, color) {
    const cfg = this.cfg;
    const item = this.trailPool.pop() || {};
    item.x = x + (Math.random() - MATH_CONSTANTS.HALF) * cfg.trailSpread;
    item.y = y + (Math.random() - MATH_CONSTANTS.HALF) * cfg.trailSpread;
    item.radius = radius * cfg.trailRadiusFactor;
    item.color = color;
    item.alpha = cfg.trailInitialAlpha;
    this.trailParticles.push(item);
  }

  spawnBurst(x, y, color, count = this.cfg.burstDefaultCount, speed = this.cfg.burstDefaultSpeed) {
    const cfg = this.cfg;
    for (let i = 0; i < count; i++) {
      const angle = (MATH_CONSTANTS.TWO_PI * i) / count + (Math.random() - MATH_CONSTANTS.HALF) * cfg.burstAngleJitter;
      const mag = (cfg.burstSpeedMinFactor + Math.random() * cfg.burstSpeedRangeFactor) * speed;
      const item = this.particlePool.pop() || {};
      item.x = x;
      item.y = y;
      item.vx = Math.cos(angle) * mag;
      item.vy = Math.sin(angle) * mag;
      item.radius = cfg.burstMinRadius + Math.random() * cfg.burstRadiusRange;
      item.color = color;
      item.alpha = 1;
      item.decay = cfg.burstBaseDecay + Math.random() * cfg.burstDecayRange;
      this.particles.push(item);
    }
  }

  spawnShockwave(x, y, color, maxRadius = this.cfg.shockwaveDefaultMaxRadius) {
    const cfg = this.cfg;
    const item = this.shockwavePool.pop() || {};
    item.x = x;
    item.y = y;
    item.radius = cfg.shockwaveInitialRadius;
    item.maxRadius = maxRadius;
    item.color = color;
    item.alpha = cfg.shockwaveInitialAlpha;
    this.shockwaves.push(item);
  }

  spawnLightning(y, leftX, rightX, color) {
    const cfg = this.cfg;
    const segments = [];
    const branches = [];
    const steps = cfg.lightningSteps;
    const stepX = (rightX - leftX) / steps;
    for (let i = 0; i <= steps; i++) {
      segments.push({
        x: leftX + i * stepX,
        y: y + (i === 0 || i === steps ? 0 : (Math.random() - MATH_CONSTANTS.HALF) * cfg.lightningJitterY)
      });
    }
    const branchCount = cfg.lightningBranches;
    const branchLen = cfg.lightningBranchLength;
    const minPad = cfg.lightningBranchMinPad;
    const endPad = cfg.lightningBranchEndPad;
    for (let b = 0; b < branchCount; b++) {
      const idx = minPad + Math.floor(Math.random() * Math.max(1, steps - endPad));
      const root = segments[idx];
      if (root) {
        const dirY = b % 2 === 0 ? 1 : -1;
        branches.push([
          { x: root.x, y: root.y },
          {
            x: root.x + stepX * cfg.lightningBranchMidStepFactor,
            y: root.y + dirY * branchLen * cfg.lightningBranchMidLenFactor
          },
          {
            x: root.x + stepX * cfg.lightningBranchEndStepFactor,
            y: root.y + dirY * branchLen
          }
        ]);
      }
    }
    this.lightningBolts.push({
      segments,
      branches,
      color,
      alpha: 1.0
    });
  }

  spawnFloatingText(x, y, text, color = this.cfg.floatingTextDefaultColor) {
    const item = this.textPool.pop() || {};
    item.x = x;
    item.y = y;
    item.text = text;
    item.color = color;
    item.vy = this.cfg.floatingTextVy;
    item.alpha = 1.0;
    this.floatingTexts.push(item);
  }

  update(shakeDecay = this.juiceConfig.shakeDecay) {
    const cfg = this.cfg;
    if (this.shakeIntensity > MATH_CONSTANTS.EPSILON) {
      this.shakeIntensity *= shakeDecay;
      if (this.shakeIntensity < cfg.shakeStopThreshold) {
        this.shakeIntensity = 0;
      }
    } else {
      this.shakeIntensity = 0;
    }

    for (let i = this.trailParticles.length - 1; i >= 0; i--) {
      const tp = this.trailParticles[i];
      tp.radius *= cfg.trailRadiusDecay;
      tp.alpha -= cfg.trailAlphaDecay;
      if (tp.alpha <= 0 || tp.radius < cfg.trailMinRadius) {
        this.removeAt(this.trailParticles, i, this.trailPool);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += cfg.burstGravity;
      p.vx *= cfg.burstDrag;
      p.alpha -= p.decay;
      if (p.alpha <= 0) {
        this.removeAt(this.particles, i, this.particlePool);
      }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += (sw.maxRadius - sw.radius) * cfg.shockwaveExpandRate;
      sw.alpha -= cfg.shockwaveAlphaDecay;
      if (sw.alpha <= 0) {
        this.removeAt(this.shockwaves, i, this.shockwavePool);
      }
    }

    for (let i = this.lightningBolts.length - 1; i >= 0; i--) {
      const bolt = this.lightningBolts[i];
      bolt.alpha -= cfg.lightningAlphaDecay;
      if (bolt.alpha <= 0) {
        this.removeAt(this.lightningBolts, i);
      }
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy;
      ft.alpha -= cfg.floatingTextAlphaDecay;
      if (ft.alpha <= 0) {
        this.removeAt(this.floatingTexts, i, this.textPool);
      }
    }
  }
}

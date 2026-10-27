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
    this.streaks = [];
    // Surface of the liquid at the bottom of the board: one height and speed per column.
    this.liquidHeights = new Array(this.cfg.liquidColumns).fill(0);
    this.liquidVelocities = new Array(this.cfg.liquidColumns).fill(0);
    // Cracks left by shots bouncing off the side walls; they last for the whole run.
    this.wallCracks = [];
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
      this.clearDecorativeEffects();
    }
  }

  /** Drops every effect except the floating texts, which carry information. */
  clearDecorativeEffects() {
    while (this.particles.length > 0) {
      this.particlePool.push(this.particles.pop());
    }
    while (this.trailParticles.length > 0) {
      this.trailPool.push(this.trailParticles.pop());
    }
    while (this.shockwaves.length > 0) {
      this.shockwavePool.push(this.shockwaves.pop());
    }
    this.lightningBolts.length = 0;
    this.streaks.length = 0;
    this.shakeIntensity = 0;
  }

  clear() {
    this.clearDecorativeEffects();
    this.wallCracks.length = 0;
    this.liquidHeights.fill(0);
    this.liquidVelocities.fill(0);
    while (this.floatingTexts.length > 0) {
      this.textPool.push(this.floatingTexts.pop());
    }
  }

  /** Springs every column back to rest and lets its ripple spread to its neighbors. */
  updateLiquid() {
    const cfg = this.cfg;
    const heights = this.liquidHeights;
    const velocities = this.liquidVelocities;
    for (let i = 0; i < heights.length; i++) {
      velocities[i] += -cfg.liquidTension * heights[i] - cfg.liquidDampening * velocities[i];
      heights[i] += velocities[i];
    }
    for (let i = 0; i < heights.length; i++) {
      if (i > 0) {
        velocities[i - 1] += cfg.liquidSpread * (heights[i] - heights[i - 1]) * MATH_CONSTANTS.HALF;
      }
      if (i < heights.length - 1) {
        velocities[i + 1] += cfg.liquidSpread * (heights[i] - heights[i + 1]) * MATH_CONSTANTS.HALF;
      }
    }
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

  // Reduced motion keeps floating texts, which carry information, and drops the purely
  // decorative effects: trails, bursts, shockwaves, lightning flashes and screen shake.

  spawnTrail(x, y, radius, color) {
    if (this.reducedMotion) {
      return;
    }
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
    if (this.reducedMotion) {
      return;
    }
    const cfg = this.cfg;
    for (let i = 0; i < count; i++) {
      const angle = (MATH_CONSTANTS.TWO_PI * i) / count + (Math.random() - MATH_CONSTANTS.HALF) * cfg.burstAngleJitter;
      const mag = (cfg.burstSpeedMinFactor + Math.random() * cfg.burstSpeedRangeFactor) * speed;
      const item = this.particlePool.pop() || {};
      item.x = x;
      item.y = y;
      item.prevX = x;
      item.prevY = y;
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
    if (this.reducedMotion) {
      return;
    }
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
    if (this.reducedMotion) {
      return;
    }
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

  /**
   * A sphere falling into the liquid makes a ripple where it lands.
   * @param {number} xFraction - Landing position across the board, from 0 to 1.
   * @param {number} speed - Falling speed; faster spheres splash harder.
   */
  splashLiquid(xFraction, speed) {
    if (this.reducedMotion) {
      return;
    }
    const cfg = this.cfg;
    const column = Math.min(cfg.liquidColumns - 1, Math.max(0, Math.floor(xFraction * cfg.liquidColumns)));
    this.liquidVelocities[column] += Math.min(cfg.liquidMaxSplash, Math.abs(speed) * cfg.liquidSplashScale);
  }

  /**
   * A shot bouncing off a side wall leaves a crack there, up to a fixed number per run.
   * @param {number} x - Wall x where the shot bounced.
   * @param {number} y - Height of the bounce.
   * @param {number} direction - 1 when the crack grows rightward (left wall), -1 otherwise.
   */
  addWallCrack(x, y, direction) {
    const cfg = this.cfg;
    if (this.wallCracks.length >= cfg.wallCrackMaxCount) {
      return;
    }
    const points = [{ x, y }];
    for (let i = 1; i <= cfg.wallCrackSegments; i++) {
      points.push({
        x: x + direction * (cfg.wallCrackLength * i) / cfg.wallCrackSegments,
        y: y + (Math.random() - MATH_CONSTANTS.HALF) * cfg.wallCrackJitter
      });
    }
    this.wallCracks.push(points);
  }

  /** A curved rocket trail from a launch point to its target. */
  spawnStreak(x1, y1, x2, y2, color) {
    if (this.reducedMotion) {
      return;
    }
    this.streaks.push({ x1, y1, x2, y2, color, alpha: 1.0 });
  }

  spawnFloatingText(x, y, text, color = this.cfg.floatingTextDefaultColor) {
    const item = this.textPool.pop() || {};
    item.x = x;
    item.y = y;
    item.prevY = y;
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
      p.prevX = p.x;
      p.prevY = p.y;
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

    this.updateLiquid();

    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const streak = this.streaks[i];
      streak.alpha -= cfg.streakAlphaDecay;
      if (streak.alpha <= 0) {
        this.removeAt(this.streaks, i);
      }
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.prevY = ft.y;
      ft.y += ft.vy;
      ft.alpha -= cfg.floatingTextAlphaDecay;
      if (ft.alpha <= 0) {
        this.removeAt(this.floatingTexts, i, this.textPool);
      }
    }
  }
}

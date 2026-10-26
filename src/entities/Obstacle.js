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

import { OBSTACLE_TYPES } from '../core/Constants.js';

/**
 * Resolves an obstacle tunable through the configuration layers, most specific first:
 * the level definition, then the obstacle type spec, then the shared defaults.
 * A value of 0 (or any other defined value) at a higher layer is honored as-is.
 * @param {object} def - Level obstacle definition.
 * @param {string} defKey - Key looked up in the level definition.
 * @param {object} typeSpec - Obstacle type configuration.
 * @param {object} defaults - Shared obstacle defaults configuration.
 * @param {string} specKey - Key looked up in the type spec and the defaults.
 * @returns {*} The resolved value.
 */
const resolveTunable = (def, defKey, typeSpec, defaults, specKey) => {
  if (defKey !== null && def[defKey] !== undefined) {
    return def[defKey];
  }
  if (typeSpec[specKey] !== undefined) {
    return typeSpec[specKey];
  }
  if (defaults[specKey] === undefined) {
    throw new Error(`Missing obstacles.defaults.${specKey}`);
  }
  return defaults[specKey];
};

export class Obstacle {
  constructor(def, obstaclesConfig) {
    this.type = def.type;
    const defaults = obstaclesConfig.defaults;
    const typeSpec = obstaclesConfig.types[this.type] || {};
    const fromDef = (key) => resolveTunable(def, key, typeSpec, defaults, key);
    const fromSpec = (key) => resolveTunable(def, null, typeSpec, defaults, key);

    this.baseX = def.x;
    this.baseY = def.y;
    this.x = def.x;
    this.y = def.y;
    this.prevX = def.x;
    this.prevY = def.y;
    this.radius = fromDef('radius');
    this.width = fromDef('width');
    this.height = fromDef('height');
    this.angle = 0;
    this.prevAngle = 0;
    this.disabled = false;
    this.pairId = def.pairId !== undefined ? def.pairId : null;
    this.motorAngularSpeed = resolveTunable(def, 'angularSpeed', typeSpec, defaults, 'defaultAngularSpeed');
    this.angularVelocity = this.motorAngularSpeed;
    this.spinSpeed = fromSpec('spinSpeed');
    this.oscillateRangeX = fromDef('oscillateRangeX');
    this.oscillateRangeY = fromDef('oscillateRangeY');
    this.oscillateSpeed = fromDef('oscillateSpeed');
    this.oscillatePhase = 0;
    this.fieldRadius = fromDef('fieldRadius');
    this.force = fromDef('force');
    this.captureRadius = fromDef('captureRadius');
    this.pullRadius = fromDef('pullRadius');
    this.pullForce = fromDef('pullForce');
    this.projectilePullForce = fromDef('projectilePullForce');
    this.scoreMultiplier = fromSpec('scoreMultiplier');
    this.bonusOvercharge = fromSpec('bonusOvercharge');
    this.restitution = fromSpec('restitution');
    this.speedBoostMultiplier = fromSpec('speedBoostMultiplier');
    this.exitOffsetFactor = fromSpec('exitOffsetFactor');
    this.teleportCooldownSteps = fromSpec('teleportCooldownSteps');
    this.triggerRadiusFactor = fromSpec('triggerRadiusFactor');
    this.hitPulse = 0;
    this.hitPulsePeak = defaults.hitPulsePeak;
    this.hitPulseDecay = defaults.hitPulseDecay;
  }

  /**
   * Starts the visual hit pulse at its configured peak intensity.
   */
  triggerHitPulse() {
    this.hitPulse = this.hitPulsePeak;
  }

  /**
   * Copies every field mutated by update() and applyTorque() from another obstacle,
   * so a prediction proxy can be advanced without touching the source obstacle.
   * @param {Obstacle} source - Obstacle whose motion state is copied.
   */
  syncMotionStateFrom(source) {
    this.x = source.x;
    this.y = source.y;
    this.prevX = source.prevX;
    this.prevY = source.prevY;
    this.angle = source.angle;
    this.prevAngle = source.prevAngle;
    this.angularVelocity = source.angularVelocity;
    this.oscillatePhase = source.oscillatePhase;
    this.hitPulse = source.hitPulse;
  }

  applyTorque(torque, maxSpeed) {
    if (this.type !== OBSTACLE_TYPES.PIVOT || this.disabled) {
      return;
    }
    this.angularVelocity = Math.max(-maxSpeed, Math.min(maxSpeed, this.angularVelocity + torque));
  }

  update(damping) {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevAngle = this.angle;

    if (this.hitPulse > 0) {
      this.hitPulse = Math.max(0, this.hitPulse - this.hitPulseDecay);
    }
    if (this.disabled) {
      return;
    }

    if (this.type === OBSTACLE_TYPES.PIVOT) {
      this.angularVelocity = this.angularVelocity * damping + this.motorAngularSpeed * (1 - damping);
      this.angle += this.angularVelocity;
    } else if (this.type === OBSTACLE_TYPES.PORTAL || this.type === OBSTACLE_TYPES.SINGULARITY) {
      this.angle += this.spinSpeed;
    }
    if (this.type === OBSTACLE_TYPES.BARRIER && (this.oscillateRangeX > 0 || this.oscillateRangeY > 0)) {
      this.oscillatePhase += this.oscillateSpeed;
      const sinPhase = Math.sin(this.oscillatePhase);
      if (this.oscillateRangeX > 0) {
        this.x = this.baseX + sinPhase * this.oscillateRangeX;
      }
      if (this.oscillateRangeY > 0) {
        this.y = this.baseY + sinPhase * this.oscillateRangeY;
      }
    }
  }
}

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

export class Obstacle {
  constructor(def, obstaclesConfig) {
    this.type = def.type;
    const defaults = obstaclesConfig.defaults;
    const typeSpec = obstaclesConfig.types[this.type] || {};
    this.baseX = def.x;
    this.baseY = def.y;
    this.x = def.x;
    this.y = def.y;
    this.prevX = def.x;
    this.prevY = def.y;
    this.radius = def.radius || typeSpec.radius || defaults.radius;
    this.width = def.width || defaults.width;
    this.height = def.height || typeSpec.height || defaults.height;
    this.angle = 0;
    this.prevAngle = 0;
    this.disabled = false;
    this.pairId = def.pairId || null;
    this.motorAngularSpeed = def.angularSpeed !== undefined ? def.angularSpeed : (typeSpec.defaultAngularSpeed || 0);
    this.angularVelocity = this.motorAngularSpeed;
    this.spinSpeed = typeSpec.spinSpeed || 0;
    this.oscillateRangeX = def.oscillateRangeX || 0;
    this.oscillateRangeY = def.oscillateRangeY || 0;
    this.oscillateSpeed = def.oscillateSpeed || 0;
    this.oscillatePhase = 0;
    this.fieldRadius = def.fieldRadius || typeSpec.fieldRadius || 0;
    this.force = def.force !== undefined ? def.force : (typeSpec.force || 0);
    this.captureRadius = def.captureRadius || typeSpec.captureRadius || this.radius;
    this.pullRadius = def.pullRadius || typeSpec.pullRadius || 0;
    this.pullForce = def.pullForce || typeSpec.pullForce || 0;
    this.projectilePullForce = def.projectilePullForce !== undefined
      ? def.projectilePullForce
      : (typeSpec.projectilePullForce || 0);
    this.scoreMultiplier = typeSpec.scoreMultiplier || 1.0;
    this.bonusOvercharge = typeSpec.bonusOvercharge || 0;
    this.restitution = typeSpec.restitution || defaults.restitution;
    this.speedBoostMultiplier = typeSpec.speedBoostMultiplier || 1.0;
    this.exitOffsetFactor = typeSpec.exitOffsetFactor || 1.0;
    this.teleportCooldownSteps = typeSpec.teleportCooldownSteps || 0;
    this.hitPulse = 0;
    this.hitPulseDecay = defaults.hitPulseDecay;
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

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

import { SPECIAL_TYPES } from '../core/Constants.js';
import { t } from '../core/I18n.js';

export class SpecialBallController {
  constructor(ballsConfig, gameConfig) {
    this.ballsConfig = ballsConfig;
    this.gameConfig = gameConfig;
  }

  resolveSpecialImpact(ball, physicsWorld, particleSystem, audioManager, radiusMultiplier = 1.0, destroyBallFn = null) {
    const specialType = ball.specialType;
    const specs = this.ballsConfig.specialTypes[specialType];
    if (!specs) {
      return { destroyed: [], scoreDelta: 0, freezeTurns: 0 };
    }

    if (specialType === SPECIAL_TYPES.BOMB) {
      return this.triggerBomb(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier, destroyBallFn);
    }
    if (specialType === SPECIAL_TYPES.LIGHTNING) {
      return this.triggerLightning(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier, destroyBallFn);
    }
    if (specialType === SPECIAL_TYPES.RAINBOW) {
      return this.triggerRainbow(ball, specs, physicsWorld, particleSystem, audioManager, destroyBallFn);
    }
    if (specialType === SPECIAL_TYPES.FREEZE) {
      return this.triggerFreeze(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier);
    }

    return { destroyed: [], scoreDelta: 0, freezeTurns: 0 };
  }

  triggerBomb(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier = 1.0, destroyBallFn = null) {
    const blastRadius = ball.radius * specs.blastRadiusFactor * radiusMultiplier;
    const shockwaveOuterRadius = blastRadius * specs.shockwaveRadiusMultiplier;
    const targetsInBlast = [];

    if (physicsWorld.ballMap.has(ball.id)) {
      physicsWorld.removeBall(ball);
    }

    for (const target of [...physicsWorld.balls]) {
      const dx = target.x - ball.x;
      const dy = target.y - ball.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= blastRadius) {
        targetsInBlast.push(target);
      } else if (dist <= shockwaveOuterRadius && !target.isAnchor && dist > 0) {
        const push = ((shockwaveOuterRadius - dist) / shockwaveOuterRadius) * specs.shockwaveForce;
        target.vx += (dx / dist) * push;
        target.vy += (dy / dist) * push;
      }
    }

    const destroyed = [];
    for (const target of targetsInBlast) {
      if (destroyBallFn) {
        if (destroyBallFn(target, specs.highlight, true, specs.burstCount, specs.burstSpeed)) {
          destroyed.push(target);
        }
      } else {
        particleSystem.spawnBurst(target.x, target.y, specs.highlight, specs.burstCount, specs.burstSpeed);
        physicsWorld.removeBall(target);
        destroyed.push(target);
      }
    }

    particleSystem.spawnShockwave(ball.x, ball.y, specs.highlight, blastRadius * specs.visualShockwaveFactor);
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.special.bomb'),
      specs.highlight
    );
    particleSystem.addScreenShake(this.gameConfig.juice.bombShake, this.gameConfig.juice.maxShakeOffset);
    audioManager.playEffect('bomb');

    return {
      destroyed,
      scoreDelta: destroyed.length * specs.pointsPerBall,
      freezeTurns: 0
    };
  }

  triggerLightning(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier = 1.0, destroyBallFn = null) {
    const bandHalf = ball.radius * specs.bandHalfHeightFactor * radiusMultiplier;
    const targetsInBand = [];

    if (physicsWorld.ballMap.has(ball.id)) {
      physicsWorld.removeBall(ball);
    }

    for (const target of [...physicsWorld.balls]) {
      if (Math.abs(target.y - ball.y) <= bandHalf) {
        targetsInBand.push(target);
      }
    }

    const destroyed = [];
    for (const target of targetsInBand) {
      if (destroyBallFn) {
        if (destroyBallFn(target, specs.highlight, true, specs.burstCount, specs.burstSpeed)) {
          destroyed.push(target);
        }
      } else {
        particleSystem.spawnBurst(target.x, target.y, specs.highlight, specs.burstCount, specs.burstSpeed);
        physicsWorld.removeBall(target);
        destroyed.push(target);
      }
    }

    const leftX = this.gameConfig.canvas.wallMargin;
    const rightX = this.gameConfig.canvas.logicalWidth - this.gameConfig.canvas.wallMargin;
    particleSystem.spawnLightning(ball.y, leftX, rightX, specs.highlight);
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.special.lightning'),
      specs.highlight
    );
    particleSystem.addScreenShake(this.gameConfig.juice.anvilShake, this.gameConfig.juice.maxShakeOffset);
    audioManager.playEffect('lightning');

    return {
      destroyed,
      scoreDelta: destroyed.length * specs.pointsPerBall,
      freezeTurns: 0
    };
  }

  triggerRainbow(ball, specs, physicsWorld, particleSystem, audioManager, destroyBallFn = null) {
    const matchedIds = new Set([ball.id]);
    const candidateNeighbors = [];
    const neighborRadius = ball.radius * specs.neighborRadiusFactor;

    for (const neighborId of ball.bonds) {
      const neighbor = physicsWorld.ballMap.get(neighborId);
      if (neighbor && neighbor.colorId) {
        candidateNeighbors.push(neighbor);
      }
    }

    for (const other of physicsWorld.balls) {
      if (other.id !== ball.id && other.colorId && !matchedIds.has(other.id)) {
        if (Math.hypot(other.x - ball.x, other.y - ball.y) <= neighborRadius) {
          candidateNeighbors.push(other);
        }
      }
    }

    const targetsToProcess = [];
    for (const neighbor of candidateNeighbors) {
      const cluster = physicsWorld.findColorCluster(neighbor);
      for (const member of cluster) {
        if (!matchedIds.has(member.id)) {
          matchedIds.add(member.id);
          targetsToProcess.push(member);
        }
      }
    }

    if (physicsWorld.ballMap.has(ball.id)) {
      particleSystem.spawnBurst(ball.x, ball.y, specs.highlight, specs.burstCount, specs.burstSpeed);
      physicsWorld.removeBall(ball);
    }

    const destroyed = [ball];
    for (const target of targetsToProcess) {
      if (destroyBallFn) {
        if (destroyBallFn(target, specs.highlight, false, specs.burstCount, specs.burstSpeed)) {
          destroyed.push(target);
        }
      } else {
        particleSystem.spawnBurst(target.x, target.y, specs.highlight, specs.burstCount, specs.burstSpeed);
        physicsWorld.removeBall(target);
        destroyed.push(target);
      }
    }

    particleSystem.spawnShockwave(ball.x, ball.y, specs.fill, ball.radius * specs.visualShockwaveFactor);
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.special.rainbow'),
      specs.highlight
    );
    particleSystem.addScreenShake(this.gameConfig.juice.matchShake, this.gameConfig.juice.maxShakeOffset);
    audioManager.playEffect('match', specs.matchAudioCombo);

    return {
      destroyed,
      scoreDelta: destroyed.length * specs.pointsPerBall,
      freezeTurns: 0
    };
  }

  triggerFreeze(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier = 1.0) {
    const freezeRadius = ball.radius * specs.freezeRadiusFactor * radiusMultiplier;

    for (const target of physicsWorld.balls) {
      const dist = Math.hypot(target.x - ball.x, target.y - ball.y);
      if (dist <= freezeRadius) {
        target.isFrozen = true;
        target.vx *= specs.velocityDampingFactor;
        target.vy *= specs.velocityDampingFactor;
      }
    }

    physicsWorld.removeBall(ball);
    particleSystem.spawnShockwave(ball.x, ball.y, specs.highlight, freezeRadius);
    particleSystem.spawnBurst(ball.x, ball.y, specs.highlight, specs.burstCount, specs.burstSpeed);
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.special.freeze'),
      specs.highlight
    );
    audioManager.playEffect('freeze');

    return {
      destroyed: [ball],
      scoreDelta: specs.pointsPerBall * specs.scoreMultiplier,
      freezeTurns: this.gameConfig.endless.freezeTurnsDuration
    };
  }
}

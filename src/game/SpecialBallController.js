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

import { SPECIAL_TYPES, CLUSTER_MODIFIERS } from '../core/Constants.js';
import { t } from '../core/I18n.js';

export class SpecialBallController {
  constructor(ballsConfig, gameConfig) {
    this.ballsConfig = ballsConfig;
    this.gameConfig = gameConfig;
  }

  resolveSpecialImpact(ball, physicsWorld, particleSystem, audioManager, radiusMultiplier, destroyBallFn) {
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
    if (specialType === SPECIAL_TYPES.ROCKET) {
      return this.triggerRocket(ball, specs, physicsWorld, particleSystem, audioManager, destroyBallFn);
    }

    return { destroyed: [], scoreDelta: 0, freezeTurns: 0 };
  }

  triggerBomb(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier, destroyBallFn) {
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
      if (destroyBallFn(target, specs.highlight, true, specs.burstCount, specs.burstSpeed)) {
        destroyed.push(target);
      }
    }
    this.breakChainsInBlast(ball.x, ball.y, shockwaveOuterRadius, physicsWorld, particleSystem);

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

  /**
   * A Rocket shot fires a salvo at the hardest targets on the board: special spheres
   * first (modifiers, then anchors), nearest first within each rank. Each rocket hits like
   * a blast: armor breaks, and a Boss Core loses one shield.
   */
  triggerRocket(ball, specs, physicsWorld, particleSystem, audioManager, destroyBallFn) {
    if (physicsWorld.ballMap.has(ball.id)) {
      physicsWorld.removeBall(ball);
    }
    const rank = (target) => (target.clusterModifier ? 0 : target.isAnchor ? 1 : 2);
    const distance = (target) => Math.hypot(target.x - ball.x, target.y - ball.y);
    const targets = [...physicsWorld.balls]
      .sort((a, b) => rank(a) - rank(b) || distance(a) - distance(b))
      .slice(0, specs.rocketCount);
    const destroyed = [];
    for (const target of targets) {
      particleSystem.spawnStreak(ball.x, ball.y, target.x, target.y, specs.highlight);
      if (destroyBallFn(target, specs.highlight, true, specs.burstCount, specs.burstSpeed)) {
        destroyed.push(target);
      }
    }
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.special.rocket'),
      specs.highlight
    );
    particleSystem.addScreenShake(this.gameConfig.juice.bombShake, this.gameConfig.juice.maxShakeOffset);
    audioManager.playEffect('bomb');
    return { destroyed, scoreDelta: destroyed.length * specs.pointsPerBall, freezeTurns: 0 };
  }

  /**
   * An explosion is the only thing that breaks chains without destroying the ball: every
   * chained ball that survives inside the blast loses its chains.
   */
  breakChainsInBlast(x, y, radius, physicsWorld, particleSystem) {
    const chainSpec = this.ballsConfig.clusterModifiers.chained;
    for (const target of physicsWorld.balls) {
      if (target.clusterModifier === CLUSTER_MODIFIERS.CHAINED && Math.hypot(target.x - x, target.y - y) <= radius) {
        target.clusterModifier = null;
        particleSystem.spawnBurst(target.x, target.y, chainSpec.linkColor, chainSpec.breakBurstCount, chainSpec.breakBurstSpeed);
      }
    }
  }

  /**
   * Repaints the colored balls around a Paint Core in the core's color. Nothing is
   * destroyed: the repainted balls are queued for the delayed chain check, so the new
   * groups they form go off on their own a moment later.
   * @returns {{painted: Array, scoreDelta: number}}
   */
  triggerPaint(ball, specs, physicsWorld, particleSystem, audioManager) {
    const paintRadius = ball.radius * specs.paintRadiusFactor;
    const color = ball.colorId;
    const painted = [];
    if (color) {
      for (const target of physicsWorld.balls) {
        const isRust = target.clusterModifier === CLUSTER_MODIFIERS.RUST;
        if (target.id === ball.id || (!target.colorId && !isRust) || target.specialType || target.colorId === color) {
          continue;
        }
        if (Math.hypot(target.x - ball.x, target.y - ball.y) <= paintRadius) {
          if (isRust) {
            // Paint scrubs rust off: the sphere comes back as a plain colored one.
            target.clusterModifier = null;
          }
          target.colorId = color;
          physicsWorld.pendingChainCandidateIds.add(target.id);
          painted.push(target);
        }
      }
    }
    particleSystem.spawnShockwave(ball.x, ball.y, specs.highlight, paintRadius);
    particleSystem.spawnBurst(ball.x, ball.y, specs.highlight, specs.burstCount, specs.burstSpeed);
    particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.core.paint', { count: painted.length }),
      specs.highlight
    );
    audioManager.playEffect('snap');
    return { painted, scoreDelta: painted.length * specs.pointsPerBall };
  }

  triggerLightning(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier, destroyBallFn) {
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
      if (destroyBallFn(target, specs.highlight, true, specs.burstCount, specs.burstSpeed)) {
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

  triggerRainbow(ball, specs, physicsWorld, particleSystem, audioManager, destroyBallFn) {
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

    const destroyed = [];
    for (const target of targetsToProcess) {
      if (destroyBallFn(target, specs.highlight, false, specs.burstCount, specs.burstSpeed)) {
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

  triggerFreeze(ball, specs, physicsWorld, particleSystem, audioManager, radiusMultiplier) {
    const freezeRadius = ball.radius * specs.freezeRadiusFactor * radiusMultiplier;
    let frozenCount = 0;

    for (const target of physicsWorld.balls) {
      if (target.id === ball.id) {
        continue;
      }
      const dist = Math.hypot(target.x - ball.x, target.y - ball.y);
      if (dist <= freezeRadius) {
        frozenCount++;
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
      destroyed: [],
      scoreDelta: frozenCount > 0 ? specs.pointsPerBall * specs.scoreMultiplier : 0,
      freezeTurns: specs.freezeTurns
    };
  }
}

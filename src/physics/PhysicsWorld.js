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

import { OBSTACLE_TYPES, SPECIAL_TYPES, MATH_CONSTANTS } from '../core/Constants.js';

export class PhysicsWorld {
  constructor(physicsConfig, gameConfig, ballsConfig) {
    this.physicsConfig = physicsConfig;
    this.gameConfig = gameConfig;
    this.ballsConfig = ballsConfig;
    this.polarityMap = new Map();
    for (const c of ballsConfig.standardColors) {
      this.polarityMap.set(c.id, c.polarity || 0);
    }
    this.balls = [];
    this.droppingBalls = [];
    this.obstacles = [];
    this.projectile = null;
    this.ballMap = new Map();
    this.pendingChainCandidateIds = new Set();
  }

  getMagneticMultiplier(colorA, colorB) {
    const mag = this.physicsConfig.magnetism;
    if (!colorA || !colorB) {
      return 1.0;
    }
    if (colorA === colorB) {
      return mag.sameColorAttractionMultiplier;
    }
    const polA = this.polarityMap.get(colorA) || 0;
    const polB = this.polarityMap.get(colorB) || 0;
    if (polA * polB < 0) {
      return mag.oppositePolarityMultiplier ?? 1.0;
    }
    if (polA * polB > 0) {
      return mag.samePolarityMultiplier ?? 1.0;
    }
    return 1.0;
  }

  getProjectileCurvePull(projColor, targetColor) {
    const mag = this.physicsConfig.magnetism;
    if (!projColor || !targetColor) {
      return mag.projectileCurveInfluence;
    }
    if (projColor === targetColor) {
      return mag.projectileCurveInfluence * mag.sameColorAttractionMultiplier;
    }
    const polA = this.polarityMap.get(projColor) || 0;
    const polB = this.polarityMap.get(targetColor) || 0;
    if (polA * polB < 0) {
      return mag.projectileOppositePolarityInfluence ?? mag.projectileCurveInfluence;
    }
    if (polA * polB > 0) {
      return mag.projectileSamePolarityInfluence ?? mag.projectileCurveInfluence;
    }
    return mag.projectileCurveInfluence;
  }

  findExitPortal(entryPortal) {
    if (!entryPortal || entryPortal.type !== OBSTACLE_TYPES.PORTAL || !entryPortal.pairId) {
      return null;
    }
    for (const obs of this.obstacles) {
      if (obs !== entryPortal && obs.type === OBSTACLE_TYPES.PORTAL && obs.pairId === entryPortal.pairId) {
        return obs;
      }
    }
    return null;
  }

  clear() {
    this.balls.length = 0;
    this.droppingBalls.length = 0;
    this.obstacles.length = 0;
    this.projectile = null;
    this.ballMap.clear();
    this.pendingChainCandidateIds.clear();
  }

  addBall(ball) {
    this.balls.push(ball);
    this.ballMap.set(ball.id, ball);
    return ball;
  }

  removeBall(ball) {
    for (const neighborId of ball.bonds) {
      const neighbor = this.ballMap.get(neighborId);
      if (neighbor) {
        neighbor.bonds.delete(ball.id);
      }
    }
    ball.bonds.clear();
    this.ballMap.delete(ball.id);
    this.pendingChainCandidateIds.delete(ball.id);
    const idx = this.balls.indexOf(ball);
    if (idx !== -1) {
      this.balls.splice(idx, 1);
    }
  }

  rebuildInitialBonds() {
    const r = this.physicsConfig.ball.radius;
    const maxDist = r * this.physicsConfig.simulation.bondCreationDistanceFactor;
    const maxDistSq = maxDist * maxDist;

    for (let i = 0; i < this.balls.length; i++) {
      const a = this.balls[i];
      for (let j = i + 1; j < this.balls.length; j++) {
        const b = this.balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx * dx + dy * dy <= maxDistSq) {
          this.createBond(a, b, false);
        }
      }
    }
  }

  createBond(a, b, trackChain = true) {
    if (a.id === b.id) {
      return;
    }
    const alreadyBonded = a.bonds.has(b.id);
    a.bonds.add(b.id);
    b.bonds.add(a.id);

    if (!alreadyBonded && trackChain && a.colorId && a.colorId === b.colorId) {
      this.pendingChainCandidateIds.add(a.id);
    }
  }

  consumeChainCandidates() {
    if (this.pendingChainCandidateIds.size === 0) {
      return [];
    }
    const candidates = [];
    for (const id of this.pendingChainCandidateIds) {
      const ball = this.ballMap.get(id);
      if (ball) {
        candidates.push(ball);
      }
    }
    this.pendingChainCandidateIds.clear();
    return candidates;
  }

  findRootPivotForBall(startBall) {
    if (startBall.pivotRef) {
      return startBall.pivotRef;
    }
    const visited = new Set([startBall.id]);
    const queue = [startBall];
    let head = 0;
    while (head < queue.length) {
      const curr = queue[head++];
      if (curr.pivotRef) {
        return curr.pivotRef;
      }
      for (const nId of curr.bonds) {
        if (!visited.has(nId)) {
          visited.add(nId);
          const n = this.ballMap.get(nId);
          if (n) {
            queue.push(n);
          }
        }
      }
    }
    return null;
  }

  step(callbacks) {
    const sim = this.physicsConfig.simulation;
    const substeps = sim.substeps;

    this.applyGravityTorqueToPivots();
    for (const obstacle of this.obstacles) {
      obstacle.update(sim.pivotAngularDamping);
    }

    for (let s = 0; s < substeps; s++) {
      this.stepCluster(1 / substeps);
      if (this.projectile) {
        const landed = this.stepProjectile(1 / substeps, callbacks);
        if (landed) {
          break;
        }
      }
    }

    this.stepDroppingBalls(callbacks);
  }

  applyGravityTorqueToPivots() {
    const sim = this.physicsConfig.simulation;
    const pivots = this.obstacles.filter((o) => o.type === OBSTACLE_TYPES.PIVOT);
    if (pivots.length === 0) {
      return;
    }

    for (const ball of this.balls) {
      let nearestPivot = ball.pivotRef;
      if (!nearestPivot && pivots.length === 1) {
        nearestPivot = pivots[0];
      }
      if (nearestPivot) {
        const dx = ball.x - nearestPivot.x;
        const torque = dx * sim.pivotGravityTorqueFactor;
        nearestPivot.applyTorque(torque, sim.pivotMaxAngularSpeed);
      }
    }
  }

  stepCluster(dt) {
    const sim = this.physicsConfig.simulation;
    const mag = this.physicsConfig.magnetism;
    const ballRadius = this.physicsConfig.ball.radius;
    const minWallX = this.gameConfig.canvas.wallMargin + ballRadius;
    const maxWallX = this.gameConfig.canvas.logicalWidth - this.gameConfig.canvas.wallMargin - ballRadius;
    const minWallY = this.gameConfig.canvas.wallMargin + ballRadius;

    for (const ball of this.balls) {
      if (ball.pivotRef) {
        ball.pivotAngle += ball.pivotRef.angularVelocity * dt;
        ball.anchorX = ball.pivotRef.x + Math.cos(ball.pivotAngle) * ball.pivotRadius;
        ball.anchorY = ball.pivotRef.y + Math.sin(ball.pivotAngle) * ball.pivotRadius;
      }

      if (ball.isAnchor) {
        const dx = ball.anchorX - ball.x;
        const dy = ball.anchorY - ball.y;
        ball.vx += dx * sim.anchorStiffness * dt;
        ball.vy += dy * sim.anchorStiffness * dt;
      } else {
        ball.vy += sim.clusterGravity * dt;
      }
    }

    const attractRange = ballRadius * mag.attractionRangeFactor;
    const attractRangeSq = attractRange * attractRange;

    for (let i = 0; i < this.balls.length; i++) {
      const a = this.balls[i];
      for (let j = i + 1; j < this.balls.length; j++) {
        const b = this.balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;

        if (distSq > MATH_CONSTANTS.EPSILON && distSq < attractRangeSq) {
          const dist = Math.sqrt(distSq);
          const clampedDist = Math.max(dist, mag.minDistanceClamp);
          const colorBonus = this.getMagneticMultiplier(a.colorId, b.colorId);
          const force = (mag.attractionForceConstant * colorBonus * dt) / (clampedDist * clampedDist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (!a.isAnchor) {
            a.vx += fx;
            a.vy += fy;
          }
          if (!b.isAnchor) {
            b.vx -= fx;
            b.vy -= fy;
          }
        }
      }
    }

    for (const ball of this.balls) {
      const damping = ball.isFrozen ? Math.pow(sim.frozenDamping, dt) : Math.pow(sim.velocityDamping, dt);
      ball.vx *= damping;
      ball.vy *= damping;

      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed > sim.maxVelocity) {
        const scale = sim.maxVelocity / speed;
        ball.vx *= scale;
        ball.vy *= scale;
      }

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      if (ball.x < minWallX) {
        ball.x = minWallX;
        ball.vx = Math.abs(ball.vx) * this.physicsConfig.ball.restitution;
      } else if (ball.x > maxWallX) {
        ball.x = maxWallX;
        ball.vx = -Math.abs(ball.vx) * this.physicsConfig.ball.restitution;
      }
      if (ball.y < minWallY) {
        ball.y = minWallY;
        ball.vy = Math.abs(ball.vy) * this.physicsConfig.ball.restitution;
      }
    }

    const restDist = ballRadius * sim.bondRestDistanceFactor;
    const breakDist = ballRadius * sim.bondBreakDistanceFactor;
    const minDist = ballRadius * 2;

    for (let iter = 0; iter < sim.constraintIterations; iter++) {
      for (const a of this.balls) {
        for (const neighborId of a.bonds) {
          if (neighborId <= a.id) {
            continue;
          }
          const b = this.ballMap.get(neighborId);
          if (!b) {
            continue;
          }
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || MATH_CONSTANTS.EPSILON;

          if (dist > breakDist && !a.isAnchor && !b.isAnchor) {
            a.bonds.delete(b.id);
            b.bonds.delete(a.id);
            continue;
          }

          const diff = (dist - restDist) / dist;
          const correctionX = dx * diff * sim.bondStiffness * dt;
          const correctionY = dy * diff * sim.bondStiffness * dt;

          if (!a.isAnchor && !b.isAnchor) {
            a.x += correctionX * MATH_CONSTANTS.HALF;
            a.y += correctionY * MATH_CONSTANTS.HALF;
            b.x -= correctionX * MATH_CONSTANTS.HALF;
            b.y -= correctionY * MATH_CONSTANTS.HALF;
          } else if (a.isAnchor && !b.isAnchor) {
            b.x -= correctionX;
            b.y -= correctionY;
          } else if (!a.isAnchor && b.isAnchor) {
            a.x += correctionX;
            a.y += correctionY;
          }
        }
      }

      for (let i = 0; i < this.balls.length; i++) {
        const a = this.balls[i];
        for (let j = i + 1; j < this.balls.length; j++) {
          const b = this.balls[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < minDist * minDist && distSq > MATH_CONSTANTS.EPSILON) {
            const dist = Math.sqrt(distSq);
            const overlap = (minDist - dist) * sim.collisionOverlapPush;
            const nx = dx / dist;
            const ny = dy / dist;

            if (!a.isAnchor && !b.isAnchor) {
              a.x -= nx * overlap * MATH_CONSTANTS.HALF;
              a.y -= ny * overlap * MATH_CONSTANTS.HALF;
              b.x += nx * overlap * MATH_CONSTANTS.HALF;
              b.y += ny * overlap * MATH_CONSTANTS.HALF;
            } else if (a.isAnchor && !b.isAnchor) {
              b.x += nx * overlap;
              b.y += ny * overlap;
            } else if (!a.isAnchor && b.isAnchor) {
              a.x -= nx * overlap;
              a.y -= ny * overlap;
            }

            if (!a.bonds.has(b.id)) {
              this.createBond(a, b, true);
            }
          }
        }
      }

      for (const ball of this.balls) {
        if (ball.isAnchor) {
          ball.x += (ball.anchorX - ball.x) * sim.anchorStiffness;
          ball.y += (ball.anchorY - ball.y) * sim.anchorStiffness;
        }
      }
    }
  }

  stepProjectile(dt, callbacks) {
    const p = this.projectile;
    if (!p) {
      return false;
    }

    const ballCfg = this.physicsConfig.ball;
    const sim = this.physicsConfig.simulation;
    const mag = this.physicsConfig.magnetism;
    const minWallX = this.gameConfig.canvas.wallMargin + p.radius;
    const maxWallX = this.gameConfig.canvas.logicalWidth - this.gameConfig.canvas.wallMargin - p.radius;
    const minWallY = this.gameConfig.canvas.wallMargin + p.radius;

    for (const obs of this.obstacles) {
      if (obs.type === OBSTACLE_TYPES.REPULSOR || obs.type === OBSTACLE_TYPES.ATTRACTOR) {
        const dx = obs.x - p.x;
        const dy = obs.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > MATH_CONSTANTS.EPSILON && dist < obs.fieldRadius) {
          const factor = (1 - dist / obs.fieldRadius) * obs.force * dt;
          p.vx += (dx / dist) * factor;
          p.vy += (dy / dist) * factor;
        }
      }
    }

    if (p.specialType !== SPECIAL_TYPES.ANVIL) {
      const attractRange = p.radius * mag.attractionRangeFactor;
      for (const target of this.balls) {
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > MATH_CONSTANTS.EPSILON && dist < attractRange) {
          const curvePull = this.getProjectileCurvePull(p.colorId, target.colorId);
          const pull = (curvePull * dt) / Math.max(dist, mag.minDistanceClamp);
          p.vx += dx * pull;
          p.vy += dy * pull;
        }
      }
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.portalCooldown > 0) {
      p.portalCooldown--;
    }

    if (p.x < minWallX) {
      p.x = minWallX;
      p.vx = Math.abs(p.vx) * ballCfg.wallRestitution;
      if (callbacks?.onBounce) {
        callbacks.onBounce(p.x, p.y);
      }
    } else if (p.x > maxWallX) {
      p.x = maxWallX;
      p.vx = -Math.abs(p.vx) * ballCfg.wallRestitution;
      if (callbacks?.onBounce) {
        callbacks.onBounce(p.x, p.y);
      }
    }

    for (const obs of this.obstacles) {
      if (obs.type === OBSTACLE_TYPES.PORTAL) {
        if (!p.portalCooldown || p.portalCooldown <= 0) {
          const dist = Math.hypot(p.x - obs.x, p.y - obs.y);
          if (dist <= p.radius + obs.radius * MATH_CONSTANTS.HALF) {
            const exitPortal = this.findExitPortal(obs);
            if (exitPortal) {
              const spd = Math.hypot(p.vx, p.vy) || ballCfg.projectileSpeed;
              const dirX = p.vx / spd;
              const dirY = p.vy / spd;
              const offsetDist = (p.radius + exitPortal.radius) * exitPortal.exitOffsetFactor;
              p.x = exitPortal.x + dirX * offsetDist;
              p.y = exitPortal.y + dirY * offsetDist;
              p.vx *= exitPortal.speedBoostMultiplier;
              p.vy *= exitPortal.speedBoostMultiplier;
              p.portalCooldown = exitPortal.teleportCooldownSteps;
              obs.hitPulse = 1.0;
              exitPortal.hitPulse = 1.0;
              if (callbacks?.onPortalWarp) {
                callbacks.onPortalWarp(obs, exitPortal);
              }
              break;
            }
          }
        }
      } else if (obs.type === OBSTACLE_TYPES.BUMPER || obs.type === OBSTACLE_TYPES.PIVOT) {
        const dx = p.x - obs.x;
        const dy = p.y - obs.y;
        const minDist = p.radius + obs.radius;
        const dist = Math.hypot(dx, dy);
        if (dist < minDist && dist > MATH_CONSTANTS.EPSILON) {
          const nx = dx / dist;
          const ny = dy / dist;
          p.x = obs.x + nx * minDist;
          p.y = obs.y + ny * minDist;
          const dot = p.vx * nx + p.vy * ny;
          if (dot < 0) {
            p.vx = (p.vx - 2 * dot * nx) * obs.restitution;
            p.vy = (p.vy - 2 * dot * ny) * obs.restitution;
            obs.hitPulse = 1.0;
            if (callbacks?.onBounce) {
              callbacks.onBounce(p.x, p.y);
            }
          }
        }
      } else if (obs.type === OBSTACLE_TYPES.BARRIER) {
        const halfW = obs.width * MATH_CONSTANTS.HALF;
        const halfH = obs.height * MATH_CONSTANTS.HALF;
        const closestX = Math.max(obs.x - halfW, Math.min(p.x, obs.x + halfW));
        const closestY = Math.max(obs.y - halfH, Math.min(p.y, obs.y + halfH));
        const dx = p.x - closestX;
        const dy = p.y - closestY;
        const dist = Math.hypot(dx, dy);
        if (dist < p.radius && dist > MATH_CONSTANTS.EPSILON) {
          const nx = dx / dist;
          const ny = dy / dist;
          p.x = closestX + nx * p.radius;
          p.y = closestY + ny * p.radius;
          const dot = p.vx * nx + p.vy * ny;
          if (dot < 0) {
            p.vx = (p.vx - 2 * dot * nx) * obs.restitution;
            p.vy = (p.vy - 2 * dot * ny) * obs.restitution;
            obs.hitPulse = 1.0;
            if (callbacks?.onBounce) {
              callbacks.onBounce(p.x, p.y);
            }
          }
        }
      }
    }

    if (p.specialType === SPECIAL_TYPES.ANVIL) {
      const pierceFactor = this.ballsConfig.specialTypes.anvil.pierceRadiusFactor;
      const pierceRadius = p.radius * pierceFactor;
      const massRatio = ballCfg.anvilMass / ballCfg.mass;
      for (let i = this.balls.length - 1; i >= 0; i--) {
        const target = this.balls[i];
        const dist = Math.hypot(target.x - p.x, target.y - p.y);
        if (dist <= pierceRadius) {
          const rootPivot = this.findRootPivotForBall(target);
          if (rootPivot) {
            const rx = target.x - rootPivot.x;
            const ry = target.y - rootPivot.y;
            const crossTorque = (rx * p.vy - ry * p.vx) * sim.pivotImpactTorqueFactor * massRatio;
            rootPivot.applyTorque(crossTorque, sim.pivotMaxAngularSpeed);
          }
          if (callbacks?.onAnvilCrush) {
            callbacks.onAnvilCrush(target);
          }
        }
      }
      if (p.y <= minWallY || p.y > this.gameConfig.canvas.logicalHeight) {
        this.projectile = null;
        if (callbacks?.onAnvilComplete) {
          callbacks.onAnvilComplete();
        }
        return true;
      }
      return false;
    }

    const snapDist = p.radius * sim.projectileSnapDistanceFactor;
    for (const target of this.balls) {
      const dx = p.x - target.x;
      const dy = p.y - target.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= snapDist) {
        this.snapProjectile(p, target, callbacks);
        return true;
      }
    }

    if (p.y <= minWallY) {
      p.y = minWallY;
      p.isAnchor = true;
      p.anchorX = p.x;
      p.anchorY = p.y;
      this.snapProjectile(p, null, callbacks);
      return true;
    }

    if (p.y > this.gameConfig.canvas.logicalHeight + p.radius * sim.outOfBoundsMarginFactor) {
      this.projectile = null;
      return true;
    }

    return false;
  }

  snapProjectile(projectile, hitTarget, callbacks) {
    const sim = this.physicsConfig.simulation;
    this.projectile = null;
    projectile.isProjectile = false;

    const impactVx = projectile.vx;
    const impactVy = projectile.vy;

    if (hitTarget) {
      const dx = projectile.x - hitTarget.x;
      const dy = projectile.y - hitTarget.y;
      const dist = Math.hypot(dx, dy) || 1;
      const targetDist = projectile.radius * sim.bondRestDistanceFactor;
      projectile.x = hitTarget.x + (dx / dist) * targetDist;
      projectile.y = hitTarget.y + (dy / dist) * targetDist;

      hitTarget.vx += impactVx * sim.impactImpulseMultiplier;
      hitTarget.vy += impactVy * sim.impactImpulseMultiplier;

      const rootPivot = this.findRootPivotForBall(hitTarget);
      if (rootPivot) {
        const rx = hitTarget.x - rootPivot.x;
        const ry = hitTarget.y - rootPivot.y;
        const crossTorque = (rx * impactVy - ry * impactVx) * sim.pivotImpactTorqueFactor;
        rootPivot.applyTorque(crossTorque, sim.pivotMaxAngularSpeed);
      }
    }

    projectile.vx *= sim.snapVelocityRetention;
    projectile.vy *= sim.snapVelocityRetention;

    this.addBall(projectile);

    const bondRange = projectile.radius * sim.bondCreationDistanceFactor;
    for (const other of this.balls) {
      if (other.id === projectile.id) {
        continue;
      }
      const d = Math.hypot(other.x - projectile.x, other.y - projectile.y);
      if (d <= bondRange) {
        this.createBond(projectile, other, false);
        other.vx += projectile.vx * sim.neighborImpulseTransfer;
        other.vy += projectile.vy * sim.neighborImpulseTransfer;
      }
    }

    if (callbacks?.onProjectileSnapped) {
      callbacks.onProjectileSnapped(projectile, hitTarget);
    }
  }

  findColorCluster(startBall) {
    const targetColor = startBall.colorId;
    if (!targetColor) {
      return [startBall];
    }
    const visited = new Set([startBall.id]);
    const queue = [startBall];
    const cluster = [];
    let head = 0;

    while (head < queue.length) {
      const current = queue[head++];
      cluster.push(current);

      for (const neighborId of current.bonds) {
        if (visited.has(neighborId)) {
          continue;
        }
        const neighbor = this.ballMap.get(neighborId);
        if (neighbor && neighbor.colorId === targetColor) {
          visited.add(neighborId);
          queue.push(neighbor);
        }
      }
    }

    return cluster;
  }

  detachUnanchoredBalls() {
    const anchoredSet = new Set();
    const queue = [];

    for (const ball of this.balls) {
      if (ball.isAnchor || ball.pivotRef) {
        anchoredSet.add(ball.id);
        queue.push(ball);
      }
    }

    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      for (const neighborId of current.bonds) {
        if (!anchoredSet.has(neighborId)) {
          const neighbor = this.ballMap.get(neighborId);
          if (neighbor) {
            anchoredSet.add(neighborId);
            queue.push(neighbor);
          }
        }
      }
    }

    const sim = this.physicsConfig.simulation;
    const detached = [];
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      if (!anchoredSet.has(ball.id)) {
        this.removeBall(ball);
        ball.isDropping = true;
        ball.vx += (Math.random() - MATH_CONSTANTS.HALF) * sim.dropHorizontalSpread;
        ball.vy = Math.max(ball.vy, sim.dropMinVerticalSpeed);
        this.droppingBalls.push(ball);
        detached.push(ball);
      }
    }

    return detached;
  }

  stepDroppingBalls(callbacks) {
    const sim = this.physicsConfig.simulation;
    const gravity = sim.dropGravity;
    const maxY = this.gameConfig.canvas.logicalHeight + sim.dropOutMarginY;

    for (let i = this.droppingBalls.length - 1; i >= 0; i--) {
      const b = this.droppingBalls[i];
      b.vy += gravity;
      b.x += b.vx;
      b.y += b.vy;
      if (b.y > maxY) {
        const lastIndex = this.droppingBalls.length - 1;
        if (i !== lastIndex) {
          this.droppingBalls[i] = this.droppingBalls[lastIndex];
        }
        this.droppingBalls.pop();
        if (callbacks?.onBallDroppedOut) {
          callbacks.onBallDroppedOut(b);
        }
      }
    }
  }

  computeAimTrajectory(startX, startY, angleRad, currentBall = null, maxDistanceBonus = 0, maxBouncesBonus = 0) {
    const points = [{ x: startX, y: startY }];
    const canvasCfg = this.gameConfig.canvas;
    const ballCfg = this.physicsConfig.ball;
    const sim = this.physicsConfig.simulation;
    const mag = this.physicsConfig.magnetism;
    const r = ballCfg.radius;
    const minWallX = canvasCfg.wallMargin + r;
    const maxWallX = canvasCfg.logicalWidth - canvasCfg.wallMargin - r;
    const minWallY = canvasCfg.wallMargin + r;

    const maxDistance = canvasCfg.aimRayMaxDistance + maxDistanceBonus;
    const maxBounces = canvasCfg.aimRayMaxBounces + maxBouncesBonus;
    const dt = 1 / sim.substeps;

    const isAnvil = currentBall?.specialType === SPECIAL_TYPES.ANVIL;
    const speed = isAnvil ? ballCfg.anvilSpeed : ballCfg.projectileSpeed;
    const projectileColorId = currentBall?.colorId || null;
    const attractRange = r * mag.attractionRangeFactor;
    const snapDist = r * sim.projectileSnapDistanceFactor;

    let x = startX;
    let y = startY;
    let vx = Math.cos(angleRad) * speed;
    let vy = Math.sin(angleRad) * speed;
    let bounces = 0;
    let traveled = 0;
    let portalCooldown = 0;
    let snapTarget = null;
    let landingX = startX;
    let landingY = startY;

    while (traveled < maxDistance && bounces <= maxBounces) {
      for (const obs of this.obstacles) {
        if (obs.type === OBSTACLE_TYPES.REPULSOR || obs.type === OBSTACLE_TYPES.ATTRACTOR) {
          const dx = obs.x - x;
          const dy = obs.y - y;
          const dist = Math.hypot(dx, dy);
          if (dist > MATH_CONSTANTS.EPSILON && dist < obs.fieldRadius) {
            const factor = (1 - dist / obs.fieldRadius) * obs.force * dt;
            vx += (dx / dist) * factor;
            vy += (dy / dist) * factor;
          }
        }
      }

      if (!isAnvil) {
        for (const target of this.balls) {
          const dx = target.x - x;
          const dy = target.y - y;
          const dist = Math.hypot(dx, dy);
          if (dist > MATH_CONSTANTS.EPSILON && dist < attractRange) {
            const curvePull = this.getProjectileCurvePull(projectileColorId, target.colorId);
            const pull = (curvePull * dt) / Math.max(dist, mag.minDistanceClamp);
            vx += dx * pull;
            vy += dy * pull;
          }
        }
      }

      const prevX = x;
      const prevY = y;
      x += vx * dt;
      y += vy * dt;
      traveled += Math.hypot(x - prevX, y - prevY);
      if (portalCooldown > 0) {
        portalCooldown--;
      }

      if (x <= minWallX) {
        x = minWallX;
        vx = Math.abs(vx) * ballCfg.wallRestitution;
        bounces++;
      } else if (x >= maxWallX) {
        x = maxWallX;
        vx = -Math.abs(vx) * ballCfg.wallRestitution;
        bounces++;
      }

      let warpedThisStep = false;
      for (const obs of this.obstacles) {
        if (obs.type === OBSTACLE_TYPES.PORTAL) {
          if (portalCooldown <= 0) {
            const dist = Math.hypot(x - obs.x, y - obs.y);
            if (dist <= r + obs.radius * MATH_CONSTANTS.HALF) {
              const exitPortal = this.findExitPortal(obs);
              if (exitPortal) {
                points.push({ x: obs.x, y: obs.y });
                const spd = Math.hypot(vx, vy) || speed;
                const dirX = vx / spd;
                const dirY = vy / spd;
                const offsetDist = (r + exitPortal.radius) * exitPortal.exitOffsetFactor;
                x = exitPortal.x + dirX * offsetDist;
                y = exitPortal.y + dirY * offsetDist;
                vx *= exitPortal.speedBoostMultiplier;
                vy *= exitPortal.speedBoostMultiplier;
                portalCooldown = exitPortal.teleportCooldownSteps;
                points.push({ x, y, warpBreak: true });
                warpedThisStep = true;
                break;
              }
            }
          }
        } else if (obs.type === OBSTACLE_TYPES.BUMPER || obs.type === OBSTACLE_TYPES.PIVOT) {
          const dx = x - obs.x;
          const dy = y - obs.y;
          const minDist = r + obs.radius;
          const dist = Math.hypot(dx, dy);
          if (dist < minDist && dist > MATH_CONSTANTS.EPSILON) {
            const nx = dx / dist;
            const ny = dy / dist;
            x = obs.x + nx * minDist;
            y = obs.y + ny * minDist;
            const dot = vx * nx + vy * ny;
            if (dot < 0) {
              vx = (vx - 2 * dot * nx) * obs.restitution;
              vy = (vy - 2 * dot * ny) * obs.restitution;
              bounces++;
            }
          }
        } else if (obs.type === OBSTACLE_TYPES.BARRIER) {
          const halfW = obs.width * MATH_CONSTANTS.HALF;
          const halfH = obs.height * MATH_CONSTANTS.HALF;
          const closestX = Math.max(obs.x - halfW, Math.min(x, obs.x + halfW));
          const closestY = Math.max(obs.y - halfH, Math.min(y, obs.y + halfH));
          const dx = x - closestX;
          const dy = y - closestY;
          const dist = Math.hypot(dx, dy);
          if (dist < r && dist > MATH_CONSTANTS.EPSILON) {
            const nx = dx / dist;
            const ny = dy / dist;
            x = closestX + nx * r;
            y = closestY + ny * r;
            const dot = vx * nx + vy * ny;
            if (dot < 0) {
              vx = (vx - 2 * dot * nx) * obs.restitution;
              vy = (vy - 2 * dot * ny) * obs.restitution;
              bounces++;
            }
          }
        }
      }

      if (!warpedThisStep) {
        points.push({ x, y });
      }
      landingX = x;
      landingY = y;

      if (y <= minWallY) {
        landingY = minWallY;
        break;
      }

      if (!isAnvil) {
        let hitBall = null;
        for (const b of this.balls) {
          if (Math.hypot(b.x - x, b.y - y) <= snapDist) {
            hitBall = b;
            break;
          }
        }
        if (hitBall) {
          snapTarget = hitBall;
          const dx = x - hitBall.x;
          const dy = y - hitBall.y;
          const dist = Math.hypot(dx, dy) || 1;
          const targetDist = r * sim.bondRestDistanceFactor;
          landingX = hitBall.x + (dx / dist) * targetDist;
          landingY = hitBall.y + (dy / dist) * targetDist;
          break;
        }
      }
    }

    points.snapTarget = snapTarget;
    points.landingX = landingX;
    points.landingY = landingY;
    return points;
  }
}

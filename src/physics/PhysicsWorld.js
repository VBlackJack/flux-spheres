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

import { OBSTACLE_TYPES, SPECIAL_TYPES, MATH_CONSTANTS, SEPARATION_FALLBACK_AXIS } from '../core/Constants.js';
import { SpatialHashGrid } from './SpatialHashGrid.js';

const NOT_FOUND_INDEX = -1;

/**
 * Core 2D physics simulation world managing magnetic clusters, anchor/rotor constraints,
 * projectile trajectories, portals, and avalanche detachment.
 */
export class PhysicsWorld {
  /**
   * @param {object} physicsConfig - Physics simulation and magnetism configuration.
   * @param {object} gameConfig - Canvas geometry and gameplay configuration.
   * @param {object} ballsConfig - Ball palette, special types, and modifiers configuration.
   */
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
    this.activeFlightBall = null;
    this.ballMap = new Map();
    this.pendingChainCandidateIds = new Set();
    this.gravityMultiplier = 1.0;
    this.magnetismMultiplier = 1.0;
    this.rotorSpeedMultiplier = 1.0;
    this.allowTensionBreak = false;
    this.hasBrokenBondThisStep = false;
    this.randomSource = Math.random;
    const attractRange = physicsConfig.ball.radius * physicsConfig.magnetism.attractionRangeFactor;
    this.spatialGrid = new SpatialHashGrid(attractRange);

    this.pairBufferA = [];
    this.pairBufferB = [];
    this.ballRootPivots = new Map();
    this.pivotTorqueScratch = new Map();
    this.bfsQueue = [];
    this.normalScratch = { x: 0, y: 0 };
    this.snapScratch = { x: 0, y: 0 };

    this.aimPoints = [];
    this.aimPointPool = [];
    this.aimSignature = [];
    this.aimSignatureScratch = [];
    this.aimCacheValid = false;
    this.aimTrajectoryComputeCount = 0;
    this.aimGhostCache = new WeakMap();
    this.aimGhosts = [];
    this.aimPivotTorques = [];
    this.aimPivotOffsets = [];
    this.aimPivotCos = [];
    this.aimPivotSin = [];
    this.aimObstacleIndex = new Map();
    this.aimBallX = [];
    this.aimBallY = [];
    this.aimRotatingBalls = [];
    this.aimRotatingPivotIdx = [];
    this.aimPreview = { obstacles: this.aimGhosts, ballX: this.aimBallX, ballY: this.aimBallY };
    this.aimState = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 0,
      colorId: null,
      isPolarityFlipped: false,
      portalCooldown: 0,
      bounces: 0,
      portalWarps: 0,
      flightSteps: 0,
      warpedThisStep: false,
      warpFromX: 0,
      warpFromY: 0
    };
  }

  /**
   * Injects the random source used by gameplay-affecting physics (avalanche drop spread),
   * so seeded modes such as the Daily Challenge stay reproducible.
   * @param {() => number} randomFn - Function returning a uniform value in [0, 1).
   */
  setRandomSource(randomFn) {
    this.randomSource = randomFn;
  }

  getMagneticMultiplier(colorA, colorB) {
    const mag = this.physicsConfig.magnetism;
    if (!colorA || !colorB) {
      return mag.neutralPolarityMultiplier;
    }
    if (colorA === colorB) {
      return mag.sameColorAttractionMultiplier;
    }
    const polA = this.polarityMap.get(colorA) || 0;
    const polB = this.polarityMap.get(colorB) || 0;
    if (polA * polB < 0) {
      return mag.oppositePolarityMultiplier;
    }
    if (polA * polB > 0) {
      return mag.samePolarityMultiplier;
    }
    return mag.neutralPolarityMultiplier;
  }

  getProjectileCurvePull(projColor, targetColor, isPolarityFlipped = false) {
    const mag = this.physicsConfig.magnetism;
    const flipSign = isPolarityFlipped ? -1 : 1;
    if (!projColor || !targetColor) {
      return mag.projectileCurveInfluence * flipSign * this.magnetismMultiplier;
    }
    if (projColor === targetColor) {
      return mag.projectileCurveInfluence * mag.sameColorAttractionMultiplier * flipSign * this.magnetismMultiplier;
    }
    const polA = this.polarityMap.get(projColor) || 0;
    const polB = this.polarityMap.get(targetColor) || 0;
    if (polA * polB < 0) {
      return mag.projectileOppositePolarityInfluence * flipSign * this.magnetismMultiplier;
    }
    if (polA * polB > 0) {
      return mag.projectileSamePolarityInfluence * flipSign * this.magnetismMultiplier;
    }
    return mag.projectileCurveInfluence * flipSign * this.magnetismMultiplier;
  }

  /**
   * Finds the paired exit portal of an entry portal.
   * @param {object} entryPortal - Portal the projectile entered.
   * @param {Array<object>} [obstacles] - Obstacle list to search (real or preview proxies).
   * @returns {object|null} The exit portal, or null when unpaired.
   */
  findExitPortal(entryPortal, obstacles = this.obstacles) {
    if (!entryPortal || entryPortal.type !== OBSTACLE_TYPES.PORTAL || !entryPortal.pairId) {
      return null;
    }
    for (const obs of obstacles) {
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
    this.activeFlightBall = null;
    this.ballMap.clear();
    this.pendingChainCandidateIds.clear();
    this.ballRootPivots.clear();
    this.spatialGrid.clear();
    this.gravityMultiplier = 1.0;
    this.magnetismMultiplier = 1.0;
    this.rotorSpeedMultiplier = 1.0;
    this.allowTensionBreak = false;
    this.hasBrokenBondThisStep = false;
    this.aimCacheValid = false;
  }

  addBall(ball) {
    this.balls.push(ball);
    this.ballMap.set(ball.id, ball);
    return ball;
  }

  /**
   * Severs every bond of a ball and unregisters it from the lookup tables,
   * without touching the active balls array.
   * @param {import('../entities/Ball.js').Ball} ball - Ball being removed from the cluster.
   */
  releaseBall(ball) {
    for (const neighborId of ball.bonds) {
      const neighbor = this.ballMap.get(neighborId);
      if (neighbor) {
        neighbor.bonds.delete(ball.id);
      }
    }
    ball.bonds.clear();
    this.ballMap.delete(ball.id);
    this.pendingChainCandidateIds.delete(ball.id);
  }

  removeBall(ball) {
    this.releaseBall(ball);
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

  /**
   * Maps every ball connected through the bond graph to a pivot-anchored ball onto that
   * ball's rotor, using a single multi-source BFS (nearest anchor in bond hops wins).
   * Balls with no bond path to any pivot are absent from the map.
   * @returns {Map<number, object>} Ball id to root pivot obstacle.
   */
  computeBallRootPivots() {
    const rootPivots = this.ballRootPivots;
    const queue = this.bfsQueue;
    rootPivots.clear();
    queue.length = 0;
    for (const ball of this.balls) {
      if (ball.pivotRef) {
        rootPivots.set(ball.id, ball.pivotRef);
        queue.push(ball);
      }
    }
    let head = 0;
    while (head < queue.length) {
      const curr = queue[head++];
      const pivot = rootPivots.get(curr.id);
      for (const nId of curr.bonds) {
        if (rootPivots.has(nId)) {
          continue;
        }
        const n = this.ballMap.get(nId);
        if (n) {
          rootPivots.set(nId, pivot);
          queue.push(n);
        }
      }
    }
    queue.length = 0;
    return rootPivots;
  }

  /**
   * Sums the gravitational torque each pivot receives from the balls connected to it.
   * @param {Map<object, number>} out - Receives pivot to total torque (cleared first).
   * @returns {Map<object, number>} The filled output map.
   */
  accumulateGravityTorques(out) {
    out.clear();
    const sim = this.physicsConfig.simulation;
    const torqueFactor = sim.pivotGravityTorqueFactor * this.rotorSpeedMultiplier;
    const rootPivots = this.computeBallRootPivots();
    if (rootPivots.size === 0) {
      return out;
    }
    for (const ball of this.balls) {
      const pivot = rootPivots.get(ball.id);
      if (!pivot) {
        continue;
      }
      const torque = (ball.x - pivot.x) * torqueFactor;
      out.set(pivot, out.has(pivot) ? out.get(pivot) + torque : torque);
    }
    return out;
  }

  /**
   * Resets the per-flight counters of a projectile that has just been launched.
   * @param {object} projectile - Newly launched projectile.
   */
  resetFlightState(projectile) {
    projectile.bounces = 0;
    projectile.portalWarps = 0;
    projectile.portalCooldown = 0;
    projectile.flightSteps = 0;
  }

  /**
   * Whether a flight has exceeded its portal warp or total step budget.
   * @param {object} state - Projectile or preview state.
   * @returns {boolean} True when the flight must end.
   */
  isFlightExhausted(state) {
    const sim = this.physicsConfig.simulation;
    return state.portalWarps > sim.maxProjectilePortalWarps || state.flightSteps > sim.maxProjectileFlightSteps;
  }

  /**
   * Clamps a projectile speed to the configured maximum so that no substep moves it far
   * enough to tunnel into obstacles.
   * @param {object} state - Projectile or preview state.
   */
  clampProjectileSpeed(state) {
    const maxSpeed = this.physicsConfig.ball.projectileMaxSpeed;
    const speedSq = state.vx * state.vx + state.vy * state.vy;
    if (speedSq > maxSpeed * maxSpeed) {
      const scale = maxSpeed / Math.sqrt(speedSq);
      state.vx *= scale;
      state.vy *= scale;
    }
  }

  /**
   * Writes a unit separation normal for an offset (dx, dy). When the offset is degenerate,
   * the reversed velocity is used, then the deterministic fallback axis.
   * @param {number} dx - Offset X from the obstacle or target to the body.
   * @param {number} dy - Offset Y from the obstacle or target to the body.
   * @param {number} vx - Body velocity X.
   * @param {number} vy - Body velocity Y.
   * @param {{x: number, y: number}} out - Receives the normal.
   * @returns {{x: number, y: number}} The filled output vector.
   */
  writeSeparationNormal(dx, dy, vx, vy, out) {
    const dist = Math.hypot(dx, dy);
    if (dist > MATH_CONSTANTS.EPSILON) {
      out.x = dx / dist;
      out.y = dy / dist;
      return out;
    }
    const speed = Math.hypot(vx, vy);
    if (speed > MATH_CONSTANTS.EPSILON) {
      out.x = -vx / speed;
      out.y = -vy / speed;
      return out;
    }
    out.x = SEPARATION_FALLBACK_AXIS.X;
    out.y = SEPARATION_FALLBACK_AXIS.Y;
    return out;
  }

  /**
   * Computes where a projectile settles next to the ball it snaps onto.
   * @returns {{x: number, y: number}} Shared scratch vector holding the landing position.
   */
  computeSnapPosition(px, py, vx, vy, targetX, targetY, targetDist) {
    const n = this.writeSeparationNormal(px - targetX, py - targetY, vx, vy, this.normalScratch);
    this.snapScratch.x = targetX + n.x * targetDist;
    this.snapScratch.y = targetY + n.y * targetDist;
    return this.snapScratch;
  }

  /**
   * Advances the physics simulation by one fixed timestep using substepping
   * for cluster spring-constraints, projectile motion, and dropping balls.
   * @param {object} callbacks - Event callbacks for bounces, portals, snaps, and captures.
   */
  step(callbacks) {
    const sim = this.physicsConfig.simulation;
    const substeps = sim.substeps;

    if (this.projectile !== this.activeFlightBall) {
      this.activeFlightBall = this.projectile;
      if (this.projectile) {
        this.resetFlightState(this.projectile);
      }
    }

    for (const ball of this.balls) {
      ball.savePreviousPosition();
    }
    for (const ball of this.droppingBalls) {
      ball.savePreviousPosition();
    }
    if (this.projectile) {
      this.projectile.savePreviousPosition();
    }

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

  /**
   * Applies gravitational torque to pivot rotors based on the horizontal lever arm of the
   * balls connected to each pivot through the bond graph. Unconnected balls apply none.
   */
  applyGravityTorqueToPivots() {
    const torques = this.accumulateGravityTorques(this.pivotTorqueScratch);
    if (torques.size === 0) {
      return;
    }
    const maxSpeed = this.physicsConfig.simulation.pivotMaxAngularSpeed * this.rotorSpeedMultiplier;
    for (const [pivot, torque] of torques) {
      pivot.applyTorque(torque, maxSpeed);
    }
  }

  /**
   * Integrates cluster forces (anchor springs, gravity, inverse-square magnetic attraction)
   * and iteratively resolves bond distance constraints and ball-ball overlaps.
   * The neighbor pairs are collected once per substep and reused by every pass.
   * @param {number} dt - Substep time fraction (1 / substeps).
   */
  stepCluster(dt) {
    const sim = this.physicsConfig.simulation;
    const mag = this.physicsConfig.magnetism;
    const ballRadius = this.physicsConfig.ball.radius;
    const restitution = this.physicsConfig.ball.restitution;
    const minWallX = this.gameConfig.canvas.wallMargin + ballRadius;
    const maxWallX = this.gameConfig.canvas.logicalWidth - this.gameConfig.canvas.wallMargin - ballRadius;
    const minWallY = this.gameConfig.canvas.wallMargin + ballRadius;
    const balls = this.balls;

    for (const ball of balls) {
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
        ball.vy += sim.clusterGravity * this.gravityMultiplier * dt;
      }
    }

    const attractRange = ballRadius * mag.attractionRangeFactor;
    const attractRangeSq = attractRange * attractRange;
    const magMult = this.magnetismMultiplier;
    const pairsA = this.pairBufferA;
    const pairsB = this.pairBufferB;

    this.spatialGrid.setCellSize(attractRange);
    const pairCount = this.spatialGrid.collectPairs(balls, attractRangeSq, pairsA, pairsB);

    for (let k = 0; k < pairCount; k++) {
      const a = pairsA[k];
      const b = pairsB[k];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= MATH_CONSTANTS.EPSILON) {
        continue;
      }
      const dist = Math.sqrt(distSq);
      const clampedDist = Math.max(dist, mag.minDistanceClamp);
      const colorBonus = this.getMagneticMultiplier(a.colorId, b.colorId);
      const force = (mag.attractionForceConstant * magMult * colorBonus * dt) / (clampedDist * clampedDist);
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

    const velocityDampingDt = Math.pow(sim.velocityDamping, dt);
    const frozenDampingDt = Math.pow(sim.frozenDamping, dt);
    const maxVelocitySq = sim.maxVelocity * sim.maxVelocity;

    for (const ball of balls) {
      const damping = ball.isFrozen ? frozenDampingDt : velocityDampingDt;
      ball.vx *= damping;
      ball.vy *= damping;

      const speedSq = ball.vx * ball.vx + ball.vy * ball.vy;
      if (speedSq > maxVelocitySq) {
        const scale = sim.maxVelocity / Math.sqrt(speedSq);
        ball.vx *= scale;
        ball.vy *= scale;
      }

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      if (ball.x < minWallX) {
        ball.x = minWallX;
        ball.vx = Math.abs(ball.vx) * restitution;
      } else if (ball.x > maxWallX) {
        ball.x = maxWallX;
        ball.vx = -Math.abs(ball.vx) * restitution;
      }
      if (ball.y < minWallY) {
        ball.y = minWallY;
        ball.vy = Math.abs(ball.vy) * restitution;
      }
    }

    const restDist = ballRadius * sim.bondRestDistanceFactor;
    const breakDist = ballRadius * sim.bondBreakDistanceFactor;
    const minDist = ballRadius * sim.collisionDistanceFactor;
    const minDistSq = minDist * minDist;

    for (let iter = 0; iter < sim.constraintIterations; iter++) {
      for (const a of balls) {
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

          if (this.allowTensionBreak && dist > breakDist && !a.isAnchor && !b.isAnchor) {
            a.bonds.delete(b.id);
            b.bonds.delete(a.id);
            this.hasBrokenBondThisStep = true;
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

      for (let k = 0; k < pairCount; k++) {
        const a = pairsA[k];
        const b = pairsB[k];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDistSq) {
          continue;
        }
        let nx = SEPARATION_FALLBACK_AXIS.X;
        let ny = SEPARATION_FALLBACK_AXIS.Y;
        let dist = 0;
        if (distSq > MATH_CONSTANTS.EPSILON) {
          dist = Math.sqrt(distSq);
          nx = dx / dist;
          ny = dy / dist;
        }
        const overlap = (minDist - dist) * sim.collisionOverlapPush;

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

      for (const ball of balls) {
        if (ball.isAnchor) {
          ball.x += (ball.anchorX - ball.x) * sim.anchorStiffness;
          ball.y += (ball.anchorY - ball.y) * sim.anchorStiffness;
        }
      }
    }
  }

  /**
   * Reflects a projectile off a surface normal, applying the obstacle restitution and the
   * projectile speed cap, and reports the bounce.
   * @returns {boolean} True when the projectile was moving into the surface and bounced.
   */
  reflectProjectile(state, obs, nx, ny, callbacks) {
    const dot = state.vx * nx + state.vy * ny;
    if (dot >= 0) {
      return false;
    }
    state.vx = (state.vx - 2 * dot * nx) * obs.restitution;
    state.vy = (state.vy - 2 * dot * ny) * obs.restitution;
    this.clampProjectileSpeed(state);
    state.bounces++;
    if (callbacks?.onBounce) {
      obs.triggerHitPulse();
      callbacks.onBounce(state.x, state.y);
    }
    return true;
  }

  /**
   * Advances a projectile (or preview state) by one substep: field forces, magnetic curve,
   * integration, walls, portals, and solid obstacle collisions.
   * @param {object} state - Projectile or preview state.
   * @param {number} dt - Substep time fraction.
   * @param {boolean} isAnvil - Whether the projectile is an anvil (no curve, no ceiling).
   * @param {object|null} callbacks - Event callbacks, null for previews.
   * @param {object|null} preview - Predicted world (obstacle proxies and ball positions), null for the real simulation.
   */
  advanceProjectileMotion(state, dt, isAnvil, callbacks = null, preview = null) {
    const ballCfg = this.physicsConfig.ball;
    const mag = this.physicsConfig.magnetism;
    const r = state.radius;
    const minWallX = this.gameConfig.canvas.wallMargin + r;
    const maxWallX = this.gameConfig.canvas.logicalWidth - this.gameConfig.canvas.wallMargin - r;
    const minWallY = this.gameConfig.canvas.wallMargin + r;
    const obstacles = preview ? preview.obstacles : this.obstacles;

    state.warpedThisStep = false;

    for (const obs of obstacles) {
      if (obs.disabled) {
        continue;
      }
      const isFieldObstacle =
        obs.type === OBSTACLE_TYPES.REPULSOR ||
        obs.type === OBSTACLE_TYPES.ATTRACTOR ||
        obs.type === OBSTACLE_TYPES.SINGULARITY;
      if (!isFieldObstacle) {
        continue;
      }
      const activeRadius = obs.type === OBSTACLE_TYPES.SINGULARITY ? obs.pullRadius : obs.fieldRadius;
      const activeForce = obs.type === OBSTACLE_TYPES.SINGULARITY ? obs.projectilePullForce : obs.force;
      const dx = obs.x - state.x;
      const dy = obs.y - state.y;
      const distSq = dx * dx + dy * dy;
      if (activeForce === 0 || distSq >= activeRadius * activeRadius) {
        continue;
      }
      const dist = Math.sqrt(distSq);
      if (dist > MATH_CONSTANTS.EPSILON) {
        const prevSpeed = Math.hypot(state.vx, state.vy);
        const factor = (1 - dist / activeRadius) * activeForce * dt;
        state.vx += (dx / dist) * factor;
        state.vy += (dy / dist) * factor;
        const newSpeed = Math.hypot(state.vx, state.vy);
        if (newSpeed > MATH_CONSTANTS.EPSILON && prevSpeed > MATH_CONSTANTS.EPSILON) {
          state.vx = (state.vx / newSpeed) * prevSpeed;
          state.vy = (state.vy / newSpeed) * prevSpeed;
        }
      }
    }

    if (!isAnvil) {
      const attractRange = r * mag.attractionRangeFactor;
      const attractRangeSq = attractRange * attractRange;
      const isFlipped = Boolean(state.isPolarityFlipped);
      const balls = this.balls;
      for (let i = 0; i < balls.length; i++) {
        const target = balls[i];
        const dx = (preview ? preview.ballX[i] : target.x) - state.x;
        const dy = (preview ? preview.ballY[i] : target.y) - state.y;
        const distSq = dx * dx + dy * dy;
        if (distSq >= attractRangeSq) {
          continue;
        }
        const dist = Math.sqrt(distSq);
        if (dist > MATH_CONSTANTS.EPSILON) {
          const curvePull = this.getProjectileCurvePull(state.colorId, target.colorId, isFlipped);
          const pull = (curvePull * dt) / Math.max(dist, mag.minDistanceClamp);
          state.vx += dx * pull;
          state.vy += dy * pull;
        }
      }
      this.clampProjectileSpeed(state);
    }

    state.x += state.vx * dt;
    state.y += state.vy * dt;
    if (state.portalCooldown > 0) {
      state.portalCooldown--;
    }

    if (state.x <= minWallX) {
      state.x = minWallX;
      state.vx = Math.abs(state.vx) * ballCfg.wallRestitution;
      state.bounces++;
      if (callbacks?.onBounce) {
        callbacks.onBounce(state.x, state.y);
      }
    } else if (state.x >= maxWallX) {
      state.x = maxWallX;
      state.vx = -Math.abs(state.vx) * ballCfg.wallRestitution;
      state.bounces++;
      if (callbacks?.onBounce) {
        callbacks.onBounce(state.x, state.y);
      }
    }

    if (!isAnvil && state.y <= minWallY) {
      state.y = minWallY;
      state.vy = Math.abs(state.vy) * ballCfg.wallRestitution;
      state.bounces++;
      if (callbacks?.onBounce) {
        callbacks.onBounce(state.x, state.y);
      }
    }

    for (const obs of obstacles) {
      if (obs.disabled) {
        continue;
      }
      if (obs.type === OBSTACLE_TYPES.PORTAL) {
        if (state.portalCooldown > 0) {
          continue;
        }
        const triggerDist = r + obs.radius * obs.triggerRadiusFactor;
        const dx = state.x - obs.x;
        const dy = state.y - obs.y;
        if (dx * dx + dy * dy > triggerDist * triggerDist) {
          continue;
        }
        const exitPortal = this.findExitPortal(obs, obstacles);
        if (!exitPortal) {
          continue;
        }
        state.warpFromX = obs.x;
        state.warpFromY = obs.y;
        const dir = this.writeSeparationNormal(state.vx, state.vy, 0, 0, this.normalScratch);
        const offsetDist = (r + exitPortal.radius) * exitPortal.exitOffsetFactor;
        state.x = exitPortal.x + dir.x * offsetDist;
        state.y = exitPortal.y + dir.y * offsetDist;
        state.vx *= exitPortal.speedBoostMultiplier;
        state.vy *= exitPortal.speedBoostMultiplier;
        this.clampProjectileSpeed(state);
        state.portalCooldown = exitPortal.teleportCooldownSteps;
        state.portalWarps++;
        state.warpedThisStep = true;
        if (callbacks?.onPortalWarp) {
          obs.triggerHitPulse();
          exitPortal.triggerHitPulse();
          callbacks.onPortalWarp(obs, exitPortal);
        }
        break;
      } else if (
        obs.type === OBSTACLE_TYPES.BUMPER ||
        obs.type === OBSTACLE_TYPES.PIVOT ||
        obs.type === OBSTACLE_TYPES.REPULSOR
      ) {
        const dx = state.x - obs.x;
        const dy = state.y - obs.y;
        const minDist = r + obs.radius;
        if (dx * dx + dy * dy >= minDist * minDist) {
          continue;
        }
        const n = this.writeSeparationNormal(dx, dy, state.vx, state.vy, this.normalScratch);
        state.x = obs.x + n.x * minDist;
        state.y = obs.y + n.y * minDist;
        this.reflectProjectile(state, obs, n.x, n.y, callbacks);
      } else if (obs.type === OBSTACLE_TYPES.BARRIER) {
        this.resolveBarrierCollision(state, obs, r, callbacks);
      }
    }
  }

  /**
   * Resolves a projectile against an axis-aligned barrier. When the projectile center is
   * already inside the rectangle, it is pushed out through the nearest face.
   */
  resolveBarrierCollision(state, obs, r, callbacks) {
    const halfW = obs.width * MATH_CONSTANTS.HALF;
    const halfH = obs.height * MATH_CONSTANTS.HALF;
    const left = obs.x - halfW;
    const right = obs.x + halfW;
    const top = obs.y - halfH;
    const bottom = obs.y + halfH;
    const closestX = Math.max(left, Math.min(state.x, right));
    const closestY = Math.max(top, Math.min(state.y, bottom));
    const dx = state.x - closestX;
    const dy = state.y - closestY;
    const distSq = dx * dx + dy * dy;
    if (distSq >= r * r) {
      return;
    }

    const dist = Math.sqrt(distSq);
    let nx = 0;
    let ny = 0;
    if (dist > MATH_CONSTANTS.EPSILON) {
      nx = dx / dist;
      ny = dy / dist;
      state.x = closestX + nx * r;
      state.y = closestY + ny * r;
    } else {
      const penLeft = state.x - left;
      const penRight = right - state.x;
      const penTop = state.y - top;
      const penBottom = bottom - state.y;
      const minPen = Math.min(penLeft, penRight, penTop, penBottom);
      if (minPen === penLeft) {
        nx = -1;
        state.x = left - r;
      } else if (minPen === penRight) {
        nx = 1;
        state.x = right + r;
      } else if (minPen === penTop) {
        ny = -1;
        state.y = top - r;
      } else {
        ny = 1;
        state.y = bottom + r;
      }
    }
    this.reflectProjectile(state, obs, nx, ny, callbacks);
  }

  /**
   * Finds the nearest ball within the snap distance of a point.
   * @param {number} x - Probe X.
   * @param {number} y - Probe Y.
   * @param {number} snapDistSq - Squared snap distance.
   * @param {Array<number>|null} ballX - Predicted ball X positions, or null to use live positions.
   * @param {Array<number>|null} ballY - Predicted ball Y positions, or null to use live positions.
   * @returns {number} Index of the nearest ball in this.balls, or NOT_FOUND_INDEX when none is in range.
   */
  findNearestSnapIndex(x, y, snapDistSq, ballX = null, ballY = null) {
    const balls = this.balls;
    let bestIndex = NOT_FOUND_INDEX;
    let bestSq = snapDistSq;
    for (let i = 0; i < balls.length; i++) {
      const dx = (ballX ? ballX[i] : balls[i].x) - x;
      const dy = (ballY ? ballY[i] : balls[i].y) - y;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestSq || (bestIndex === NOT_FOUND_INDEX && dSq <= bestSq)) {
        bestSq = dSq;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  stepProjectile(dt, callbacks) {
    const p = this.projectile;
    if (!p) {
      return false;
    }

    const ballCfg = this.physicsConfig.ball;
    const sim = this.physicsConfig.simulation;
    const minWallY = this.gameConfig.canvas.wallMargin + p.radius;
    const isAnvil = p.specialType === SPECIAL_TYPES.ANVIL;

    p.flightSteps++;
    this.advanceProjectileMotion(p, dt, isAnvil, callbacks);

    if (isAnvil) {
      if (!p.crushedBallIds) {
        p.crushedBallIds = new Set();
      }
      const pierceFactor = this.ballsConfig.specialTypes.anvil.pierceRadiusFactor;
      const pierceRadius = p.radius * pierceFactor;
      const massRatio = ballCfg.anvilMass / ballCfg.mass;
      for (let i = this.balls.length - 1; i >= 0; i--) {
        const target = this.balls[i];
        if (p.crushedBallIds.has(target.id)) {
          continue;
        }
        const dist = Math.hypot(target.x - p.x, target.y - p.y);
        if (dist <= pierceRadius) {
          p.crushedBallIds.add(target.id);
          const rootPivot = this.findRootPivotForBall(target);
          if (rootPivot) {
            const rx = target.x - rootPivot.x;
            const ry = target.y - rootPivot.y;
            const rotorMult = this.rotorSpeedMultiplier;
            const crossTorque = (rx * p.vy - ry * p.vx) * sim.pivotImpactTorqueFactor * massRatio * rotorMult;
            rootPivot.applyTorque(crossTorque, sim.pivotMaxAngularSpeed * rotorMult);
          }
          if (callbacks?.onAnvilCrush) {
            callbacks.onAnvilCrush(target);
          }
        }
      }
      if (p.y <= minWallY || p.y > this.gameConfig.canvas.logicalHeight || this.isFlightExhausted(p)) {
        this.projectile = null;
        if (callbacks?.onAnvilComplete) {
          callbacks.onAnvilComplete();
        }
        return true;
      }
      return false;
    }

    const snapDist = p.radius * sim.projectileSnapDistanceFactor;
    const snapIndex = this.findNearestSnapIndex(p.x, p.y, snapDist * snapDist);
    if (snapIndex !== NOT_FOUND_INDEX) {
      this.snapProjectile(p, this.balls[snapIndex], callbacks);
      return true;
    }

    if (
      p.y > this.gameConfig.canvas.logicalHeight + p.radius * sim.outOfBoundsMarginFactor ||
      p.bounces > sim.maxProjectileBounces ||
      this.isFlightExhausted(p)
    ) {
      this.projectile = null;
      if (callbacks?.onProjectileMissed) {
        callbacks.onProjectileMissed(p);
      }
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
      const targetDist = projectile.radius * sim.bondRestDistanceFactor;
      const landing = this.computeSnapPosition(
        projectile.x,
        projectile.y,
        impactVx,
        impactVy,
        hitTarget.x,
        hitTarget.y,
        targetDist
      );
      projectile.x = landing.x;
      projectile.y = landing.y;

      hitTarget.vx += impactVx * sim.impactImpulseMultiplier;
      hitTarget.vy += impactVy * sim.impactImpulseMultiplier;

      const rootPivot = this.findRootPivotForBall(hitTarget);
      if (rootPivot) {
        const rx = hitTarget.x - rootPivot.x;
        const ry = hitTarget.y - rootPivot.y;
        const rotorMult = this.rotorSpeedMultiplier;
        const crossTorque = (rx * impactVy - ry * impactVx) * sim.pivotImpactTorqueFactor * rotorMult;
        rootPivot.applyTorque(crossTorque, sim.pivotMaxAngularSpeed * rotorMult);
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

  getAnchoredBallIds(excludedIds = null) {
    const anchoredSet = new Set();
    const queue = [];

    for (const ball of this.balls) {
      if (excludedIds && excludedIds.has(ball.id)) {
        continue;
      }
      if (ball.isAnchor || ball.pivotRef) {
        anchoredSet.add(ball.id);
        queue.push(ball);
      }
    }

    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      for (const neighborId of current.bonds) {
        if (excludedIds && excludedIds.has(neighborId)) {
          continue;
        }
        if (!anchoredSet.has(neighborId)) {
          const neighbor = this.ballMap.get(neighborId);
          if (neighbor) {
            anchoredSet.add(neighborId);
            queue.push(neighbor);
          }
        }
      }
    }

    return anchoredSet;
  }

  findDetachedIfRemoved(removedBallIds) {
    if (!removedBallIds || removedBallIds.size === 0) {
      return [];
    }
    const anchoredSet = this.getAnchoredBallIds(removedBallIds);
    const detached = [];
    for (const ball of this.balls) {
      if (!removedBallIds.has(ball.id) && !anchoredSet.has(ball.id)) {
        detached.push(ball);
      }
    }
    return detached;
  }

  /**
   * Removes every ball with no bond path to an anchor and turns it into a dropping ball.
   * The active array is compacted in a single pass; detached balls are returned (and
   * receive their random spread) in reverse array order.
   * @returns {Array<import('../entities/Ball.js').Ball>} The detached balls.
   */
  detachUnanchoredBalls() {
    const anchoredSet = this.getAnchoredBallIds();
    const sim = this.physicsConfig.simulation;
    const balls = this.balls;
    const detached = [];
    let kept = 0;
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      if (anchoredSet.has(ball.id)) {
        balls[kept++] = ball;
      } else {
        detached.push(ball);
      }
    }
    balls.length = kept;
    detached.reverse();

    for (const ball of detached) {
      this.releaseBall(ball);
      ball.isDropping = true;
      ball.vx += (this.randomSource() - MATH_CONSTANTS.HALF) * sim.dropHorizontalSpread;
      ball.vy = Math.max(ball.vy, sim.dropMinVerticalSpeed);
      this.droppingBalls.push(ball);
    }

    return detached;
  }

  stepDroppingBalls(callbacks) {
    const sim = this.physicsConfig.simulation;
    const canvasCfg = this.gameConfig.canvas;
    const restitution = this.physicsConfig.ball.restitution;
    const gravity = sim.dropGravity;
    const maxY = canvasCfg.logicalHeight + sim.dropOutMarginY;

    for (let i = this.droppingBalls.length - 1; i >= 0; i--) {
      const b = this.droppingBalls[i];
      b.vy += gravity;

      let capturedByObstacle = null;
      for (const obs of this.obstacles) {
        if (obs.disabled || obs.type !== OBSTACLE_TYPES.SINGULARITY) {
          continue;
        }
        const dx = obs.x - b.x;
        const dy = obs.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= obs.captureRadius) {
          capturedByObstacle = obs;
          break;
        }
        if (dist > MATH_CONSTANTS.EPSILON && dist <= obs.pullRadius) {
          const pull = (1 - dist / obs.pullRadius) * obs.pullForce;
          b.vx += (dx / dist) * pull;
          b.vy += (dy / dist) * pull;
        }
      }

      if (capturedByObstacle) {
        const lastIndex = this.droppingBalls.length - 1;
        if (i !== lastIndex) {
          this.droppingBalls[i] = this.droppingBalls[lastIndex];
        }
        this.droppingBalls.pop();
        capturedByObstacle.triggerHitPulse();
        if (callbacks?.onSingularityCapture) {
          callbacks.onSingularityCapture(b, capturedByObstacle);
        }
        continue;
      }

      b.x += b.vx;
      b.y += b.vy;

      const minWallX = canvasCfg.wallMargin + b.radius;
      const maxWallX = canvasCfg.logicalWidth - canvasCfg.wallMargin - b.radius;
      if (b.x < minWallX) {
        b.x = minWallX;
        b.vx = Math.abs(b.vx) * restitution;
      } else if (b.x > maxWallX) {
        b.x = maxWallX;
        b.vx = -Math.abs(b.vx) * restitution;
      }

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

  /**
   * Fills a signature describing everything the aim preview depends on. Ball and obstacle
   * positions are quantized so that sub-quantum jitter of a settled cluster reuses the cache.
   * @returns {Array<*>} The filled output array.
   */
  buildAimSignature(out, startX, startY, angleRad, colorId, specialType, distanceBonus, bouncesBonus, isFlipped) {
    const invQuantum = 1 / this.physicsConfig.aimPreview.cachePositionQuantum;
    out.length = 0;
    out.push(
      startX,
      startY,
      angleRad,
      colorId,
      specialType,
      distanceBonus,
      bouncesBonus,
      isFlipped,
      this.magnetismMultiplier,
      this.rotorSpeedMultiplier,
      this.balls,
      this.obstacles,
      this.balls.length,
      this.obstacles.length
    );
    for (const ball of this.balls) {
      out.push(
        ball.id,
        Math.round(ball.x * invQuantum),
        Math.round(ball.y * invQuantum),
        ball.colorId,
        ball.pivotRef,
        ball.bonds.size
      );
    }
    for (const obs of this.obstacles) {
      out.push(
        obs,
        obs.disabled,
        Math.round(obs.x * invQuantum),
        Math.round(obs.y * invQuantum),
        obs.angularVelocity,
        obs.oscillatePhase
      );
    }
    return out;
  }

  /**
   * Computes the aim preview path. The result is cached: when neither the aim parameters
   * nor the board changed since the previous call, the previous result is returned as-is.
   * The returned array and its points are owned by the world and overwritten on recompute.
   * @returns {Array<{x: number, y: number, warpBreak: boolean}>} Path points, with
   *   snapTarget, landingX and landingY properties attached to the array.
   */
  computeAimTrajectory(
    startX,
    startY,
    angleRad,
    currentBall = null,
    maxDistanceBonus = 0,
    maxBouncesBonus = 0,
    isPolarityFlipped = false
  ) {
    const colorId = currentBall && currentBall.colorId ? currentBall.colorId : null;
    const specialType = currentBall ? currentBall.specialType : null;
    const isFlipped = Boolean(isPolarityFlipped);
    const signature = this.buildAimSignature(
      this.aimSignatureScratch,
      startX,
      startY,
      angleRad,
      colorId,
      specialType,
      maxDistanceBonus,
      maxBouncesBonus,
      isFlipped
    );
    const previous = this.aimSignature;
    if (this.aimCacheValid && previous.length === signature.length) {
      let same = true;
      for (let i = 0; i < signature.length; i++) {
        if (signature[i] !== previous[i]) {
          same = false;
          break;
        }
      }
      if (same) {
        return this.aimPoints;
      }
    }
    this.aimSignature = signature;
    this.aimSignatureScratch = previous;
    this.aimCacheValid = true;
    this.aimTrajectoryComputeCount++;
    return this.traceAimTrajectory(
      startX,
      startY,
      angleRad,
      colorId,
      specialType,
      maxDistanceBonus,
      maxBouncesBonus,
      isFlipped
    );
  }

  /**
   * Appends a point to the aim path, reusing pooled point objects.
   */
  pushAimPoint(x, y, warpBreak) {
    const index = this.aimPoints.length;
    let point = this.aimPointPool[index];
    if (!point) {
      point = { x: 0, y: 0, warpBreak: false };
      this.aimPointPool[index] = point;
    }
    point.x = x;
    point.y = y;
    point.warpBreak = warpBreak;
    this.aimPoints.push(point);
  }

  /**
   * Prepares the predicted world used by the aim preview: obstacle proxies that inherit
   * from the real obstacles but own their motion state, the pivot gravity torques frozen
   * at the current ball layout, and the list of rotor-anchored balls to rotate.
   * @returns {object} The preview context passed to advanceProjectileMotion.
   */
  preparePreviewWorld() {
    const ghosts = this.aimGhosts;
    const obstacleIndex = this.aimObstacleIndex;
    ghosts.length = 0;
    obstacleIndex.clear();
    const torques = this.accumulateGravityTorques(this.pivotTorqueScratch);
    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      let ghost = this.aimGhostCache.get(obs);
      if (!ghost) {
        ghost = Object.create(obs);
        this.aimGhostCache.set(obs, ghost);
      }
      ghost.syncMotionStateFrom(obs);
      ghosts.push(ghost);
      obstacleIndex.set(obs, i);
      this.aimPivotTorques[i] = torques.has(obs) ? torques.get(obs) : 0;
      this.aimPivotOffsets[i] = 0;
    }

    const balls = this.balls;
    this.aimBallX.length = balls.length;
    this.aimBallY.length = balls.length;
    this.aimRotatingBalls.length = 0;
    this.aimRotatingPivotIdx.length = 0;
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      this.aimBallX[i] = ball.x;
      this.aimBallY[i] = ball.y;
      const pivotIdx = ball.pivotRef && obstacleIndex.has(ball.pivotRef)
        ? obstacleIndex.get(ball.pivotRef)
        : NOT_FOUND_INDEX;
      if (pivotIdx !== NOT_FOUND_INDEX) {
        this.aimRotatingBalls.push(i);
        this.aimRotatingPivotIdx.push(pivotIdx);
      }
    }
    return this.aimPreview;
  }

  /**
   * Advances the preview obstacle proxies by one fixed step, mirroring step().
   */
  advancePreviewObstacles() {
    const sim = this.physicsConfig.simulation;
    const maxSpeed = sim.pivotMaxAngularSpeed * this.rotorSpeedMultiplier;
    const ghosts = this.aimGhosts;
    for (let i = 0; i < ghosts.length; i++) {
      if (ghosts[i].type === OBSTACLE_TYPES.PIVOT) {
        ghosts[i].applyTorque(this.aimPivotTorques[i], maxSpeed);
      }
    }
    for (const ghost of ghosts) {
      ghost.update(sim.pivotAngularDamping);
    }
  }

  /**
   * Rotates rotor-anchored balls around their predicted pivot by one substep of the
   * predicted angular velocity, mirroring the anchor motion in stepCluster().
   * @param {number} dt - Substep time fraction.
   */
  advancePreviewBalls(dt) {
    const ghosts = this.aimGhosts;
    if (this.aimRotatingBalls.length === 0) {
      return;
    }
    for (let i = 0; i < ghosts.length; i++) {
      if (ghosts[i].type === OBSTACLE_TYPES.PIVOT) {
        this.aimPivotOffsets[i] += ghosts[i].angularVelocity * dt;
        this.aimPivotCos[i] = Math.cos(this.aimPivotOffsets[i]);
        this.aimPivotSin[i] = Math.sin(this.aimPivotOffsets[i]);
      }
    }
    for (let k = 0; k < this.aimRotatingBalls.length; k++) {
      const ballIdx = this.aimRotatingBalls[k];
      const pivotIdx = this.aimRotatingPivotIdx[k];
      const ball = this.balls[ballIdx];
      const source = this.obstacles[pivotIdx];
      const ghost = ghosts[pivotIdx];
      const rx = ball.x - source.x;
      const ry = ball.y - source.y;
      const cos = this.aimPivotCos[pivotIdx];
      const sin = this.aimPivotSin[pivotIdx];
      this.aimBallX[ballIdx] = ghost.x + rx * cos - ry * sin;
      this.aimBallY[ballIdx] = ghost.y + rx * sin + ry * cos;
    }
  }

  traceAimTrajectory(startX, startY, angleRad, colorId, specialType, maxDistanceBonus, maxBouncesBonus, isFlipped) {
    const points = this.aimPoints;
    const canvasCfg = this.gameConfig.canvas;
    const ballCfg = this.physicsConfig.ball;
    const sim = this.physicsConfig.simulation;
    const r = ballCfg.radius;
    const minWallY = canvasCfg.wallMargin + r;

    const maxDistance = canvasCfg.aimRayMaxDistance + maxDistanceBonus;
    const maxBounces = canvasCfg.aimRayMaxBounces + maxBouncesBonus;
    const substeps = sim.substeps;
    const dt = 1 / substeps;

    const isAnvil = specialType === SPECIAL_TYPES.ANVIL;
    const speed = isAnvil ? ballCfg.anvilSpeed : ballCfg.projectileSpeed;
    const snapDist = r * sim.projectileSnapDistanceFactor;
    const snapDistSq = snapDist * snapDist;
    const targetDist = r * sim.bondRestDistanceFactor;

    const preview = this.preparePreviewWorld();
    const state = this.aimState;
    state.x = startX;
    state.y = startY;
    state.vx = Math.cos(angleRad) * speed;
    state.vy = Math.sin(angleRad) * speed;
    state.radius = r;
    state.colorId = colorId;
    state.isPolarityFlipped = isFlipped;
    state.portalCooldown = 0;
    state.bounces = 0;
    state.portalWarps = 0;
    state.flightSteps = 0;
    state.warpedThisStep = false;

    points.length = 0;
    this.pushAimPoint(startX, startY, false);

    let traveled = 0;
    let snapTarget = null;
    let landingX = startX;
    let landingY = startY;

    while (traveled < maxDistance && state.bounces <= maxBounces && !this.isFlightExhausted(state)) {
      if (state.flightSteps % substeps === 0) {
        this.advancePreviewObstacles();
      }
      this.advancePreviewBalls(dt);
      state.flightSteps++;

      const prevX = state.x;
      const prevY = state.y;

      this.advanceProjectileMotion(state, dt, isAnvil, null, preview);

      if (state.warpedThisStep) {
        this.pushAimPoint(state.warpFromX, state.warpFromY, false);
        this.pushAimPoint(state.x, state.y, true);
        traveled += Math.hypot(state.warpFromX - prevX, state.warpFromY - prevY);
      } else {
        this.pushAimPoint(state.x, state.y, false);
        traveled += Math.hypot(state.x - prevX, state.y - prevY);
      }

      landingX = state.x;
      landingY = state.y;

      if (isAnvil && state.y <= minWallY) {
        landingY = minWallY;
        break;
      }

      if (!isAnvil) {
        const hitIndex = this.findNearestSnapIndex(state.x, state.y, snapDistSq, preview.ballX, preview.ballY);
        if (hitIndex !== NOT_FOUND_INDEX) {
          snapTarget = this.balls[hitIndex];
          const landing = this.computeSnapPosition(
            state.x,
            state.y,
            state.vx,
            state.vy,
            preview.ballX[hitIndex],
            preview.ballY[hitIndex],
            targetDist
          );
          landingX = landing.x;
          landingY = landing.y;
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

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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { configRegistry } from '../src/core/ConfigRegistry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { SeededRandom } from '../src/core/SeededRandom.js';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { Ball } from '../src/entities/Ball.js';
import { Obstacle } from '../src/entities/Obstacle.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { OBSTACLE_TYPES } from '../src/core/Constants.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const campaignConfig = loadJson('./configs/campaign.json');
const campaignTuning = loadJson('./configs/campaignTuning.json');
const fluxConfig = loadJson('./configs/flux.json');
const audioConfig = loadJson('./configs/audio.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('campaign', campaignConfig);
configRegistry.configs.set('audio', audioConfig);

const RADIUS = physicsConfig.ball.radius;
const CENTER_X = gameConfig.canvas.logicalWidth * 0.5;
const DT = 1 / physicsConfig.simulation.substeps;

const createWorld = () => new PhysicsWorld(physicsConfig, gameConfig, ballsConfig);

const createProjectile = (x, y, vx, vy) => {
  const ball = new Ball({ x, y, radius: RADIUS, colorId: 'crimson', isProjectile: true });
  ball.vx = vx;
  ball.vy = vy;
  return ball;
};

const createTestEngine = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  const dummyAudio = {
    playEffect: () => {},
    stopAll: () => {},
    isMuted: () => true,
    setMuted: () => {}
  };
  return new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    campaignConfig,
    campaignTuning,
    fluxConfig,
    audioManager: dummyAudio,
    storageManager,
    onStateChange: () => {}
  });
};

test('Projectile speed stays under the configured cap after repeated bumper bounces', () => {
  const world = createWorld();
  const bumper = new Obstacle({ type: OBSTACLE_TYPES.BUMPER, x: CENTER_X, y: 400 }, obstaclesConfig);
  world.obstacles.push(bumper);
  const cap = physicsConfig.ball.projectileMaxSpeed;
  const projectile = createProjectile(CENTER_X, 0, 0, -physicsConfig.ball.projectileSpeed);
  world.projectile = projectile;

  let bounceCount = 0;
  for (let i = 0; i < 10; i++) {
    const speed = Math.hypot(projectile.vx, projectile.vy);
    projectile.x = CENTER_X;
    projectile.y = bumper.y + bumper.radius + RADIUS + 2;
    projectile.vx = 0;
    projectile.vy = -speed;
    world.step({ onBounce: () => bounceCount++ });
    assert.ok(world.projectile, 'Projectile must still be in flight');
    assert.ok(
      Math.hypot(projectile.vx, projectile.vy) <= cap + 1e-9,
      `Speed ${Math.hypot(projectile.vx, projectile.vy).toFixed(2)} exceeds cap ${cap}`
    );
  }
  assert.ok(bounceCount >= 10, 'Every iteration should bounce off the bumper');
});

test('A very fast projectile does not tunnel through a barrier', () => {
  const world = createWorld();
  const barrier = new Obstacle({ type: OBSTACLE_TYPES.BARRIER, x: CENTER_X, y: 400, width: 200 }, obstaclesConfig);
  world.obstacles.push(barrier);
  const barrierTop = barrier.y - barrier.height * 0.5;
  const projectile = createProjectile(CENTER_X, 470, 0, -400);
  world.projectile = projectile;

  for (let frame = 0; frame < 20 && world.projectile; frame++) {
    world.step({});
    assert.ok(projectile.y > barrierTop, `Projectile crossed the barrier (y=${projectile.y.toFixed(1)})`);
  }
  assert.ok(projectile.vy > 0, 'Projectile should bounce back down off the barrier');

  const inside = { x: CENTER_X, y: barrier.y + 2, vx: 0, vy: -5, radius: RADIUS, colorId: null };
  inside.portalCooldown = 0;
  inside.bounces = 0;
  inside.portalWarps = 0;
  world.resolveBarrierCollision(inside, barrier, RADIUS, null);
  const halfH = barrier.height * 0.5;
  assert.ok(
    inside.y >= barrier.y + halfH + RADIUS - 1e-9 || inside.y <= barrier.y - halfH - RADIUS + 1e-9,
    'A projectile center inside the barrier must be pushed out of it'
  );
  assert.equal(inside.bounces, 1);
});

test('Portal ping-pong flights terminate on the warp budget', () => {
  const world = createWorld();
  world.obstacles.push(
    new Obstacle({ type: OBSTACLE_TYPES.PORTAL, pairId: 'loop', x: CENTER_X, y: 300 }, obstaclesConfig),
    new Obstacle({ type: OBSTACLE_TYPES.PORTAL, pairId: 'loop', x: CENTER_X, y: 600 }, obstaclesConfig)
  );
  const projectile = createProjectile(CENTER_X, 500, 0, -physicsConfig.ball.projectileSpeed);
  world.projectile = projectile;

  let warps = 0;
  let missed = false;
  for (let frame = 0; frame < 2000 && !missed; frame++) {
    world.step({
      onPortalWarp: () => warps++,
      onProjectileMissed: () => {
        missed = true;
      }
    });
  }
  assert.equal(missed, true, 'Looping projectile must end as a miss');
  assert.equal(world.projectile, null);
  assert.equal(warps, physicsConfig.simulation.maxProjectilePortalWarps + 1);

  const preview = world.computeAimTrajectory(CENTER_X, 500, -Math.PI * 0.5, projectile);
  assert.ok(preview.length > 1, 'Aim preview through a portal loop must also terminate');
});

test('Balls without a bond path to a single pivot apply no torque to it', () => {
  const world = createWorld();
  const pivot = new Obstacle({ type: OBSTACLE_TYPES.PIVOT, x: CENTER_X, y: 300, angularSpeed: 0 }, obstaclesConfig);
  world.obstacles.push(pivot);
  world.addBall(new Ball({ x: CENTER_X + 200, y: 150, radius: RADIUS, colorId: 'crimson', isAnchor: true }));
  world.addBall(new Ball({ x: CENTER_X + 150, y: 500, radius: RADIUS, colorId: 'cobalt' }));

  world.applyGravityTorqueToPivots();
  assert.equal(pivot.angularVelocity, 0, 'Unattached balls must not torque the rotor');

  const rotorBall = new Ball({
    x: CENTER_X + 60,
    y: 300,
    radius: RADIUS,
    colorId: 'crimson',
    isAnchor: true,
    pivotRef: pivot,
    pivotRadius: 60
  });
  const hanger = new Ball({ x: CENTER_X + 100, y: 330, radius: RADIUS, colorId: 'cobalt' });
  world.addBall(rotorBall);
  world.addBall(hanger);
  world.createBond(rotorBall, hanger, false);
  world.applyGravityTorqueToPivots();
  const expected = (60 + 100) * physicsConfig.simulation.pivotGravityTorqueFactor;
  assert.ok(Math.abs(pivot.angularVelocity - expected) < 1e-12, 'Connected balls must torque their rotor');
});

test('Injected random source makes avalanche drops reproducible', () => {
  const runAvalanche = () => {
    const world = createWorld();
    const rng = new SeededRandom('2026-10-26');
    world.setRandomSource(() => rng.next());
    for (let i = 0; i < 6; i++) {
      world.addBall(new Ball({ x: 100 + i * 50, y: 200, radius: RADIUS, colorId: 'crimson' }));
    }
    const originalRandom = Math.random;
    Math.random = () => {
      throw new Error('Math.random must not be used by avalanche drops');
    };
    try {
      return world.detachUnanchoredBalls().map((b) => b.vx);
    } finally {
      Math.random = originalRandom;
    }
  };
  const first = runAvalanche();
  const second = runAvalanche();
  assert.equal(first.length, 6);
  assert.deepEqual(first, second);
});

test('Aim preview cache returns the identical result without recomputing when nothing changed', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(4);
  const world = engine.physicsWorld;
  const args = [gameConfig.canvas.launcherX, gameConfig.canvas.launcherY, -Math.PI * 0.4, engine.currentBall];

  const first = world.computeAimTrajectory(...args);
  const snapshot = first.map((p) => [p.x, p.y, p.warpBreak]);
  const landing = [first.landingX, first.landingY, first.snapTarget];
  const countAfterFirst = world.aimTrajectoryComputeCount;

  const second = world.computeAimTrajectory(...args);
  assert.equal(second, first);
  assert.equal(world.aimTrajectoryComputeCount, countAfterFirst, 'Unchanged inputs must not recompute');
  assert.deepEqual(second.map((p) => [p.x, p.y, p.warpBreak]), snapshot);
  assert.deepEqual([second.landingX, second.landingY, second.snapTarget], landing);

  world.computeAimTrajectory(gameConfig.canvas.launcherX, gameConfig.canvas.launcherY, -Math.PI * 0.6, engine.currentBall);
  assert.equal(world.aimTrajectoryComputeCount, countAfterFirst + 1, 'A new aim angle must recompute');

  world.computeAimTrajectory(...args);
  const countBeforeMove = world.aimTrajectoryComputeCount;
  world.balls[0].x += RADIUS;
  world.computeAimTrajectory(...args);
  assert.equal(world.aimTrajectoryComputeCount, countBeforeMove + 1, 'A board change must recompute');
});

test('Snap picks the nearest ball in both simulation and preview', () => {
  const buildWorld = () => {
    const world = createWorld();
    const far = world.addBall(new Ball({ x: CENTER_X, y: 300, radius: RADIUS, colorId: 'cobalt' }));
    const near = world.addBall(new Ball({ x: CENTER_X + 20, y: 345, radius: RADIUS, colorId: 'cobalt' }));
    return { world, far, near };
  };

  const sim = buildWorld();
  const projectile = createProjectile(CENTER_X, 340, 0, 0);
  sim.world.projectile = projectile;
  let snappedOnto = null;
  sim.world.stepProjectile(DT, {
    onProjectileSnapped: (ball, target) => {
      snappedOnto = target;
    }
  });
  assert.equal(snappedOnto, sim.near, 'Simulation must snap onto the nearest ball');

  const preview = buildWorld();
  const path = preview.world.computeAimTrajectory(CENTER_X, 340, -Math.PI * 0.5, null);
  assert.equal(path.snapTarget, preview.near, 'Preview must snap onto the nearest ball');
});

test('Coincident cluster balls are separated deterministically', () => {
  const world = createWorld();
  const a = world.addBall(new Ball({ x: CENTER_X, y: 300, radius: RADIUS, colorId: 'crimson' }));
  const b = world.addBall(new Ball({ x: CENTER_X, y: 300, radius: RADIUS, colorId: 'crimson' }));
  world.step({});
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) > RADIUS, 'Coincident balls must be pushed apart');
});

test('Repulsor fields push hanging spheres away gently, without tearing the cluster', () => {
  const SETTLE_FRAMES = 600;
  /** Minimum average lean, in logical px, for the push to be visible. */
  const MIN_MEAN_LEAN = 2;
  const settle = (fieldFactor) => {
    const original = physicsConfig.simulation.clusterFieldFactor;
    physicsConfig.simulation.clusterFieldFactor = fieldFactor;
    try {
      const engine = createTestEngine();
      engine.startCampaignLevel(14);
      for (let i = 0; i < SETTLE_FRAMES; i++) {
        engine.update();
      }
      const world = engine.physicsWorld;
      return {
        world,
        bonds: world.balls.reduce((total, b) => total + b.bonds.size, 0),
        positions: world.balls.map((b) => ({ x: b.x, y: b.y, isAnchor: b.isAnchor }))
      };
    } finally {
      physicsConfig.simulation.clusterFieldFactor = original;
    }
  };
  const calm = settle(0);
  const pushed = settle(physicsConfig.simulation.clusterFieldFactor);
  assert.ok(physicsConfig.simulation.clusterFieldFactor > 0);
  assert.equal(pushed.positions.length, calm.positions.length, 'no sphere torn off');
  assert.equal(pushed.bonds, calm.bonds, 'no bond broken');

  const repulsor = pushed.world.obstacles.find((o) => o.type === OBSTACLE_TYPES.REPULSOR);
  let awayLean = 0;
  let inField = 0;
  calm.positions.forEach((before, i) => {
    const after = pushed.positions[i];
    if (before.isAnchor || Math.hypot(before.x - repulsor.x, before.y - repulsor.y) >= repulsor.fieldRadius) {
      return;
    }
    const outward = { x: before.x - repulsor.x, y: before.y - repulsor.y };
    const length = Math.hypot(outward.x, outward.y);
    awayLean += ((after.x - before.x) * outward.x + (after.y - before.y) * outward.y) / length;
    inField++;
  });
  assert.ok(inField > 0, 'level 14 hangs spheres inside its repulsor field');
  assert.ok(awayLean / inField > MIN_MEAN_LEAN, `spheres lean away from the repulsor by ${(awayLean / inField).toFixed(1)} px`);
});

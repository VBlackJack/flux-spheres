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
import { Ball } from '../src/entities/Ball.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { generateFluxStage, FLUX_FAMILIES } from '../src/game/layouts/FluxStageGenerator.js';
import { GAME_MODES, GAME_STATES, OBSTACLE_TYPES, CLUSTER_MODIFIERS } from '../src/core/Constants.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = loadJson('./configs/game.json');
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const audioConfig = loadJson('./configs/audio.json');
const fluxConfig = loadJson('./configs/flux.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('audio', audioConfig);
configRegistry.configs.set('flux', fluxConfig);

const BALL_RADIUS = physicsConfig.ball.radius;
const SWEEP_SEED_COUNT = 30;
const SWEEP_STAGE_COUNT = 25;
/**
 * Spirals, crosses, pendulum anchors and nested rings place some bonded balls closer than
 * two radii by design (campaign minimum: 26 px); anything tighter means stacked balls.
 */
const MIN_BALL_DISTANCE_FACTOR = 0.6;
/** Distance from the projectile to a lone remaining ball that should trigger slow motion. */
const NEAR_LAST_BALL_OFFSET = 30;

/** Ball and anchor counts of every campaign level, frozen when layouts moved to the registry. */
const CAMPAIGN_LAYOUT_COUNTS = {
  1: 42,
  2: 34,
  3: 57,
  4: 50,
  5: 57,
  6: 34,
  7: 36,
  8: 32,
  9: 40,
  10: 36,
  11: 36,
  12: 36,
  13: 57,
  14: 50,
  15: 35,
  16: 36
};

const createTestStorage = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  return storageManager;
};

const createFluxEngine = (storageManager = createTestStorage(), onStateChange = () => {}) =>
  new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    fluxConfig,
    audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
    storageManager,
    onStateChange
  });

const obstacleRadius = (type) => obstaclesConfig.types[type]?.radius ?? obstaclesConfig.defaults.radius;

const minPairDistance = (balls) => {
  let min = Infinity;
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      min = Math.min(min, Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y));
    }
  }
  return min;
};

/**
 * Balls turned by a pivot: those bound to it and everything bonded to them, up to fixed
 * anchors (which hold a static shape in place and never rotate).
 */
const collectRotorBalls = (world, pivot) => {
  const queue = world.balls.filter((b) => b.pivotRef === pivot);
  const seen = new Set(queue.map((b) => b.id));
  for (let head = 0; head < queue.length; head++) {
    for (const neighborId of queue[head].bonds) {
      const neighbor = world.ballMap.get(neighborId);
      if (neighbor && !seen.has(neighborId) && !(neighbor.isAnchor && !neighbor.pivotRef)) {
        seen.add(neighborId);
        queue.push(neighbor);
      }
    }
  }
  return queue;
};

const clearBoard = (engine) => {
  for (const ball of [...engine.physicsWorld.balls]) {
    engine.physicsWorld.removeBall(ball);
  }
};

/** Clears the current Flux shape and plays the transition until the next one is built. */
const advanceFluxStage = (engine) => {
  clearBoard(engine);
  engine.evaluateRoundEnd();
  while (engine.stageTransitionFrames > 0) {
    engine.update();
  }
};

test('Campaign layouts built through the registry keep their ball counts and stay fully anchored', () => {
  const engine = createFluxEngine();
  for (const level of levelsConfig.levels) {
    engine.startCampaignLevel(level.id);
    const world = engine.physicsWorld;
    assert.equal(world.balls.length, CAMPAIGN_LAYOUT_COUNTS[level.id], `Level ${level.id} ball count`);
    assert.equal(world.getAnchoredBallIds().size, world.balls.length, `Level ${level.id} has a loose ball`);
  }
});

test('A Flux stage depends only on seed, stage and previous family', () => {
  const options = { seed: 'determinism', previousFamily: FLUX_FAMILIES.MASK, fluxConfig, obstaclesConfig, ballRadius: BALL_RADIUS };
  for (const stage of [1, 5, 12]) {
    assert.deepEqual(generateFluxStage({ ...options, stage }), generateFluxStage({ ...options, stage }));
  }
});

test('A Flux stage never repeats the previous stage family', () => {
  // From the composite family's minimum stage on, every family has an alternative.
  const stage = fluxConfig.composite.minStage;
  for (let seed = 0; seed < SWEEP_SEED_COUNT; seed++) {
    for (const previousFamily of Object.values(FLUX_FAMILIES)) {
      const stageDef = generateFluxStage({
        seed: `family-${seed}`,
        stage,
        previousFamily,
        fluxConfig,
        obstaclesConfig,
        ballRadius: BALL_RADIUS
      });
      assert.notEqual(stageDef.family, previousFamily);
    }
  }
});

test('Generated Flux stages are playable boards across many seeds', () => {
  const engine = createFluxEngine();
  const canvas = gameConfig.canvas;
  const leftWall = canvas.wallMargin;
  const rightWall = canvas.logicalWidth - canvas.wallMargin;
  const lowestAllowedY = canvas.dangerLineY - canvas.dangerWarningMarginY;
  const familiesSeen = new Set();
  let bossStages = 0;

  for (let seed = 0; seed < SWEEP_SEED_COUNT; seed++) {
    engine.startFluxRun(`sweep-${seed}`);
    for (let stage = 1; stage <= SWEEP_STAGE_COUNT; stage++) {
      if (stage > 1) {
        engine.fluxPreviousFamily = engine.fluxFamily;
        engine.fluxStage = stage;
        engine.buildFluxStage({ persist: false });
      }
      const label = `seed ${seed} stage ${stage} (${engine.fluxShapeIds.join('+')})`;
      const world = engine.physicsWorld;
      const balls = world.balls;
      familiesSeen.add(engine.fluxFamily);

      assert.ok(balls.length > 0, `${label}: empty board`);
      assert.equal(world.getAnchoredBallIds().size, balls.length, `${label}: loose ball`);
      assert.ok(minPairDistance(balls) >= MIN_BALL_DISTANCE_FACTOR * 2 * BALL_RADIUS, `${label}: stacked balls`);

      for (const ball of balls) {
        assert.ok(ball.x - BALL_RADIUS >= leftWall && ball.x + BALL_RADIUS <= rightWall, `${label}: ball outside walls`);
        assert.ok(ball.y + BALL_RADIUS < lowestAllowedY, `${label}: ball too close to the danger line`);
      }

      const pivots = world.obstacles.filter((o) => o.type === OBSTACLE_TYPES.PIVOT);
      const others = world.obstacles.filter((o) => o.type !== OBSTACLE_TYPES.PIVOT);
      for (const obstacle of others) {
        const radius = obstacleRadius(obstacle.type);
        for (const ball of balls) {
          assert.ok(
            Math.hypot(ball.x - obstacle.x, ball.y - obstacle.y) >= radius + BALL_RADIUS,
            `${label}: ball overlaps a ${obstacle.type}`
          );
        }
      }

      // A rotating shape sweeps a disc around its pivot: the disc must fit the board too.
      for (const pivot of pivots) {
        const orbiting = collectRotorBalls(world, pivot);
        if (orbiting.length === 0) {
          continue;
        }
        const reach = Math.max(...orbiting.map((b) => Math.hypot(b.x - pivot.x, b.y - pivot.y))) + BALL_RADIUS;
        assert.ok(pivot.x - reach >= leftWall && pivot.x + reach <= rightWall, `${label}: rotor sweeps into a wall`);
        assert.ok(pivot.y - reach >= 0 && pivot.y + reach < lowestAllowedY, `${label}: rotor sweeps off the board`);
        for (const obstacle of others) {
          assert.ok(
            Math.hypot(obstacle.x - pivot.x, obstacle.y - pivot.y) >= reach + obstacleRadius(obstacle.type),
            `${label}: rotor sweeps over a ${obstacle.type}`
          );
        }
      }

      const bossCores = balls.filter((b) => b.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE).length;
      assert.equal(bossCores, engine.fluxIsBossStage ? 1 : 0, `${label}: boss core count`);
      bossStages += engine.fluxIsBossStage ? 1 : 0;
    }
  }

  assert.deepEqual([...familiesSeen].sort(), Object.values(FLUX_FAMILIES).sort());
  assert.ok(bossStages > 0, 'The sweep must reach boss stages');
});

test('Clearing a Flux shape pays once, refills shots and brings in the next shape', () => {
  const engine = createFluxEngine();
  engine.startFluxRun('flow');
  const rewards = fluxConfig.rewards;
  const shotsBefore = engine.shotsRemaining;

  clearBoard(engine);
  engine.evaluateRoundEnd();
  engine.evaluateRoundEnd();

  assert.equal(engine.fluxStage, 2);
  assert.equal(engine.score, rewards.stageClearPointsBase + rewards.stageClearPointsPerStage);
  assert.equal(engine.shotsRemaining, shotsBefore + engine.getFluxShotRefill(1));
  assert.equal(engine.stageTransitionFrames, fluxConfig.transition.clearFrames);

  for (let frame = 0; frame < fluxConfig.transition.clearFrames; frame++) {
    engine.update();
  }
  assert.equal(engine.stageTransitionFrames, 0);
  assert.ok(engine.physicsWorld.balls.length > 0, 'The next shape is built');
  assert.equal(engine.stageIntroFrames, fluxConfig.transition.introFrames);

  const shotsAtIntro = engine.shotsRemaining;
  engine.shoot();
  assert.equal(engine.physicsWorld.projectile, null, 'Shooting waits for the shape to land');
  assert.equal(engine.shotsRemaining, shotsAtIntro);

  for (let frame = 0; frame < fluxConfig.transition.introFrames; frame++) {
    engine.update();
  }
  engine.shoot();
  assert.ok(engine.physicsWorld.projectile, 'Shooting resumes once the shape is in place');
  assert.equal(engine.shotsRemaining, shotsAtIntro - 1);
});

test('A Flux run with an empty reserve ends in Game Over after the grace period', () => {
  let lastExtra = {};
  const engine = createFluxEngine(createTestStorage(), (_engine, extra) => {
    lastExtra = extra;
  });
  engine.startFluxRun('empty-reserve');
  engine.shotsRemaining = 0;
  engine.evaluateRoundEnd();
  assert.ok(engine.outOfShotsGraceFrames > 0);

  for (let frame = 0; frame < physicsConfig.simulation.outOfShotsGraceFrames + 1; frame++) {
    engine.update();
  }
  assert.equal(engine.state, GAME_STATES.GAME_OVER);
  assert.equal(lastExtra.gameOverReason, 'outOfShots');
});

test('A Flux run saved on a later stage resumes on the same shape', () => {
  const storage = createTestStorage();
  const engine = createFluxEngine(storage);
  engine.startFluxRun('resume');
  advanceFluxStage(engine);
  advanceFluxStage(engine);
  assert.equal(engine.fluxStage, 3);
  assert.ok(storage.loadRunSnapshot(), 'Building a new stage stores the run');

  const resumed = createFluxEngine(storage);
  assert.equal(resumed.restoreSavedRun(), true);
  assert.equal(resumed.mode, GAME_MODES.FLUX);
  assert.equal(resumed.state, GAME_STATES.PAUSED);
  assert.equal(resumed.fluxSeed, 'resume');
  assert.equal(resumed.fluxStage, 3);
  assert.deepEqual(resumed.fluxShapeIds, engine.fluxShapeIds);
  assert.deepEqual(
    resumed.physicsWorld.obstacles.map((o) => o.type),
    engine.physicsWorld.obstacles.map((o) => o.type)
  );
  assert.equal(resumed.physicsWorld.balls.length, engine.physicsWorld.balls.length);
  assert.equal(resumed.shotsRemaining, engine.shotsRemaining);
  assert.equal(resumed.score, engine.score);
});

test('Time slows down when a shot nears one of the last spheres, unless motion is reduced', () => {
  const engine = createFluxEngine();
  engine.startFluxRun('slow-motion');
  const world = engine.physicsWorld;
  const slowMotion = gameConfig.juice.slowMotion;

  const target = world.balls[0];
  world.projectile = new Ball({ x: target.x, y: target.y + NEAR_LAST_BALL_OFFSET, radius: BALL_RADIUS, colorId: target.colorId });
  assert.equal(engine.getTimeScale(), 1, 'A full board keeps normal speed');

  for (const ball of world.balls.slice(slowMotion.maxRemainingBalls)) {
    world.removeBall(ball);
  }
  assert.equal(engine.getTimeScale(), slowMotion.timeScale);

  engine.setReducedMotion(true);
  assert.equal(engine.getTimeScale(), 1);
});

test('Flux records keep the best score and the furthest stage independently', () => {
  const storage = createTestStorage();
  storage.setFluxRecord(1000, 3);
  storage.setFluxRecord(500, 7);
  assert.equal(storage.getFluxHighScore(), 1000);
  assert.equal(storage.getFluxBestStage(), 7);
});

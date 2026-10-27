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
import { SpatialHashGrid } from '../src/physics/SpatialHashGrid.js';
import { Ball } from '../src/entities/Ball.js';
import { Obstacle } from '../src/entities/Obstacle.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { Renderer } from '../src/game/Renderer.js';
import {
  GAME_MODES,
  SPECIAL_TYPES,
  CLUSTER_MODIFIERS,
  OBSTACLE_TYPES
} from '../src/core/Constants.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = loadJson('./configs/game.json');
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const audioConfig = loadJson('./configs/audio.json');
const enLocale = loadJson('./locales/en.json');
const frLocale = loadJson('./locales/fr.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('audio', audioConfig);

const collectLeafKeys = (obj, prefix = '') => {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectLeafKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys.sort();
};

const createTestStorage = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  return storageManager;
};

const createTestEngine = (storageManager = createTestStorage()) => {
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
    audioManager: dummyAudio,
    storageManager,
    onStateChange: () => {}
  });
};

test('i18n dictionaries (en.json and fr.json) have 100% identical key structures', () => {
  const enKeys = collectLeafKeys(enLocale);
  const frKeys = collectLeafKeys(frLocale);
  assert.deepEqual(frKeys, enKeys);
});

test('SeededRandom produces deterministic sequences for identical seeds', () => {
  const rngA = new SeededRandom('2026-10-26');
  const rngB = new SeededRandom('2026-10-26');
  for (let i = 0; i < 25; i++) {
    assert.equal(rngA.next(), rngB.next());
  }
});

test('SpatialHashGrid finds all close neighbor pairs accurately', () => {
  const grid = new SpatialHashGrid(60);
  const balls = [
    new Ball({ x: 100, y: 100, radius: 20, colorId: 'crimson' }),
    new Ball({ x: 135, y: 100, radius: 20, colorId: 'crimson' }),
    new Ball({ x: 400, y: 400, radius: 20, colorId: 'cobalt' })
  ];
  const pairs = [];
  grid.forEachNeighborPair(balls, (a, b) => {
    pairs.push([a.id, b.id]);
  });
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0], [balls[0].id, balls[1].id]);
});

test('Every campaign level initializes, steps physics, and computes trajectories', () => {
  const engine = createTestEngine();
  assert.deepEqual(
    levelsConfig.levels.map((l) => l.id),
    levelsConfig.levels.map((_, index) => index + 1),
    'level ids run from 1 to the level count'
  );
  for (const lvl of levelsConfig.levels) {
    engine.startCampaignLevel(lvl.id);
    for (let i = 0; i < 8; i++) {
      engine.update();
    }
    assert.ok(engine.aimPoints.length >= 2, `Level ${lvl.id} should have valid aim trajectory`);
  }
});

test('Polarity flip inverts magnetic projectile curve pull and updates trajectory', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(4);
  engine.updateAim(220, 300);
  const normalLandingX = engine.aimPoints.landingX;
  engine.togglePolarityFlip();
  assert.equal(engine.isPolarityFlipped, true);
  const flippedLandingX = engine.aimPoints.landingX;
  assert.notEqual(flippedLandingX, normalLandingX);
});

test('Destroying all LASER_LOCK balls disables BARRIER obstacles in the level', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(13);
  const barriers = engine.physicsWorld.obstacles.filter((o) => o.type === OBSTACLE_TYPES.BARRIER);
  assert.ok(barriers.length > 0);
  assert.equal(barriers[0].disabled, false);

  const lockBalls = engine.physicsWorld.balls.filter(
    (b) => b.clusterModifier === CLUSTER_MODIFIERS.LASER_LOCK
  );
  for (const lb of lockBalls) {
    engine.destroyClusterBall(lb, '#38bdf8', true);
  }
  assert.equal(barriers[0].disabled, true);
});

test('Singularity obstacle captures dropping balls and grants bonus score & overcharge', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(14);
  const sing = engine.physicsWorld.obstacles.find((o) => o.type === OBSTACLE_TYPES.SINGULARITY);
  assert.ok(sing);

  const droppingBall = new Ball({ x: sing.x, y: sing.y - 10, radius: 20, colorId: 'crimson' });
  droppingBall.isDropping = true;
  engine.physicsWorld.droppingBalls.push(droppingBall);

  const prevScore = engine.score;
  const prevOvercharge = engine.overcharge;
  engine.update();

  assert.ok(engine.score > prevScore);
  assert.ok(engine.overcharge > prevOvercharge);
  assert.equal(engine.physicsWorld.droppingBalls.length, 0);
});

test('Daily Challenge initializes deterministically with active mutator', () => {
  const engineA = createTestEngine();
  const engineB = createTestEngine();
  engineA.startDailyChallenge('2026-10-26');
  engineB.startDailyChallenge('2026-10-26');

  assert.equal(engineA.mode, GAME_MODES.DAILY);
  assert.ok(engineA.activeMutatorKey);
  assert.equal(engineA.activeMutatorKey, engineB.activeMutatorKey);
  assert.equal(engineA.physicsWorld.balls.length, engineB.physicsWorld.balls.length);
  assert.equal(engineA.physicsWorld.balls[0].colorId, engineB.physicsWorld.balls[0].colorId);
});

test('ParticleSystem object pooling recycles particles on clear and update', () => {
  const engine = createTestEngine();
  engine.particleSystem.spawnBurst(200, 200, '#ffffff', 10, 5);
  assert.equal(engine.particleSystem.particles.length, 10);
  engine.particleSystem.clear();
  assert.equal(engine.particleSystem.particles.length, 0);
  assert.equal(engine.particleSystem.particlePool.length, 10);
  engine.particleSystem.spawnBurst(200, 200, '#ffffff', 5, 5);
  assert.equal(engine.particleSystem.particlePool.length, 5);
});

test('Special ball equip and unequip restores original regular ball and inventory count', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const originalColor = engine.currentBall.colorId;
  const initialBombCount = engine.specialInventory[SPECIAL_TYPES.BOMB];
  assert.ok(initialBombCount >= 1);

  engine.equipSpecialBall(SPECIAL_TYPES.BOMB);
  assert.equal(engine.currentBall.specialType, SPECIAL_TYPES.BOMB);
  assert.equal(engine.specialInventory[SPECIAL_TYPES.BOMB], initialBombCount - 1);

  engine.equipSpecialBall(SPECIAL_TYPES.BOMB);
  assert.equal(engine.currentBall.specialType, null);
  assert.equal(engine.currentBall.colorId, originalColor);
  assert.equal(engine.specialInventory[SPECIAL_TYPES.BOMB], initialBombCount);
});

test('Tutorial banner stays active until dismissed and levelTutorialKey persists for Pause modal', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  assert.equal(engine.activeTutorialKey, 'gameplay.tutorial.pendulum');
  assert.equal(engine.levelTutorialKey, 'gameplay.tutorial.pendulum');

  engine.dismissTutorial();
  assert.equal(engine.activeTutorialKey, null);
  assert.equal(engine.levelTutorialKey, 'gameplay.tutorial.pendulum');
});

test('PhysicsWorld.findDetachedIfRemoved accurately predicts avalanche balls when anchors are severed', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const anchors = engine.physicsWorld.balls.filter((b) => b.isAnchor);
  assert.ok(anchors.length >= 2);
  const anchorIds = new Set(anchors.map((a) => a.id));
  const predictedDrops = engine.physicsWorld.findDetachedIfRemoved(anchorIds);
  assert.equal(predictedDrops.length, engine.physicsWorld.balls.length - anchors.length);
});

test('Daily play bonus is claimed once per date and buySpecialAmmo consumes coins to add ammo', () => {
  const engine = createTestEngine();
  engine.storageManager.setCoins(100);
  engine.startDailyChallenge('2026-10-26');
  const coinsAfterFirstDaily = engine.storageManager.getCoins();
  assert.equal(coinsAfterFirstDaily, 100 + gameConfig.daily.firstPlayBonusCoins);

  engine.startDailyChallenge('2026-10-26');
  assert.equal(engine.storageManager.getCoins(), coinsAfterFirstDaily);

  const prevBombCount = engine.specialInventory[SPECIAL_TYPES.BOMB];
  const bought = engine.buySpecialAmmo(SPECIAL_TYPES.BOMB);
  assert.equal(bought, true);
  assert.equal(engine.specialInventory[SPECIAL_TYPES.BOMB], prevBombCount + 1);
  assert.equal(engine.storageManager.getCoins(), coinsAfterFirstDaily - gameConfig.specialShopCosts.bomb);
});

test('Reduced motion setting disables screen shake while preserving particle updates', () => {
  const engine = createTestEngine();
  engine.setReducedMotion(true);
  engine.particleSystem.addScreenShake(10);
  assert.equal(engine.particleSystem.shakeIntensity, 0);
  engine.setReducedMotion(false);
  engine.particleSystem.addScreenShake(8);
  assert.equal(engine.particleSystem.shakeIntensity, 8);
});

test('SpatialHashGrid hashCoords has zero collisions across negative and positive cell coordinates', () => {
  const grid = new SpatialHashGrid(60);
  const seenKeys = new Set();
  for (let cx = -25; cx <= 25; cx++) {
    for (let cy = -25; cy <= 25; cy++) {
      const key = grid.hashCoords(cx, cy);
      assert.equal(seenKeys.has(key), false, `Collision detected at (${cx}, ${cy})`);
      seenKeys.add(key);
    }
  }
  const topLeftBalls = [
    new Ball({ x: 15, y: 15, radius: 20, colorId: 'crimson' }),
    new Ball({ x: 85, y: 85, radius: 20, colorId: 'crimson' })
  ];
  let visitCount = 0;
  grid.forEachNeighborPair(topLeftBalls, () => {
    visitCount++;
  });
  assert.equal(visitCount, 1);
});

test('Campaign victory on the final level caps unlockedLevel at that level and awards stars and coins', () => {
  const engine = createTestEngine();
  const finalLevel = levelsConfig.levels.at(-1);
  engine.startCampaignLevel(finalLevel.id);
  const initialCoins = engine.storageManager.getCoins();
  engine.score = finalLevel.starThresholds.at(-1);
  engine.shotsRemaining = 14;
  engine.physicsWorld.clear();
  engine.evaluateRoundEnd();

  assert.equal(engine.state, 'victory');
  assert.equal(engine.storageManager.getUnlockedLevel(), finalLevel.id);
  assert.ok(engine.storageManager.getCoins() > initialCoins);
  assert.equal(engine.storageManager.getUnlockedAchievements().sharpshooter, true);
});

test('Game Over triggers on danger line breach and when out-of-shots grace period expires', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const lowBall = engine.physicsWorld.balls[0];
  lowBall.y = gameConfig.canvas.dangerLineY;
  engine.checkDangerLineBreach();
  assert.equal(engine.state, 'game_over');

  const engine2 = createTestEngine();
  engine2.startCampaignLevel(1);
  engine2.hasFiredInRound = true;
  engine2.shotsRemaining = 0;
  engine2.evaluateRoundEnd();
  assert.ok(engine2.outOfShotsGraceFrames > 0);
  while (engine2.outOfShotsGraceFrames > 0) {
    engine2.update();
  }
  assert.equal(engine2.state, 'game_over');
});

test('Daily Challenge spawns central rotor, applies Turbo Rotors multiplier, and scopes daily record by date', () => {
  const engine = createTestEngine();
  engine.startDailyChallenge('2026-10-27');
  const pivot = engine.physicsWorld.obstacles.find((o) => o.type === OBSTACLE_TYPES.PIVOT);
  assert.ok(pivot, 'Daily challenge should include a central inertia rotor');

  const balls = engine.physicsWorld.balls;
  const minAllowedDist = physicsConfig.ball.radius * 2 - 1e-4;
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const dist = Math.hypot(balls[j].x - balls[i].x, balls[j].y - balls[i].y);
      assert.ok(
        dist >= minAllowedDist,
        `Overlapping balls at start of Daily Challenge: dist=${dist.toFixed(2)} < ${minAllowedDist}`
      );
    }
  }

  const prevPivotY = pivot.y;
  engine.spawnEndlessWave();
  assert.equal(pivot.y, prevPivotY + gameConfig.endless.descentStepY);
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      if (!balls[i].pivotRef && !balls[j].pivotRef) {
        continue;
      }
      const dist = Math.hypot(balls[j].x - balls[i].x, balls[j].y - balls[i].y);
      assert.ok(
        dist >= minAllowedDist,
        `Rotor overlaps grid after Daily wave descent: dist=${dist.toFixed(2)} < ${minAllowedDist}`
      );
    }
  }

  engine.addScore(1500);
  engine.persistRunHighScore();
  assert.ok(engine.storageManager.getDailyHighScore('2026-10-27') >= 1500);
  assert.equal(engine.storageManager.getDailyHighScore('2026-10-28'), 0);
});

test('StorageManager handles corrupted JSON gracefully and caches upgrade levels in memory', () => {
  const engine = createTestEngine();
  const sm = engine.storageManager;
  sm.safeSetItem(gameConfig.storage.keys.levelStats, '{corrupted_json');
  sm.safeSetItem(gameConfig.storage.keys.achievements, '{corrupted_json');
  sm.safeSetItem(gameConfig.storage.keys.upgrades, '{corrupted_json');
  sm.upgradesCache = null;

  assert.deepEqual(sm.getLevelStats(), {});
  assert.deepEqual(sm.getUnlockedAchievements(), {});
  assert.equal(sm.getUpgradeLevel('laserSight'), 0);

  sm.setCoins(500);
  assert.equal(sm.purchaseUpgrade('laserSight'), true);
  assert.equal(sm.getUpgradeLevel('laserSight'), 1);
});

test('Repulsor, Attractor, and Singularity obstacles noticeably deflect projectile trajectories', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.physicsWorld.balls = [];
  engine.physicsWorld.ballMap.clear();

  const startX = gameConfig.canvas.launcherX;
  const startY = gameConfig.canvas.launcherY;
  const angle = -Math.PI * 0.5;

  // 1. Repulsor placed slightly to the right of the vertical firing line pushes projectile to the left
  engine.physicsWorld.obstacles = [
    new Obstacle({ type: OBSTACLE_TYPES.REPULSOR, x: startX + 45, y: 420 }, obstaclesConfig)
  ];
  const repulsorTraj = engine.physicsWorld.computeAimTrajectory(startX, startY, angle, engine.currentBall);
  assert.ok(
    repulsorTraj.landingX < startX - 80,
    `Repulsor should strongly deflect shot to the left (landingX=${repulsorTraj.landingX.toFixed(1)})`
  );

  // 2. Attractor placed slightly to the right pulls projectile to the right
  engine.physicsWorld.obstacles = [
    new Obstacle({ type: OBSTACLE_TYPES.ATTRACTOR, x: startX + 55, y: 420 }, obstaclesConfig)
  ];
  const attractorTraj = engine.physicsWorld.computeAimTrajectory(startX, startY, angle, engine.currentBall);
  assert.ok(
    attractorTraj.landingX > startX + 80,
    `Attractor should strongly curve shot to the right (landingX=${attractorTraj.landingX.toFixed(1)})`
  );

  // 3. Singularity placed slightly to the left pulls projectile to the left
  engine.physicsWorld.obstacles = [
    new Obstacle({ type: OBSTACLE_TYPES.SINGULARITY, x: startX - 55, y: 450 }, obstaclesConfig)
  ];
  const singularityTraj = engine.physicsWorld.computeAimTrajectory(startX, startY, angle, engine.currentBall);
  assert.ok(
    singularityTraj.landingX < startX - 70,
    `Singularity should noticeably curve shot toward its gravity well (landingX=${singularityTraj.landingX.toFixed(1)})`
  );
});

test('Ceiling acts as a wall and bounces projectile downward instead of snapping to it', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.physicsWorld.balls = [];
  engine.physicsWorld.ballMap.clear();
  engine.physicsWorld.obstacles = [];

  engine.updateAim(gameConfig.canvas.launcherX, gameConfig.canvas.launcherY - 250);
  engine.shoot();
  assert.ok(engine.physicsWorld.projectile, 'Projectile should be active after shooting');

  let bouncedDownward = false;
  for (let frame = 0; frame < 65; frame++) {
    engine.physicsWorld.step({});
    if (engine.physicsWorld.projectile && engine.physicsWorld.projectile.vy > 0) {
      bouncedDownward = true;
      break;
    }
  }
  assert.equal(bouncedDownward, true, 'Projectile should bounce off the ceiling with positive vertical velocity');
  assert.equal(engine.physicsWorld.balls.length, 0, 'Projectile must not stick or snap to the ceiling');
});

test('Spiral and Cross rotor levels remain structurally stable without playing and tension breaks trigger avalanches', () => {
  const engine = createTestEngine();

  for (const levelId of [8, 9, 15]) {
    engine.startCampaignLevel(levelId);
    const initialCount = engine.physicsWorld.balls.length;
    for (let frame = 0; frame < 350; frame++) {
      engine.update();
    }
    assert.equal(engine.state, 'playing', `Level ${levelId} must not trigger Game Over while idle`);
    assert.equal(engine.physicsWorld.balls.length, initialCount, `Level ${levelId} must not lose balls while idle`);
    const maxY = Math.max(...engine.physicsWorld.balls.map((b) => b.y + b.radius));
    assert.ok(
      maxY < gameConfig.canvas.dangerLineY - 180,
      `Level ${levelId} cluster should stay well above danger line (maxY=${maxY.toFixed(1)})`
    );
  }

  // Verify that if a bond snaps under tension after firing, unanchored balls become a dropping avalanche
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();
  const anchor = new Ball({ x: 270, y: 100, radius: 20, colorId: 'red', isAnchor: true });
  const mid = new Ball({ x: 270, y: 140, radius: 20, colorId: 'blue', isAnchor: false });
  const low = new Ball({ x: 270, y: 260, radius: 20, colorId: 'green', isAnchor: false });
  engine.physicsWorld.addBall(anchor);
  engine.physicsWorld.addBall(mid);
  engine.physicsWorld.addBall(low);
  engine.physicsWorld.createBond(anchor, mid, false);
  engine.physicsWorld.createBond(mid, low, false);
  engine.hasFiredInRound = true;
  engine.physicsWorld.allowTensionBreak = true;

  engine.update();
  assert.equal(engine.physicsWorld.balls.includes(low), false, 'Tension-severed ball should be removed from active cluster');
  assert.equal(engine.physicsWorld.droppingBalls.includes(low), true, 'Tension-severed ball should drop as an avalanche');
  assert.equal(engine.state, 'playing', 'Detached avalanche must not trigger danger line Game Over');
});

test('A run in progress is saved between shots and restored paused with the same board', () => {
  const storage = createTestStorage();
  for (const start of [(e) => e.startCampaignLevel(9), (e) => e.startDailyChallenge('2026-10-26')]) {
    const engine = createTestEngine(storage);
    start(engine);
    engine.shoot();
    for (let frame = 0; frame < 600 && engine.physicsWorld.projectile; frame++) {
      engine.update();
    }
    assert.equal(engine.physicsWorld.projectile, null, 'The shot must resolve before the snapshot is checked');
    assert.ok(storage.loadRunSnapshot(), 'A resolved shot must store the run');

    const resumed = createTestEngine(storage);
    assert.equal(resumed.restoreSavedRun(), true);
    assert.equal(resumed.state, 'paused');
    assert.equal(resumed.mode, engine.mode);
    assert.equal(resumed.score, engine.score);
    assert.equal(resumed.shotsRemaining, engine.shotsRemaining);
    assert.equal(resumed.physicsWorld.balls.length, engine.physicsWorld.balls.length);
    assert.equal(resumed.currentBall.colorId, engine.currentBall.colorId);
    const bondCount = (e) => e.physicsWorld.balls.reduce((sum, b) => sum + b.bonds.size, 0);
    assert.equal(bondCount(resumed), bondCount(engine));
    const pivotLinks = (e) => e.physicsWorld.balls.filter((b) => b.pivotRef).length;
    assert.equal(pivotLinks(resumed), pivotLinks(engine));
    if (engine.seededRng) {
      assert.equal(resumed.seededRng.state, engine.seededRng.state);
    }
  }
});

test('A finished run or a fresh start clears the stored run, and a corrupted one is discarded', () => {
  const storage = createTestStorage();
  const engine = createTestEngine(storage);
  engine.startCampaignLevel(1);
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot();
  assert.ok(storage.loadRunSnapshot());
  engine.triggerGameOver('lineCrossed');
  assert.equal(storage.loadRunSnapshot(), null);

  engine.startCampaignLevel(1);
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot();
  engine.startEndlessMode();
  assert.equal(storage.loadRunSnapshot(), null, 'Starting another run replaces the stored one');

  storage.saveRunSnapshot({ version: storage.getRunSnapshotVersion(), mode: 'campaign', balls: 'broken' });
  const resumed = createTestEngine(storage);
  assert.equal(resumed.restoreSavedRun(), false);
  assert.equal(storage.loadRunSnapshot(), null);
});

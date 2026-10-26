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

test('All 16 Campaign levels initialize, step physics, and compute trajectories', () => {
  const engine = createTestEngine();
  assert.equal(levelsConfig.levels.length, 16);
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

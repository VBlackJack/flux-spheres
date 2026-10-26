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
import { GAME_MODES, GAME_STATES, SPECIAL_TYPES, CLUSTER_MODIFIERS } from '../src/core/Constants.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = loadJson('./configs/game.json');
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const audioConfig = loadJson('./configs/audio.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('audio', audioConfig);

const PAST_DAILY_SEED = '2025-01-01';
const FAR_POSITION = 100;
const OTHER_POSITION = 400;

const createTestEngine = (configOverride = gameConfig) => {
  const storageManager = new StorageManager();
  storageManager.init();
  const dummyAudio = {
    playEffect: () => {},
    stopAll: () => {},
    isMuted: () => true,
    setMuted: () => {}
  };
  return new GameEngine({
    gameConfig: configOverride,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    audioManager: dummyAudio,
    storageManager,
    onStateChange: () => {}
  });
};

const makeBoardBall = (x, y, options = {}) =>
  new Ball({ x, y, radius: physicsConfig.ball.radius, colorId: ballsConfig.standardColors[0].id, ...options });

/**
 * Installs a localStorage double whose writes always fail with a quota error,
 * and returns a function that restores the previous global.
 */
const installQuotaExceededStorage = (initialEntries) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const persisted = new Map(Object.entries(initialEntries));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => (persisted.has(key) ? persisted.get(key) : null),
      setItem: () => {
        throw new Error('QuotaExceededError');
      }
    }
  });
  return () => {
    if (previous) {
      Object.defineProperty(globalThis, 'localStorage', previous);
    } else {
      delete globalThis.localStorage;
    }
  };
};

test('Victory is resolved once: a second evaluateRoundEnd on an empty board credits nothing', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();
  const coinsBefore = engine.storageManager.getCoins();

  engine.evaluateRoundEnd();
  assert.equal(engine.state, GAME_STATES.VICTORY);
  const coinsAfterFirst = engine.storageManager.getCoins();
  const scoreAfterFirst = engine.score;
  assert.ok(coinsAfterFirst > coinsBefore);

  engine.evaluateRoundEnd();
  assert.equal(engine.storageManager.getCoins(), coinsAfterFirst);
  assert.equal(engine.score, scoreAfterFirst);

  engine.addScore(1000);
  assert.equal(engine.score, scoreAfterFirst, 'Score must be frozen after victory');
});

test('Victory keeps the scene animating for the celebration before revealing the modal', () => {
  const engine = createTestEngine();
  const notifications = [];
  engine.onStateChange = (_engine, extra) => notifications.push(extra);
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();
  const fallingBall = makeBoardBall(FAR_POSITION, FAR_POSITION);
  engine.physicsWorld.droppingBalls.push(fallingBall);

  engine.evaluateRoundEnd();
  assert.equal(engine.state, GAME_STATES.VICTORY);
  assert.ok(engine.isVictoryCelebrating());
  assert.ok(engine.victorySummary.stars >= gameConfig.scoring.minVictoryStars);

  engine.update();
  assert.ok(fallingBall.y > FAR_POSITION, 'falling balls keep moving after the victory');

  notifications.length = 0;
  for (let i = 1; i < gameConfig.victory.celebrationFrames; i++) {
    engine.update();
  }
  assert.equal(engine.isVictoryCelebrating(), false);
  assert.equal(notifications.length, 1, 'the UI is notified once, when the celebration ends');

  engine.startCampaignLevel(1);
  assert.equal(engine.victorySummary, null);
});

test('No victory, score or coins after Game Over, even if the board is emptied', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.triggerGameOver('outOfShots');
  const coins = engine.storageManager.getCoins();

  engine.physicsWorld.clear();
  engine.evaluateRoundEnd();
  engine.checkDangerLineBreach();
  engine.detachAndRewardAvalanche();
  engine.addScore(1000);
  engine.addOvercharge(gameConfig.scoring.overchargeMax);

  assert.equal(engine.state, GAME_STATES.GAME_OVER);
  assert.equal(engine.score, 0);
  assert.equal(engine.overcharge, 0);
  assert.equal(engine.storageManager.getCoins(), coins);
});

test('Storage quota failure keeps the debited coin balance authoritative', () => {
  const sm = new StorageManager();
  sm.init();
  const coinsKey = sm.buildKey(gameConfig.storage.keys.coins);
  const restore = installQuotaExceededStorage({ [coinsKey]: '500' });
  try {
    assert.equal(sm.getCoins(), 500);
    const cost = sm.getUpgradeCost('laserSight');
    assert.equal(sm.purchaseUpgrade('laserSight'), true);
    assert.equal(sm.getCoins(), 500 - cost);
    assert.equal(sm.getUpgradeLevel('laserSight'), 1);
  } finally {
    restore();
  }
});

test('Corrupted JSON shapes ("null", arrays, numbers, bad entries) never throw and totals stay numeric', () => {
  const sm = new StorageManager();
  sm.init();
  const keys = gameConfig.storage.keys;

  sm.safeSetItem(keys.levelStats, 'null');
  sm.safeSetItem(keys.achievements, '[1,2,3]');
  sm.safeSetItem(keys.upgrades, '42');
  sm.upgradesCache = null;
  assert.deepEqual(sm.getLevelStats(), {});
  assert.deepEqual(sm.getUnlockedAchievements(), {});
  assert.equal(sm.getTotalStars(), 0);
  assert.equal(sm.getUpgradeLevel('laserSight'), 0);
  assert.equal(sm.unlockAchievement('comboMaster'), true);
  assert.deepEqual(sm.saveLevelResult(1, 100, 2), { newlyEarnedStars: 2 });

  sm.safeSetItem(keys.levelStats, JSON.stringify({ 1: { stars: 'x' }, 2: null, 3: { bestScore: 10, stars: 2 }, 4: [] }));
  const total = sm.getTotalStars();
  assert.equal(Number.isFinite(total), true);
  assert.equal(total, 2);
});

test('buySpecialAmmo is refused once the run is over and does not debit coins', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.storageManager.setCoins(500);
  engine.triggerGameOver('lineCrossed');
  const before = engine.specialInventory[SPECIAL_TYPES.BOMB];

  assert.equal(engine.buySpecialAmmo(SPECIAL_TYPES.BOMB), false);
  assert.equal(engine.storageManager.getCoins(), 500);
  assert.equal(engine.specialInventory[SPECIAL_TYPES.BOMB], before);

  engine.restartCurrent();
  engine.togglePause();
  assert.equal(engine.state, GAME_STATES.PAUSED);
  assert.equal(engine.buySpecialAmmo(SPECIAL_TYPES.BOMB), true);
});

test('Daily restart keeps the running seed and never re-grants the first-play bonus', () => {
  const engine = createTestEngine();
  engine.startDailyChallenge(PAST_DAILY_SEED);
  const coinsAfterStart = engine.storageManager.getCoins();
  const firstColors = engine.physicsWorld.balls.map((b) => b.colorId);

  // Simulate the stored last-played date moving on (UTC midnight rollover in another tab).
  engine.storageManager.safeSetItem(gameConfig.storage.keys.dailyLastPlayedDate, 'rolled-over');
  engine.restartCurrent();

  assert.equal(engine.mode, GAME_MODES.DAILY);
  assert.equal(engine.dailySeedKey, PAST_DAILY_SEED);
  assert.deepEqual(engine.physicsWorld.balls.map((b) => b.colorId), firstColors);
  assert.equal(engine.storageManager.getCoins(), coinsAfterStart);
});

test('A rainbow or freeze shot that hits nothing is not a match', () => {
  for (const specialType of [SPECIAL_TYPES.RAINBOW, SPECIAL_TYPES.FREEZE]) {
    const engine = createTestEngine();
    engine.startCampaignLevel(1);
    engine.physicsWorld.clear();
    engine.physicsWorld.addBall(makeBoardBall(FAR_POSITION, FAR_POSITION, { isAnchor: true }));
    const shot = makeBoardBall(OTHER_POSITION, OTHER_POSITION, { colorId: null, specialType });
    engine.physicsWorld.addBall(shot);

    let reportedMatch = null;
    const originalCleanup = engine.handlePostTurnCleanup.bind(engine);
    engine.handlePostTurnCleanup = (madeMatch, appliedFreeze) => {
      reportedMatch = madeMatch;
      originalCleanup(madeMatch, appliedFreeze);
    };

    engine.handleProjectileSnapped(shot);
    assert.equal(reportedMatch, false, `${specialType} with no target must not count as a match`);
    assert.equal(engine.score, 0, `${specialType} with no target must not score`);
    assert.equal(engine.overcharge, 0);
    assert.equal(engine.hitStopFrames, 0);
  }
});

test('An all-armored match that destroys nothing awards no points and no combo', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();
  const spacing = physicsConfig.ball.radius * physicsConfig.simulation.bondRestDistanceFactor;
  const armorHits = ballsConfig.clusterModifiers.armored.initialArmor;
  const cluster = [0, 1, 2].map((i) =>
    makeBoardBall(FAR_POSITION + i * spacing, FAR_POSITION, { clusterModifier: CLUSTER_MODIFIERS.ARMORED, armorHits })
  );
  cluster.forEach((b) => engine.physicsWorld.addBall(b));

  assert.equal(engine.resolveColorMatchCluster(cluster, cluster[0], false), 0);
  assert.equal(engine.score, 0);
  assert.equal(engine.combo, 0);
  assert.equal(engine.overcharge, 0);
});

test('Survival high score is persisted when the run ends, not on every score event', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  engine.addScore(1000);
  assert.equal(engine.storageManager.getEndlessHighScore(), 0);
  engine.triggerGameOver('lineCrossed');
  assert.equal(engine.storageManager.getEndlessHighScore(), 1000);

  const daily = createTestEngine();
  daily.startDailyChallenge(PAST_DAILY_SEED);
  daily.addScore(500);
  assert.equal(daily.storageManager.getDailyHighScore(PAST_DAILY_SEED), 0);
  daily.startEndlessMode();
  assert.ok(daily.storageManager.getDailyHighScore(PAST_DAILY_SEED) >= 500, 'Leaving a run persists its best');
});

test('bossSlayer achievement honors its configured threshold', () => {
  const config = structuredClone(gameConfig);
  config.achievements.bossSlayer.threshold = 2;
  const engine = createTestEngine(config);
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();

  const spawnBoss = (x) => {
    const boss = makeBoardBall(x, FAR_POSITION, { clusterModifier: CLUSTER_MODIFIERS.BOSS_CORE, armorHits: 1 });
    engine.physicsWorld.addBall(boss);
    return boss;
  };
  const keepBoardBusy = makeBoardBall(OTHER_POSITION, OTHER_POSITION, { isAnchor: true });
  engine.physicsWorld.addBall(keepBoardBusy);

  assert.equal(engine.destroyClusterBall(spawnBoss(FAR_POSITION), '#ffffff', true), true);
  assert.equal(engine.storageManager.getUnlockedAchievements().bossSlayer, undefined);
  assert.equal(engine.destroyClusterBall(spawnBoss(OTHER_POSITION), '#ffffff', true), true);
  assert.equal(engine.storageManager.getUnlockedAchievements().bossSlayer, true);
});

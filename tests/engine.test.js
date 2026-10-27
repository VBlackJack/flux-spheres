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
import { GAME_MODES, GAME_STATES, SPECIAL_TYPES, CLUSTER_MODIFIERS, OBSTACLE_TYPES } from '../src/core/Constants.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
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

test('Chain reactions resolve one cluster per check so a cascade plays out step by step', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.physicsWorld.clear();
  const world = engine.physicsWorld;
  const spacing = physicsConfig.ball.radius * physicsConfig.simulation.bondRestDistanceFactor;
  const buildCluster = (originX) => {
    const cluster = [0, 1, 2].map((i) => makeBoardBall(originX + i * spacing, FAR_POSITION, { isAnchor: true }));
    cluster.forEach((b) => world.addBall(b));
    world.createBond(cluster[0], cluster[1], false);
    world.createBond(cluster[1], cluster[2], false);
    return cluster;
  };
  const first = buildCluster(FAR_POSITION);
  const second = buildCluster(OTHER_POSITION);
  world.addBall(
    makeBoardBall(FAR_POSITION, OTHER_POSITION, { isAnchor: true, colorId: ballsConfig.standardColors[1].id })
  );
  world.pendingChainCandidateIds.add(first[0].id);
  world.pendingChainCandidateIds.add(second[0].id);

  engine.evaluateAutomaticChainReactions();
  assert.equal(first.some((b) => world.ballMap.has(b.id)), false, 'the first cluster goes off');
  assert.ok(second.every((b) => world.ballMap.has(b.id)), 'the second cluster waits for the next check');
  assert.ok(world.pendingChainCandidateIds.has(second[0].id));

  engine.evaluateAutomaticChainReactions();
  assert.equal(second.some((b) => world.ballMap.has(b.id)), false);
  assert.equal(engine.state, GAME_STATES.PLAYING);
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

test('An anvil crushing a dormant bomb survives the balls the blast removes mid-pass', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(16);
  const world = engine.physicsWorld;
  // Level 16 rolls its modifiers at random; armored neighbours would survive the blast.
  for (const ball of world.balls) {
    ball.clusterModifier = null;
    ball.armorHits = 0;
  }
  // The anvil pass walks the balls from the end, so the bomb is the first one it crushes.
  const bomb = world.balls[world.balls.length - 1];
  bomb.clusterModifier = CLUSTER_MODIFIERS.DORMANT_BOMB;
  const ballsBefore = world.balls.length;
  const anvil = new Ball({
    x: bomb.x,
    y: bomb.y,
    radius: physicsConfig.ball.radius,
    colorId: null,
    specialType: SPECIAL_TYPES.ANVIL,
    isProjectile: true
  });
  anvil.vy = -physicsConfig.ball.anvilSpeed;
  world.projectile = anvil;

  assert.doesNotThrow(() => engine.update());
  assert.equal(world.ballMap.has(bomb.id), false);
  assert.ok(world.balls.length < ballsBefore - 1, 'the blast should remove neighbours of the bomb');
  assert.equal(engine.state, GAME_STATES.PLAYING);
});

test('The energy barrier turns off when the last Lock Core falls in an avalanche', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(13);
  const world = engine.physicsWorld;
  const barriers = world.obstacles.filter((obs) => obs.type === OBSTACLE_TYPES.BARRIER);
  assert.ok(barriers.length > 0, 'level 13 has a barrier');
  world.balls.length = 0;
  world.ballMap.clear();
  world.addBall(makeBoardBall(OTHER_POSITION, FAR_POSITION, { isAnchor: true }));
  // A lone Lock Core with no bond to an anchor falls on the next avalanche check.
  world.addBall(makeBoardBall(FAR_POSITION, FAR_POSITION, { clusterModifier: CLUSTER_MODIFIERS.LASER_LOCK }));

  engine.detachAndRewardAvalanche();

  assert.ok(barriers.every((obs) => obs.disabled), 'no Lock Core is left, so the barrier must be off');
});

test('A barrier without any Lock Core stays up after an avalanche', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(5);
  const world = engine.physicsWorld;
  const barriers = world.obstacles.filter((obs) => obs.type === OBSTACLE_TYPES.BARRIER);
  world.balls.length = 0;
  world.ballMap.clear();
  world.addBall(makeBoardBall(OTHER_POSITION, FAR_POSITION, { isAnchor: true }));
  world.addBall(makeBoardBall(FAR_POSITION, FAR_POSITION));

  engine.detachAndRewardAvalanche();

  assert.ok(barriers.length > 0 && barriers.every((obs) => !obs.disabled));
});

test('Launcher colors that left the board are replaced on both balls and in the stash', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const world = engine.physicsWorld;
  const [boardColor, clearedColor] = ballsConfig.standardColors.map((c) => c.id);
  world.balls.length = 0;
  world.ballMap.clear();
  world.addBall(makeBoardBall(FAR_POSITION, FAR_POSITION, { isAnchor: true, colorId: boardColor }));
  engine.currentBall.colorId = clearedColor;
  engine.nextBall.colorId = clearedColor;
  engine.stashedRegularColorId = clearedColor;

  engine.refreshStaleLauncherColors();

  assert.equal(engine.currentBall.colorId, boardColor);
  assert.equal(engine.nextBall.colorId, boardColor);
  assert.equal(engine.stashedRegularColorId, boardColor);
});

test('An anvil that crushes nothing breaks the combo and counts toward the next wave', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  const world = engine.physicsWorld;
  world.balls.length = 0;
  world.ballMap.clear();
  world.addBall(makeBoardBall(OTHER_POSITION, FAR_POSITION, { isAnchor: true }));
  engine.combo = 3;
  engine.shotsUntilWave = engine.gameConfig.endless.shotsBeforeWave;
  const wavesBefore = engine.shotsUntilWave;
  const anvil = new Ball({
    x: FAR_POSITION,
    y: engine.gameConfig.canvas.launcherY,
    radius: physicsConfig.ball.radius,
    colorId: null,
    specialType: SPECIAL_TYPES.ANVIL,
    isProjectile: true
  });
  anvil.vy = -physicsConfig.ball.anvilSpeed;
  world.projectile = anvil;
  engine.anvilCrushCount = 0;

  const maxFrames = 1000;
  for (let frame = 0; frame < maxFrames && world.projectile; frame++) {
    engine.update();
  }

  assert.equal(world.projectile, null, 'the anvil leaves the board');
  assert.equal(engine.combo, 0);
  assert.equal(engine.shotsUntilWave, wavesBefore - 1);
});

test('Coins earned while a shot is in flight are written only once the run is saved again', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const coinsBefore = engine.storageManager.getCoins();
  engine.hasFiredInRound = true;
  engine.physicsWorld.projectile = engine.currentBall;

  engine.awardRunCoins(FAR_POSITION);
  assert.equal(engine.storageManager.getCoins(), coinsBefore, 'a reload now would replay the shot');

  engine.physicsWorld.projectile = null;
  engine.saveRunSnapshot();
  assert.equal(engine.storageManager.getCoins(), coinsBefore + FAR_POSITION);
  assert.equal(engine.pendingRunCoins, 0);
});

test('A write from another tab replaces the cached value instead of being overwritten', () => {
  const storage = new StorageManager();
  storage.init();
  const coinsKey = storage.buildKey(gameConfig.storage.keys.coins);
  const upgradesKey = storage.buildKey(gameConfig.storage.keys.upgrades);
  const otherTabCoins = 300;
  const earnedHere = 5;
  storage.getCoins();
  storage.getUpgrades();

  storage.handleExternalStorageChange({ key: coinsKey, newValue: String(otherTabCoins) });
  storage.addCoins(earnedHere);
  assert.equal(storage.getCoins(), otherTabCoins + earnedHere);

  const upgradeId = Object.keys(gameConfig.upgrades)[0];
  storage.handleExternalStorageChange({ key: upgradesKey, newValue: JSON.stringify({ [upgradeId]: 1 }) });
  assert.equal(storage.getUpgradeLevel(upgradeId), 1);

  storage.handleExternalStorageChange({ key: 'unrelated-app-key', newValue: 'x' });
  storage.handleExternalStorageChange({ key: null, newValue: null });
  assert.equal(storage.memoryFallback.size, 0, 'a storage clear in another tab drops the cache');
});

test('A Boss Core lost in an avalanche pays like a destroyed one', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const world = engine.physicsWorld;
  const bossSpec = ballsConfig.clusterModifiers.bossCore;
  world.balls.length = 0;
  world.ballMap.clear();
  world.addBall(makeBoardBall(OTHER_POSITION, FAR_POSITION, { isAnchor: true }));
  world.addBall(makeBoardBall(FAR_POSITION, FAR_POSITION, { clusterModifier: CLUSTER_MODIFIERS.BOSS_CORE, armorHits: 1 }));
  const coinsBefore = engine.storageManager.getCoins();

  engine.detachAndRewardAvalanche();

  assert.equal(engine.bossesDestroyedInRun, 1);
  assert.ok(engine.score >= bossSpec.pointsBonus);
  assert.ok(engine.storageManager.getCoins() >= coinsBefore + bossSpec.coinReward);
});

test('A zero or missing tuning value that would hang the game is rejected at load', async () => {
  const { validateConfigs } = await import('../src/core/ConfigRegistry.js');
  const configs = new Map([
    ['game', structuredClone(gameConfig)],
    ['physics', structuredClone(physicsConfig)]
  ]);
  assert.doesNotThrow(() => validateConfigs(configs));
  configs.get('game').scoring.overchargeMax = 0;
  assert.throws(() => validateConfigs(configs), /overchargeMax/);
  configs.get('game').scoring.overchargeMax = gameConfig.scoring.overchargeMax;
  delete configs.get('physics').simulation.fixedStepMs;
  assert.throws(() => validateConfigs(configs), /fixedStepMs/);
  configs.get('physics').simulation.fixedStepMs = physicsConfig.simulation.fixedStepMs;

  configs.get('physics').simulation.clusterFieldFactor = 0;
  assert.doesNotThrow(() => validateConfigs(configs), 'fields may be turned off');
  delete configs.get('physics').simulation.clusterFieldFactor;
  assert.throws(() => validateConfigs(configs), /clusterFieldFactor/);
});

test('A saved run whose values have the wrong type is discarded instead of restored', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot();
  const snapshot = engine.storageManager.loadRunSnapshot();
  snapshot.engine.score = '1200';
  engine.storageManager.saveRunSnapshot(snapshot);

  const resumed = createTestEngine();
  resumed.storageManager = engine.storageManager;
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(resumed.restoreSavedRun(), false);
  } finally {
    console.error = originalError;
  }
  assert.equal(engine.storageManager.loadRunSnapshot(), null);
  assert.notEqual(resumed.score, '01200');
});

test('A saved run with its discovery hint dismissed restores without it', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  assert.notEqual(engine.activeDiscoveryId, null, 'a new player gets the basics hint');
  engine.dismissDiscovery();
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot();

  const resumed = createTestEngine();
  resumed.storageManager = engine.storageManager;
  assert.equal(resumed.restoreSavedRun(), true);
  assert.equal(resumed.activeDiscoveryId, null);
});

test('A keyboard aim step locks the aim until the mouse travels past the unlock distance', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const canvasCfg = gameConfig.canvas;
  const unlock = canvasCfg.pointerAimUnlockDistance;

  engine.updateAimFromAngle(-Math.PI / 2);
  engine.adjustAimByDelta(canvasCfg.keyboardAimFineStepRad);
  const lockedAngle = engine.aimAngle;
  assert.ok(Math.abs(lockedAngle + Math.PI / 2 - canvasCfg.keyboardAimFineStepRad) < 1e-9, 'one fine step');

  const origin = { x: 100, y: 300 };
  assert.equal(engine.followPointer(origin.x, origin.y), false, 'the first pointer position only sets the origin');
  assert.equal(engine.followPointer(origin.x + unlock, origin.y), false, 'a small movement keeps the lock');
  assert.equal(engine.aimAngle, lockedAngle);
  assert.equal(engine.followPointer(origin.x + unlock + 1, origin.y), true, 'a long movement lifts the lock');
  assert.equal(engine.isAimLocked, false);
  assert.equal(engine.followPointer(origin.x, origin.y), true, 'the pointer drives the aim again');
});

test('The fine keyboard step is smaller than the Shift step', () => {
  const canvasCfg = gameConfig.canvas;
  assert.ok(canvasCfg.keyboardAimFineStepRad > 0);
  assert.ok(canvasCfg.keyboardAimFineStepRad < canvasCfg.keyboardAimStepRad);
});

test('A new run starts with the aim unlocked', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.adjustAimByDelta(gameConfig.canvas.keyboardAimStepRad);
  assert.equal(engine.isAimLocked, true);
  engine.startCampaignLevel(1);
  assert.equal(engine.isAimLocked, false);
});

/** Lands a sphere next to a bonded neighbor of the level and returns both. */
const landBondedSphere = (engine) => {
  const neighbor = engine.physicsWorld.balls.find((b) => !b.isAnchor && b.bonds.size > 0);
  const landed = engine.physicsWorld.balls.find((b) => neighbor.bonds.has(b.id));
  engine.handleProjectileSnapped(landed, neighbor);
  return { landed, neighbor };
};

test('A landing sphere sends a drawing-only wave through its cluster, weaker one hop away', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const waveCfg = gameConfig.juice.impactWave;
  const before = engine.physicsWorld.balls.map((b) => ({ x: b.x, y: b.y }));

  const neighbor = engine.physicsWorld.balls.find((b) => !b.isAnchor && b.bonds.size > 0);
  const landed = engine.physicsWorld.balls.find((b) => neighbor.bonds.has(b.id));
  engine.startImpactWave(landed);
  assert.equal(engine.impactWave.hops.get(landed.id), 0);
  assert.equal(engine.impactWave.hops.get(neighbor.id), 1);

  let peakLanded = 1;
  let peakNeighbor = 1;
  const lastFrame = waveCfg.maxHops * waveCfg.hopDelayFrames + waveCfg.durationFrames + 1;
  for (let frame = 0; frame < lastFrame; frame++) {
    engine.updateImpactWave();
    peakLanded = Math.max(peakLanded, landed.impactScale);
    peakNeighbor = Math.max(peakNeighbor, neighbor.impactScale);
  }
  assert.ok(peakLanded > 1 && peakLanded <= 1 + waveCfg.amplitude, 'the landed sphere swells');
  assert.ok(peakNeighbor > 1 && peakNeighbor < peakLanded, 'its neighbor swells less');
  assert.equal(engine.impactWave, null, 'the wave ends');
  assert.ok(engine.physicsWorld.balls.every((b) => b.impactScale === 1), 'every sphere is back to scale');
  engine.physicsWorld.balls.forEach((b, i) => {
    assert.equal(b.x, before[i].x);
    assert.equal(b.y, before[i].y);
  });
});

test('Every landing shakes the screen a little and starts a wave, unless motion is reduced', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.particleSystem.shakeIntensity = 0;
  landBondedSphere(engine);
  assert.ok(engine.particleSystem.shakeIntensity >= gameConfig.juice.snapShake, 'a landing shakes the screen');
  assert.notEqual(engine.impactWave, null);

  const calm = createTestEngine();
  calm.setReducedMotion(true);
  calm.startCampaignLevel(1);
  landBondedSphere(calm);
  assert.equal(calm.impactWave, null, 'reduced motion keeps the cluster still');
  assert.equal(calm.particleSystem.shakeIntensity, 0);
});

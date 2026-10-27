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
import { Renderer } from '../src/game/Renderer.js';
import { SeededRandom } from '../src/core/SeededRandom.js';
import { generateLayout, MASK_CELLS } from '../src/game/layouts/LayoutGenerators.js';
import { CLUSTER_MODIFIERS, LAYOUT_TYPES } from '../src/core/Constants.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = loadJson('./configs/game.json');
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const audioConfig = loadJson('./configs/audio.json');
const en = loadJson('./locales/en.json');
const fr = loadJson('./locales/fr.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('audio', audioConfig);

const RADIUS = physicsConfig.ball.radius;
const REST_DISTANCE = RADIUS * physicsConfig.simulation.bondRestDistanceFactor;
const CENTER_X = gameConfig.canvas.logicalWidth / 2;
const TOP_Y = 100;
const [COLOR_A, COLOR_B] = ballsConfig.standardColors.map((c) => c.id);
const NEUTRAL_LEVEL_ID = 17;
const GUARANTEE_ATTEMPTS = 5;

const createEngine = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  const dummyAudio = { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} };
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

/** Starts level 1 and empties its board, leaving a playing run to build test boards on. */
const createEmptyBoard = () => {
  const engine = createEngine();
  engine.startCampaignLevel(1);
  engine.physicsWorld.balls.length = 0;
  engine.physicsWorld.ballMap.clear();
  return engine;
};

const addBall = (engine, x, y, options = {}) =>
  engine.physicsWorld.addBall(new Ball({ x, y, radius: RADIUS, colorId: COLOR_A, ...options }));

/** A horizontal row hanging from an anchor at its left end, each ball bonded to the next. */
const addHangingRow = (engine, colors, anchorOptions = {}) => {
  const world = engine.physicsWorld;
  const anchor = addBall(engine, CENTER_X, TOP_Y, { isAnchor: true, ...anchorOptions });
  const row = colors.map((colorId, index) => addBall(engine, CENTER_X + (index + 1) * REST_DISTANCE, TOP_Y, { colorId }));
  world.createBond(anchor, row[0], false);
  for (let i = 1; i < row.length; i++) {
    world.createBond(row[i - 1], row[i], false);
  }
  return { anchor, row };
};

const neutralAnchorOptions = { colorId: null, clusterModifier: CLUSTER_MODIFIERS.NEUTRAL_ANCHOR };

test('Layout generators mark neutral anchors from pendulum anchors and mask N cells', () => {
  const pendulum = generateLayout({
    type: LAYOUT_TYPES.PENDULUM,
    anchors: [{ x: 100, y: 80 }, { x: 200, y: 80, neutral: true }],
    rows: 1,
    cols: 1,
    startX: 100,
    startY: 120,
    spacingX: 40,
    spacingY: 36
  });
  assert.deepEqual(pendulum.balls.map((b) => b.isNeutral), [false, true, false]);

  const mask = generateLayout({
    type: LAYOUT_TYPES.MASK,
    rows: [`${MASK_CELLS.ANCHOR}${MASK_CELLS.NEUTRAL_ANCHOR}`, MASK_CELLS.BALL],
    centerX: CENTER_X,
    topY: TOP_Y,
    spacing: 40
  });
  assert.deepEqual(mask.balls.map((b) => [b.isAnchor, b.isNeutral]), [[true, false], [true, true], [false, false]]);
});

test('A neutral anchor has no color, never joins a match, and crumbles once nothing hangs from it', () => {
  const engine = createEngine();
  engine.startCampaignLevel(NEUTRAL_LEVEL_ID);
  const neutrals = engine.physicsWorld.balls.filter((b) => b.clusterModifier === CLUSTER_MODIFIERS.NEUTRAL_ANCHOR);
  assert.ok(neutrals.length > 0, 'the introduction level shows neutral anchors');
  assert.ok(neutrals.every((b) => b.colorId === null && b.isAnchor));

  const board = createEmptyBoard();
  const { anchor, row } = addHangingRow(board, [COLOR_A, COLOR_A, COLOR_A], neutralAnchorOptions);
  const keeper = addBall(board, CENTER_X - REST_DISTANCE * 3, TOP_Y, { isAnchor: true, colorId: COLOR_B });
  assert.ok(!board.physicsWorld.findColorCluster(row[0]).includes(anchor));

  assert.equal(board.resolveColorMatchCluster(row, row[0], false), row.length);
  board.detachAndRewardAvalanche();
  assert.equal(board.physicsWorld.ballMap.has(anchor.id), false, 'the emptied neutral anchor crumbled');
  assert.equal(board.physicsWorld.ballMap.has(keeper.id), true);
});

test('A neutral anchor that still holds a ball stays on the board', () => {
  const board = createEmptyBoard();
  const { anchor } = addHangingRow(board, [COLOR_A, COLOR_B], neutralAnchorOptions);
  board.detachAndRewardAvalanche();
  assert.equal(board.physicsWorld.ballMap.has(anchor.id), true);
});

test('A chained ball keeps its links when stretched past the breaking distance', () => {
  for (const isChained of [false, true]) {
    const board = createEmptyBoard();
    const world = board.physicsWorld;
    const anchor = addBall(board, CENTER_X, TOP_Y, { isAnchor: true });
    const mid = addBall(board, CENTER_X, TOP_Y + REST_DISTANCE, {
      colorId: COLOR_B,
      clusterModifier: isChained ? CLUSTER_MODIFIERS.CHAINED : null
    });
    const farY = TOP_Y + RADIUS * physicsConfig.simulation.bondBreakDistanceFactor * 3;
    const far = addBall(board, CENTER_X, farY, { colorId: COLOR_A });
    world.createBond(anchor, mid, false);
    world.createBond(mid, far, false);
    board.hasFiredInRound = true;
    world.allowTensionBreak = true;

    board.update();
    assert.equal(mid.bonds.has(far.id), isChained, isChained ? 'a chain link holds' : 'a plain bond snaps');
  }
});

test('An explosion breaks the chains of the balls that survive it', () => {
  const board = createEmptyBoard();
  const survivor = addBall(board, CENTER_X, TOP_Y, { isAnchor: true, clusterModifier: CLUSTER_MODIFIERS.CHAINED });
  const outside = addBall(board, CENTER_X, TOP_Y + REST_DISTANCE * 4, { clusterModifier: CLUSTER_MODIFIERS.CHAINED });
  board.specialController.breakChainsInBlast(CENTER_X, TOP_Y, RADIUS, board.physicsWorld, board.particleSystem);
  assert.equal(survivor.clusterModifier, null);
  assert.equal(outside.clusterModifier, CLUSTER_MODIFIERS.CHAINED, 'chains outside the blast hold');
});

test('A bubbled ball cannot join a group until a neighbor goes off or a shot hits it', () => {
  const board = createEmptyBoard();
  const { row } = addHangingRow(board, [COLOR_A, COLOR_A, COLOR_A, COLOR_B], { colorId: COLOR_B });
  const bubbled = row[1];
  bubbled.clusterModifier = CLUSTER_MODIFIERS.BUBBLE;
  const world = board.physicsWorld;
  assert.deepEqual(world.findColorCluster(row[0]), [row[0]], 'the bubble splits the group');
  assert.deepEqual(world.findColorCluster(bubbled), [bubbled]);

  board.destroyClusterBall(row[0], COLOR_A, false);
  assert.equal(bubbled.clusterModifier, null, 'destroying a bonded ball popped the bubble');
  assert.ok(world.pendingChainCandidateIds.has(bubbled.id), 'the freed ball is checked for a match');

  const target = row[3];
  target.clusterModifier = CLUSTER_MODIFIERS.BUBBLE;
  const projectile = addBall(board, target.x, target.y + REST_DISTANCE, { colorId: COLOR_B });
  board.handleProjectileSnapped(projectile, target);
  assert.equal(target.clusterModifier, null, 'a shot landing on a bubble pops it');
});

test('A Freeze Core freezes its surroundings without spending a turn of the freeze', () => {
  const board = createEmptyBoard();
  const { row } = addHangingRow(board, [COLOR_A, COLOR_B, COLOR_B]);
  row[0].clusterModifier = CLUSTER_MODIFIERS.FREEZE_CORE;
  board.destroyClusterBall(row[0], COLOR_A, false);
  const turns = ballsConfig.clusterModifiers.freezeCore.freezeTurns;
  assert.equal(board.freezeTurnsRemaining, turns);
  assert.ok(row[1].isFrozen);

  board.handlePostTurnCleanup(true);
  assert.equal(board.freezeTurnsRemaining, turns, 'the turn the core went off does not count');
  board.handlePostTurnCleanup(true);
  assert.equal(board.freezeTurnsRemaining, turns - 1);
});

test('A Lightning Core destroys the balls in its row', () => {
  const board = createEmptyBoard();
  const { anchor, row } = addHangingRow(board, [COLOR_A, COLOR_B, COLOR_B, COLOR_A]);
  const below = addBall(board, CENTER_X, TOP_Y + REST_DISTANCE * 4, { colorId: COLOR_B });
  row[0].clusterModifier = CLUSTER_MODIFIERS.LIGHTNING_CORE;
  board.destroyClusterBall(row[0], COLOR_A, false);
  for (const ball of [anchor, ...row]) {
    assert.equal(board.physicsWorld.ballMap.has(ball.id), false, 'the whole row is struck');
  }
  assert.equal(board.physicsWorld.ballMap.has(below.id), true, 'a ball outside the band survives');
});

test('A Paint Core repaints nearby colored balls in its color and queues them for a match', () => {
  const board = createEmptyBoard();
  // The paint reaches the core's direct neighbors only: row[2] sits two bonds away.
  const { anchor, row } = addHangingRow(board, [COLOR_A, COLOR_B, COLOR_B], neutralAnchorOptions);
  row[0].clusterModifier = CLUSTER_MODIFIERS.PAINT_CORE;
  board.destroyClusterBall(row[0], COLOR_A, false);
  assert.equal(row[1].colorId, COLOR_A);
  assert.ok(board.physicsWorld.pendingChainCandidateIds.has(row[1].id));
  assert.equal(row[2].colorId, COLOR_B, 'a ball out of reach keeps its color');
  assert.equal(anchor.colorId, null, 'a neutral anchor is never painted');
});

test('Introduction levels always show the mechanic they introduce', () => {
  for (const level of levelsConfig.levels.filter((l) => l.minModifierCounts)) {
    for (let attempt = 0; attempt < GUARANTEE_ATTEMPTS; attempt++) {
      const engine = createEngine();
      engine.startCampaignLevel(level.id);
      for (const [modKey, minCount] of Object.entries(level.minModifierCounts)) {
        const count = engine.physicsWorld.balls.filter((b) => b.clusterModifier === modKey).length;
        assert.ok(count >= minCount, `level ${level.id} shows ${count} ${modKey}, expected ${minCount}`);
      }
    }
  }
});

test('A saved run keeps neutral anchors, colorless, and every new modifier', () => {
  const finalLevel = levelsConfig.levels.at(-1).id;
  const engine = createEngine();
  engine.startCampaignLevel(finalLevel);
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot();

  const resumed = createEngine();
  resumed.storageManager = engine.storageManager;
  assert.equal(resumed.restoreSavedRun(), true);
  const describe = (e) =>
    e.physicsWorld.balls.map((b) => `${b.clusterModifier}:${b.colorId}:${b.isAnchor}`).sort();
  assert.deepEqual(describe(resumed), describe(engine));
});

test('Survival waves roll chains, bubbles and the three new cores', () => {
  const engine = createEngine();
  const seen = new Set();
  const waves = 40;
  engine.startEndlessMode();
  // Survival rolls with Math.random; a fixed seed keeps this sweep from ever being unlucky.
  engine.seededRng = new SeededRandom('survival-sweep');
  for (let wave = 0; wave < waves; wave++) {
    engine.spawnEndlessWave();
    for (const ball of engine.physicsWorld.balls) {
      seen.add(ball.clusterModifier);
    }
  }
  for (const mod of ['bubble', 'chained', 'freezeCore', 'lightningCore', 'paintCore']) {
    assert.ok(seen.has(mod), `${mod} never rolled in Survival`);
  }
});

test('Each chain link gets one metal link drawn over the touching spheres', () => {
  const board = createEmptyBoard();
  const { row } = addHangingRow(board, [COLOR_A, COLOR_B, COLOR_A]);
  row[1].clusterModifier = CLUSTER_MODIFIERS.CHAINED;
  let ellipses = 0;
  const ctx = new Proxy({}, {
    get: (target, prop) => (prop in target ? target[prop] : prop === 'ellipse' ? () => { ellipses++; } : () => {}),
    set: (target, prop, value) => { target[prop] = value; return true; }
  });
  const renderer = Object.create(Renderer.prototype);
  renderer.ballsConfig = ballsConfig;
  renderer.drawChainLinkOverlays(ctx, board.physicsWorld, 1);
  const strokesPerLink = 2;
  assert.equal(ellipses, 2 * strokesPerLink, 'two chain links (one per neighbor), each drawn as a shadow then a metal ring');
});

test('A rail anchor slides toward the weight it holds and stays on its rail', () => {
  const board = createEmptyBoard();
  const world = board.physicsWorld;
  const railHalfWidth = REST_DISTANCE * 2;
  const anchor = addBall(board, CENTER_X, TOP_Y, {
    isAnchor: true,
    railMinX: CENTER_X - railHalfWidth,
    railMaxX: CENTER_X + railHalfWidth
  });
  // The held sphere hangs off to the right, as if the left side had been cleared.
  const held = addBall(board, CENTER_X + REST_DISTANCE * 1.5, TOP_Y + REST_DISTANCE, { colorId: COLOR_B });
  world.createBond(anchor, held, false);
  board.hasFiredInRound = true;
  const steps = 200;
  for (let i = 0; i < steps; i++) {
    board.update();
  }
  assert.ok(anchor.anchorX > CENTER_X, 'the anchor slid toward the weight');
  assert.ok(anchor.anchorX <= anchor.railMaxX && anchor.anchorX >= anchor.railMinX, 'the anchor stays on its rail');
  assert.ok(Math.abs(anchor.y - TOP_Y) < 1, 'a rail is horizontal');
});

test('A thruster lifts the sphere it sits in against gravity', () => {
  const heights = [];
  for (const clusterModifier of [null, CLUSTER_MODIFIERS.THRUSTER]) {
    const board = createEmptyBoard();
    const anchor = addBall(board, CENTER_X, TOP_Y, { isAnchor: true });
    const hanging = addBall(board, CENTER_X, TOP_Y + REST_DISTANCE, { colorId: COLOR_B, clusterModifier });
    board.physicsWorld.createBond(anchor, hanging, false);
    board.hasFiredInRound = true;
    const steps = 120;
    for (let i = 0; i < steps; i++) {
      board.update();
    }
    heights.push(hanging.y);
  }
  assert.ok(heights[1] < heights[0], 'the thruster sphere rides higher than a plain one');
});

test('A tether binds distant spheres with long links that never snap or carry a color group', () => {
  const board = createEmptyBoard();
  const world = board.physicsWorld;
  const tetherSpec = ballsConfig.clusterModifiers.tether;
  const anchor = addBall(board, CENTER_X, TOP_Y, { isAnchor: true, colorId: COLOR_B });
  const tetherBall = addBall(board, CENTER_X, TOP_Y + REST_DISTANCE, { clusterModifier: CLUSTER_MODIFIERS.TETHER });
  const distant = addBall(board, CENTER_X + RADIUS * tetherSpec.rangeFactor * 0.9, TOP_Y + REST_DISTANCE, { colorId: COLOR_A });
  const outOfRange = addBall(board, CENTER_X - RADIUS * tetherSpec.rangeFactor * 1.5, TOP_Y + REST_DISTANCE);
  world.rebuildInitialBonds();
  assert.ok(tetherBall.tethers.has(distant.id) && distant.tethers.has(tetherBall.id));
  assert.ok(!tetherBall.tethers.has(outOfRange.id));
  assert.ok(world.getAnchoredBallIds().has(distant.id), 'a tether holds the distant sphere up');
  assert.ok(!world.findColorCluster(tetherBall).includes(distant), 'a tether never joins a color group');

  world.allowTensionBreak = true;
  board.hasFiredInRound = true;
  board.update();
  assert.ok(tetherBall.bonds.has(distant.id), 'a stretched tether does not snap');

  board.destroyClusterBall(tetherBall, COLOR_A, true);
  assert.equal(distant.tethers.size, 0, 'destroying the tether sphere frees its links');
});

test('Rust is colorless, never joins a group, and paint turns it back into a colored sphere', () => {
  const board = createEmptyBoard();
  const { row } = addHangingRow(board, [COLOR_A, COLOR_A, COLOR_A]);
  const rusty = board.createClusterBall({ x: row[2].x + REST_DISTANCE, y: TOP_Y, radius: RADIUS, clusterModifier: CLUSTER_MODIFIERS.RUST });
  board.physicsWorld.addBall(rusty);
  board.physicsWorld.createBond(row[2], rusty, false);
  assert.equal(rusty.colorId, null);
  assert.ok(!board.physicsWorld.findColorCluster(row[0]).includes(rusty));

  row[2].clusterModifier = CLUSTER_MODIFIERS.PAINT_CORE;
  board.destroyClusterBall(row[2], COLOR_A, false);
  assert.equal(rusty.clusterModifier, null, 'paint scrubbed the rust off');
  assert.equal(rusty.colorId, COLOR_A);
});

test('A neutral anchor holding only rust crumbles and lets the rust fall', () => {
  const board = createEmptyBoard();
  const anchor = addBall(board, CENTER_X, TOP_Y, { isAnchor: true, colorId: null, clusterModifier: CLUSTER_MODIFIERS.NEUTRAL_ANCHOR });
  const rusty = addBall(board, CENTER_X, TOP_Y + REST_DISTANCE, { colorId: null, clusterModifier: CLUSTER_MODIFIERS.RUST });
  board.physicsWorld.createBond(anchor, rusty, false);
  addBall(board, CENTER_X + REST_DISTANCE * 4, TOP_Y, { isAnchor: true });
  board.detachAndRewardAvalanche();
  board.detachAndRewardAvalanche();
  assert.equal(board.physicsWorld.ballMap.has(anchor.id), false);
  assert.equal(board.physicsWorld.ballMap.has(rusty.id), false, 'the rust fell once its anchor crumbled');
});

test('A Rocket shot hits the hardest targets first and cracks a Boss Core shield', () => {
  const board = createEmptyBoard();
  const rocketSpec = ballsConfig.specialTypes.rocket;
  const plain = addBall(board, CENTER_X, TOP_Y + REST_DISTANCE);
  const boss = addBall(board, CENTER_X + REST_DISTANCE * 3, TOP_Y, { clusterModifier: CLUSTER_MODIFIERS.BOSS_CORE, armorHits: 3 });
  const rusty = addBall(board, CENTER_X - REST_DISTANCE * 3, TOP_Y, { colorId: null, clusterModifier: CLUSTER_MODIFIERS.RUST });
  const anchor = addBall(board, CENTER_X + REST_DISTANCE * 5, TOP_Y, { isAnchor: true });
  const extra = Array.from({ length: rocketSpec.rocketCount }, (_, i) => addBall(board, CENTER_X - REST_DISTANCE * (i + 1), TOP_Y + REST_DISTANCE * 3));
  const rocket = addBall(board, CENTER_X, TOP_Y + REST_DISTANCE * 2, { colorId: null, specialType: 'rocket' });

  // The impact alone: the turn cleanup would also drop these unbonded test spheres.
  board.specialController.resolveSpecialImpact(rocket, board.physicsWorld, board.particleSystem, board.audioManager, 1, (target, color, ignoreArmor, count, speed) =>
    board.destroyClusterBall(target, color, ignoreArmor, count, speed)
  );
  const gone = (ball) => !board.physicsWorld.ballMap.has(ball.id);
  assert.ok(gone(rusty), 'spheres with a modifier are hit first');
  assert.equal(boss.armorHits, 2, 'a rocket cracks one Boss Core shield, like a blast');
  assert.ok(gone(anchor), 'then anchors');
  assert.ok(!gone(plain) && extra.every((ball) => !gone(ball)), `only ${rocketSpec.rocketCount} rockets fly`);
});

test('A guaranteed armored ball gets its armor like a rolled one', () => {
  const engine = createEmptyBoard();
  const ball = addBall(engine, CENTER_X, TOP_Y);
  engine.ensureMinimumModifiers([ball], { [CLUSTER_MODIFIERS.ARMORED]: 1 });
  assert.equal(ball.armorHits, ballsConfig.clusterModifiers.armored.initialArmor);
});

test('Every cluster modifier, level and tutorial has its texts in both languages', () => {
  for (const modKey of Object.keys(ballsConfig.clusterModifiers)) {
    for (const [lang, dict] of [['en', en], ['fr', fr]]) {
      const entry = dict.modals.shop.codex.modifiers[modKey];
      assert.ok(entry?.name && entry?.description, `${lang} codex entry for ${modKey}`);
    }
  }
  for (const level of levelsConfig.levels) {
    for (const dict of [en, fr]) {
      assert.ok(dict.levels.items[`lvl${level.id}`]?.name, `level ${level.id} name`);
      if (level.tutorialKey) {
        const tip = level.tutorialKey.split('.').reduce((node, key) => node?.[key], dict);
        assert.equal(typeof tip, 'string', `${level.tutorialKey} text`);
      }
    }
  }
});

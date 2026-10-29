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
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { SPECIAL_TYPES } from '../src/core/Constants.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { predictImpact } from '../src/game/ImpactPreview.js';
import { BOT_POLICIES, planArsenalShot, playGame, shotValue } from '../scripts/bot/CampaignBot.js';
import { UsageError, candidatePasses, failedFloors, parseArgs } from '../scripts/calibrate-campaign.mjs';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const configs = {
  game: applyWorldGeometry(loadJson('./configs/game.json')),
  physics: loadJson('./configs/physics.json'),
  balls: loadJson('./configs/balls.json'),
  obstacles: loadJson('./configs/obstacles.json'),
  levels: loadJson('./configs/levels.json'),
  campaign: loadJson('./configs/campaign.json'),
  audio: loadJson('./configs/audio.json'),
  flux: loadJson('./configs/flux.json')
};
const campaignTuning = loadJson('./configs/campaignTuning.json');
for (const [key, value] of Object.entries(configs)) {
  configRegistry.configs.set(key, value);
}

const bot = configs.campaign.generated.calibration.bot;
const REACH = configs.physics.ball.radius * bot.neighborhoodRadii;
/**
 * An authored level, so the board never changes with the generator: a full stock of
 * special balls and a cluster a bomb takes 6 spheres off.
 */
const DENSE_LEVEL_ID = 11;
/** Enough bombs that the endgame rule (shots left <= specials left) is in play from the start. */
const ENDGAME_BOMB_COUNT = 1000;

const createEngine = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  return new GameEngine({
    gameConfig: configs.game,
    physicsConfig: configs.physics,
    ballsConfig: configs.balls,
    obstaclesConfig: configs.obstacles,
    levelsConfig: configs.levels,
    campaignConfig: configs.campaign,
    campaignTuning,
    fluxConfig: configs.flux,
    audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
    storageManager,
    onStateChange: () => {}
  });
};

/** Runs `fn` with Math.random replaced by a fixed stream, so games replay. */
const withFixedRandom = (fn) => {
  const original = Math.random;
  let seed = 1;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
};

test('A bomb shot is worth what its preview destroys, plus what drops after', () => {
  const engine = createEngine();
  engine.startCampaignLevel(DENSE_LEVEL_ID);
  engine.currentBall = engine.createRandomLauncherBall(SPECIAL_TYPES.BOMB);
  // Aim at the cluster: the first sampled angle whose blast reaches a sphere.
  const blastRadius = engine.currentBall.radius * configs.balls.specialTypes.bomb.blastRadiusFactor;
  const reaches = (angle) => {
    engine.updateAimFromAngle(angle);
    const tip = engine.aimPoints.at(-1);
    return Boolean(tip) && engine.physicsWorld.balls.some((ball) => Math.hypot(ball.x - tip.x, ball.y - tip.y) <= blastRadius);
  };
  const angles = Array.from(
    { length: bot.aimSamples + 1 },
    (_, i) => -Math.PI * (bot.aimArcStart + (bot.aimArcSpan * i) / bot.aimSamples)
  );
  const angle = angles.find(reaches);
  assert.notEqual(angle, undefined, 'some angle reaches the cluster');
  engine.updateAimFromAngle(angle);
  const end = engine.aimPoints.at(-1);
  const { destroyedIds } = predictImpact({
    points: engine.aimPoints,
    currentBall: engine.currentBall,
    physicsWorld: engine.physicsWorld,
    endX: end.x,
    endY: end.y,
    blastMult: engine.getBlastRadiusMultiplier(),
    specialTypes: configs.balls.specialTypes,
    matchMinCount: configs.game.defaults.matchMinCount
  });
  assert.ok(destroyedIds.size > 0, 'the bomb destroys what it reaches');
  const dropped = engine.physicsWorld.findDetachedIfRemoved(destroyedIds).length;
  assert.equal(shotValue(engine, bot.arsenal), destroyedIds.size + dropped * bot.arsenal.avalancheWeight);
});

test('Planning a shot leaves the loaded ball and the special stock alone', () => {
  const engine = createEngine();
  engine.startCampaignLevel(DENSE_LEVEL_ID);
  const loaded = engine.currentBall;
  const stock = { ...engine.specialInventory };
  planArsenalShot(engine, bot, REACH);
  assert.equal(engine.currentBall, loaded);
  assert.deepEqual(engine.specialInventory, stock);
});

test('Without a special in stock the arsenal bot shoots a color', () => {
  const engine = createEngine();
  engine.startCampaignLevel(DENSE_LEVEL_ID);
  engine.specialInventory = {};
  const shot = planArsenalShot(engine, bot, REACH);
  assert.equal(shot.specialType, null);
  assert.notEqual(shot.angle, null);
});

test('With more specials than shots left the arsenal bot fires the best one', () => {
  const engine = createEngine();
  engine.startCampaignLevel(DENSE_LEVEL_ID);
  // The rule alone, away from the shipped thresholds: any special that takes a sphere off
  // qualifies, and outside the endgame no gain is ever enough (a shot cannot take off more
  // spheres than the board holds). The bomb then wins exactly when the endgame drops the gain.
  const ruleBot = {
    ...bot,
    arsenal: { ...bot.arsenal, specialMinValue: 1, specialMinGain: engine.physicsWorld.balls.length }
  };
  engine.specialInventory = { [SPECIAL_TYPES.BOMB]: 1 };
  assert.ok(engine.shotsRemaining > 1, 'more shots than specials: no endgame yet');
  const early = withFixedRandom(() => planArsenalShot(engine, ruleBot, REACH));
  assert.equal(early.specialType, null, 'before the endgame the bomb needs a gain no shot can reach');
  engine.specialInventory = { [SPECIAL_TYPES.BOMB]: ENDGAME_BOMB_COUNT };
  const endgame = withFixedRandom(() => planArsenalShot(engine, ruleBot, REACH));
  assert.equal(endgame.specialType, SPECIAL_TYPES.BOMB, 'a bomb into the opening cluster beats any color shot');
});

test('The arsenal bot plays a level to its end and spends specials from the stock', () => {
  const engine = createEngine();
  const stockTotal = Object.values(engine.levelCatalog.get(DENSE_LEVEL_ID).specialInventory).reduce((a, b) => a + b, 0);
  const game = withFixedRandom(() => playGame(engine, DENSE_LEVEL_ID, bot, BOT_POLICIES.ARSENAL));
  assert.notEqual(engine.isRunPlaying(), true, 'the game ended');
  assert.ok(game.specialsUsed > 0 && game.specialsUsed <= stockTotal);
});

test('The greedy bot never plays a special ball', () => {
  const engine = createEngine();
  const game = withFixedRandom(() => playGame(engine, DENSE_LEVEL_ID, bot, BOT_POLICIES.GREEDY));
  assert.equal(game.specialsUsed, 0);
});

test('The star policy names a bot whose median factor was measured', () => {
  const calibration = configs.campaign.generated.calibration;
  assert.ok(Object.values(BOT_POLICIES).includes(calibration.starPolicy), `unknown star policy ${calibration.starPolicy}`);
  for (const policy of Object.values(BOT_POLICIES)) {
    assert.ok(calibration.threeStarMedianFactors[policy] > 0, `no three-star factor for the ${policy} bot`);
  }
});

/** Bounds of the shipped campaign, as the calibration script reads them. */
const ARGS_BOUNDS = Object.freeze({
  firstId: configs.levels.levels[0].id,
  firstGenerated: configs.levels.levels.length + 1,
  lastId: configs.levels.levels.length + configs.campaign.generated.count,
  workers: 4
});
const LAST_AUTHORED_ID = ARGS_BOUNDS.firstGenerated - 1;

test('The calibration reads a valid command line, defaults first', () => {
  assert.deepEqual(parseArgs([], ARGS_BOUNDS), {
    from: ARGS_BOUNDS.firstGenerated,
    to: ARGS_BOUNDS.lastId,
    workers: ARGS_BOUNDS.workers,
    dryRun: false
  });
  const from = ARGS_BOUNDS.firstGenerated + 1;
  assert.deepEqual(
    parseArgs(['--from', String(from), '--dry-run', '--to', String(from + 1), '--workers', '2'], ARGS_BOUNDS),
    { from, to: from + 1, workers: 2, dryRun: true }
  );
});

test('The calibration refuses a range that runs backwards', () => {
  const from = ARGS_BOUNDS.firstGenerated + 1;
  assert.throws(() => parseArgs(['--from', String(from), '--to', String(from - 1)], ARGS_BOUNDS), UsageError);
});

test('The calibration refuses a value that is not a whole number, or none', () => {
  for (const argv of [['--from', 'abc'], ['--to', '30.5'], ['--workers', '-1'], ['--from', ''], ['--to'], ['--level', '30']]) {
    assert.throws(() => parseArgs(argv, ARGS_BOUNDS), UsageError, argv.join(' '));
  }
});

test('The calibration needs at least one worker', () => {
  assert.throws(() => parseArgs(['--workers', '0'], ARGS_BOUNDS), UsageError);
});

test('The calibration refuses a level outside the campaign', () => {
  assert.throws(() => parseArgs(['--to', String(ARGS_BOUNDS.lastId + 1)], ARGS_BOUNDS), UsageError);
  assert.throws(() => parseArgs(['--from', '0'], ARGS_BOUNDS), UsageError);
});

test('Only a dry run measures an authored level; a writing run starts on the generated ones', () => {
  const dry = parseArgs(['--from', String(LAST_AUTHORED_ID), '--to', String(LAST_AUTHORED_ID), '--dry-run'], ARGS_BOUNDS);
  assert.deepEqual([dry.from, dry.to, dry.dryRun], [LAST_AUTHORED_ID, LAST_AUTHORED_ID, true]);
  assert.throws(() => parseArgs(['--from', String(LAST_AUTHORED_ID), '--to', String(LAST_AUTHORED_ID)], ARGS_BOUNDS), UsageError);
  const writing = parseArgs(['--from', String(LAST_AUTHORED_ID), '--to', String(ARGS_BOUNDS.firstGenerated)], ARGS_BOUNDS);
  assert.deepEqual([writing.from, writing.to], [ARGS_BOUNDS.firstGenerated, ARGS_BOUNDS.firstGenerated], 'clamped to the generated levels');
});

/** The shipped floors, with each measure placed relative to them. */
const FLOORS = configs.campaign.generated.calibration;
const ABOVE_FLOOR_STEP = 0.25;
const measuredAt = (greedyRate, arsenalRate) => ({
  greedy: { winRate: greedyRate },
  ...(arsenalRate === undefined ? {} : { arsenal: { winRate: arsenalRate } })
});

test('Both calibration floors are win rates, the arsenal one the higher', () => {
  for (const key of ['minWinRate', 'minArsenalWinRate']) {
    assert.ok(FLOORS[key] > 0 && FLOORS[key] <= 1, `${key} is a win rate`);
  }
  assert.ok(FLOORS.minArsenalWinRate >= FLOORS.minWinRate, 'specials never make a level harder to win');
});

test('A candidate passes only on both floors, and a missing measure fails its floor', () => {
  const greedyFloor = FLOORS.minWinRate;
  const arsenalFloor = FLOORS.minArsenalWinRate;
  assert.equal(candidatePasses(measuredAt(greedyFloor, arsenalFloor + ABOVE_FLOOR_STEP), FLOORS), true, 'greedy at its floor');
  assert.equal(candidatePasses(measuredAt(greedyFloor, arsenalFloor), FLOORS), true, 'both at their floor');
  const arsenalShort = measuredAt(greedyFloor + ABOVE_FLOOR_STEP, arsenalFloor - ABOVE_FLOOR_STEP);
  assert.equal(candidatePasses(arsenalShort, FLOORS), false, 'arsenal below its floor');
  assert.deepEqual(failedFloors(arsenalShort, FLOORS), [BOT_POLICIES.ARSENAL]);
  const noArsenal = measuredAt(greedyFloor + ABOVE_FLOOR_STEP);
  assert.equal(candidatePasses(noArsenal, FLOORS), false, 'no arsenal measure');
  assert.deepEqual(failedFloors(noArsenal, FLOORS), [BOT_POLICIES.ARSENAL]);
  assert.deepEqual(failedFloors(measuredAt(0, 0), FLOORS), [BOT_POLICIES.GREEDY, BOT_POLICIES.ARSENAL]);
});

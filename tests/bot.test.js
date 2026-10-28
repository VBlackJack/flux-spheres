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
  engine.specialInventory = { [SPECIAL_TYPES.BOMB]: ENDGAME_BOMB_COUNT };
  const shot = planArsenalShot(engine, bot, REACH);
  assert.equal(shot.specialType, SPECIAL_TYPES.BOMB, 'a bomb into the opening cluster beats any color shot');
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

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
import { GameEngine } from '../src/game/GameEngine.js';
import { generateLayout } from '../src/game/layouts/LayoutGenerators.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { OBSTACLE_TYPES } from '../src/core/Constants.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
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

/** Launcher and danger line of the 540 x 820 board before they were derived from its size. */
const FORMER_FIXED_GEOMETRY = Object.freeze({ launcherX: 270, launcherY: 745, dangerLineY: 675 });
/** Flux stages the fit guard walks through, with a few seeds each. */
const FLUX_STAGES_CHECKED = 60;
const FLUX_SEEDS = ['world-a', 'world-b', 'world-c'];
/** A narrower world, to check that content is centered in it. */
const NARROW_WORLD_WIDTH = 470;

const createEngine = (config = gameConfig) => {
  const storageManager = new StorageManager();
  storageManager.init();
  return new GameEngine({
    gameConfig: config,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    fluxConfig,
    audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
    storageManager,
    onStateChange: () => {}
  });
};

/** Horizontal reach of a board: balls with their radius, obstacles with their size. */
const horizontalReach = (world) => {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const ball of world.balls) {
    minX = Math.min(minX, ball.x - ball.radius);
    maxX = Math.max(maxX, ball.x + ball.radius);
  }
  for (const obstacle of world.obstacles) {
    // Only a barrier spans its width, and it sweeps sideways by its oscillation range.
    const halfSize =
      obstacle.type === OBSTACLE_TYPES.BARRIER ? obstacle.width / 2 + (obstacle.oscillateRangeX || 0) : obstacle.radius;
    minX = Math.min(minX, obstacle.x - halfSize);
    maxX = Math.max(maxX, obstacle.x + halfSize);
  }
  return { minX, maxX };
};

const assertFitsWorld = (world, label, canvas = gameConfig.canvas) => {
  const { minX, maxX } = horizontalReach(world);
  assert.ok(minX >= canvas.wallMargin, `${label} reaches x ${minX.toFixed(1)}, left of the wall margin`);
  assert.ok(
    maxX <= canvas.logicalWidth - canvas.wallMargin,
    `${label} reaches x ${maxX.toFixed(1)}, right of the wall margin`
  );
};

test('The derived launcher and danger line match the former fixed positions', () => {
  const canvas = gameConfig.canvas;
  assert.equal(canvas.launcherX, FORMER_FIXED_GEOMETRY.launcherX);
  assert.equal(canvas.launcherY, FORMER_FIXED_GEOMETRY.launcherY);
  assert.equal(canvas.dangerLineY, FORMER_FIXED_GEOMETRY.dangerLineY);
  assert.equal(canvas.contentOffsetX, 0, 'content authored for this width stays where it was');
});

test('Every campaign level is built at its authored positions in a world of the design width', () => {
  const engine = createEngine();
  const key = (p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
  for (const level of levelsConfig.levels) {
    engine.startCampaignLevel(level.id);
    const built = engine.physicsWorld.balls.map(key).sort();
    const authored = generateLayout(level.layout).balls.map(key).sort();
    assert.deepEqual(built, authored, `level ${level.id} spheres`);
    assert.deepEqual(
      engine.physicsWorld.obstacles.map((o) => o.x),
      level.obstacles.map((o) => o.x),
      `level ${level.id} obstacles`
    );
  }
});

test('Content is centered in a narrower world and the launcher follows the width', () => {
  const narrow = applyWorldGeometry(structuredClone(loadJson('./configs/game.json')));
  narrow.canvas.logicalWidth = NARROW_WORLD_WIDTH;
  applyWorldGeometry(narrow);
  const offset = (NARROW_WORLD_WIDTH - narrow.canvas.designWidth) / 2;
  assert.equal(narrow.canvas.contentOffsetX, offset);
  assert.equal(narrow.canvas.launcherX, NARROW_WORLD_WIDTH / 2);

  const level = levelsConfig.levels[0];
  const engine = createEngine(narrow);
  engine.startCampaignLevel(level.id);
  const builtX = engine.physicsWorld.balls.map((b) => b.x).sort((a, b) => a - b);
  const authoredX = generateLayout(level.layout).balls.map((b) => b.x + offset).sort((a, b) => a - b);
  builtX.forEach((x, i) => assert.ok(Math.abs(x - authoredX[i]) < 1e-9));
});

test('Every campaign level fits between the walls', () => {
  const engine = createEngine();
  for (const level of levelsConfig.levels) {
    engine.startCampaignLevel(level.id);
    assertFitsWorld(engine.physicsWorld, `level ${level.id}`);
  }
});

test('Every Flux stage fits between the walls', () => {
  const engine = createEngine();
  for (const seed of FLUX_SEEDS) {
    engine.startFluxRun(seed);
    for (let stage = 1; stage <= FLUX_STAGES_CHECKED; stage++) {
      engine.fluxStage = stage;
      engine.buildFluxStage({ persist: false });
      assertFitsWorld(engine.physicsWorld, `Flux ${seed} stage ${stage}`);
    }
  }
});

test('The Survival grid fits between the walls', () => {
  const engine = createEngine();
  engine.startEndlessMode();
  assertFitsWorld(engine.physicsWorld, 'Survival');
});

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
import { computeTiltShare } from '../src/ui/UIManager.js';

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

const DAILY_KEY = '2026-10-27';
const SETTLE_FRAMES = 400;
const RADIUS = physicsConfig.ball.radius;
const REST_DISTANCE = RADIUS * physicsConfig.simulation.bondRestDistanceFactor;
const CENTER_X = gameConfig.canvas.logicalWidth / 2;
const TOP_Y = 100;

const createEngine = ({ levels = levelsConfig, storageManager } = {}) => {
  const storage = storageManager || new StorageManager();
  if (!storageManager) {
    storage.init();
  }
  const dummyAudio = { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} };
  return new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig: levels,
    audioManager: dummyAudio,
    storageManager: storage,
    onStateChange: () => {}
  });
};

/** A canvas context double that only counts the calls the test asks about. */
const createCountingContext = (counted) => {
  const counts = Object.fromEntries(counted.map((name) => [name, 0]));
  const ctx = new Proxy(
    {},
    {
      get: (target, prop) => {
        if (prop in target) {
          return target[prop];
        }
        if (prop in counts) {
          return () => {
            counts[prop]++;
          };
        }
        return () => {};
      },
      set: (target, prop, value) => {
        target[prop] = value;
        return true;
      }
    }
  );
  return { ctx, counts };
};

test('The launcher queue shows the configured number of upcoming colors and feeds the next ball', () => {
  const engine = createEngine();
  engine.startCampaignLevel(1);
  assert.equal(engine.upcomingColorIds.length, gameConfig.canvas.launcherPreviewCount);
  const [firstQueued] = engine.upcomingColorIds;
  engine.shoot();
  assert.equal(engine.nextBall.colorId, firstQueued, 'the next ball comes from the head of the queue');
  assert.equal(engine.upcomingColorIds.length, gameConfig.canvas.launcherPreviewCount, 'the queue is topped up');
});

test('Queued colors that left the board are replaced', () => {
  const engine = createEngine();
  engine.startCampaignLevel(1);
  const boardColor = engine.physicsWorld.balls.find((b) => b.colorId).colorId;
  const goneColor = ballsConfig.standardColors.map((c) => c.id).find((id) => !engine.physicsWorld.balls.some((b) => b.colorId === id));
  engine.upcomingColorIds = engine.upcomingColorIds.map(() => goneColor);
  engine.refreshStaleLauncherColors();
  assert.ok(engine.upcomingColorIds.every((color) => color !== goneColor));
  assert.ok(boardColor);
});

test('The Daily Challenge queue is the same for every player, and a saved run keeps it', () => {
  const first = createEngine();
  first.startDailyChallenge(DAILY_KEY);
  const second = createEngine();
  second.startDailyChallenge(DAILY_KEY);
  assert.deepEqual(first.upcomingColorIds, second.upcomingColorIds);

  first.hasFiredInRound = true;
  first.saveRunSnapshot();
  const resumed = createEngine({ storageManager: first.storageManager });
  assert.equal(resumed.restoreSavedRun(), true);
  assert.deepEqual(resumed.upcomingColorIds, first.upcomingColorIds);
});

test('A level without star thresholds gets them from its starting sphere count', () => {
  const levels = structuredClone(levelsConfig);
  delete levels.levels[0].starThresholds;
  const engine = createEngine({ levels });
  engine.startCampaignLevel(1);
  const count = engine.physicsWorld.balls.length;
  const expected = gameConfig.scoring.autoStarPointsPerBall.map((points) => Math.round(points * count));
  assert.deepEqual(engine.getStarThresholds(), expected);

  const tuned = createEngine();
  tuned.startCampaignLevel(1);
  assert.deepEqual(tuned.getStarThresholds(), levelsConfig.levels[0].starThresholds, 'tuned thresholds win');
});

test('Tilt follows the screen orientation, ignores small tilts and is capped', () => {
  const cfg = gameConfig.tilt;
  const max = cfg.maxGravityShare;
  assert.equal(computeTiltShare({ gamma: cfg.deadZoneDegrees / 2, beta: 0 }, 0, cfg), 0, 'inside the dead zone');
  assert.equal(computeTiltShare({ gamma: cfg.fullTiltDegrees * 2, beta: 0 }, 0, cfg), max, 'capped at full tilt');
  assert.equal(computeTiltShare({ gamma: -cfg.fullTiltDegrees, beta: 0 }, 0, cfg), -max, 'tilting left pushes left');
  assert.equal(computeTiltShare({ gamma: 0, beta: cfg.fullTiltDegrees }, 90, cfg), max, 'landscape reads the other axis');
  assert.equal(computeTiltShare({ gamma: 0, beta: cfg.fullTiltDegrees }, 270, cfg), -max);
  assert.equal(computeTiltShare({ gamma: cfg.fullTiltDegrees, beta: 0 }, -180, cfg), -max, 'upside down flips the axis');
});

test('A tilt pushes the hanging spheres sideways', () => {
  const positions = [];
  for (const share of [0, gameConfig.tilt.maxGravityShare]) {
    const engine = createEngine();
    engine.startCampaignLevel(1);
    const world = engine.physicsWorld;
    world.balls.length = 0;
    world.ballMap.clear();
    const anchor = world.addBall(new Ball({ x: CENTER_X, y: TOP_Y, radius: RADIUS, colorId: null, isAnchor: true }));
    const hanging = world.addBall(new Ball({ x: CENTER_X, y: TOP_Y + REST_DISTANCE, radius: RADIUS, colorId: ballsConfig.standardColors[0].id }));
    world.createBond(anchor, hanging, false);
    engine.setTilt(share * 10);
    assert.ok(world.tiltFactor <= gameConfig.tilt.maxGravityShare, 'the engine caps the tilt');
    for (let i = 0; i < SETTLE_FRAMES; i++) {
      engine.update();
    }
    positions.push(hanging.x);
  }
  assert.ok(positions[1] > positions[0], 'a right tilt swings the sphere right');
});

test('Each color has its own pattern, and patterns are drawn inside the sphere', () => {
  const patterns = ballsConfig.standardColors.map((c) => c.pattern);
  assert.equal(new Set(patterns).size, patterns.length, 'no two colors share a pattern');
  const renderer = Object.create(Renderer.prototype);
  renderer.ballsConfig = ballsConfig;
  for (const pattern of patterns) {
    const { ctx, counts } = createCountingContext(['clip', 'stroke', 'fill']);
    renderer.drawColorPattern(ctx, pattern, RADIUS);
    assert.equal(counts.clip, 1, `${pattern} is clipped to the sphere`);
    assert.ok(counts.stroke + counts.fill > 0, `${pattern} draws something`);
  }
});

test('After a pattern, the sphere border is stroked on the sphere outline, not on the pattern', () => {
  // save/restore keeps the clip but not the current path: without a fresh outline, the
  // border stroke would redraw the pattern lines unclipped around the sphere.
  const calls = [];
  const ctx = new Proxy({}, {
    get: (target, prop) => (prop in target ? target[prop] : (...args) => calls.push(prop)),
    set: (target, prop, value) => { target[prop] = value; return true; }
  });
  const renderer = Object.create(Renderer.prototype);
  Object.assign(renderer, {
    ballsConfig,
    gameConfig,
    colorPatterns: true,
    highContrast: false,
    colorMap: new Map(ballsConfig.standardColors.map((c) => [c.id, c])),
    ballGradientCache: new Map(),
    labelFontCache: new Map(),
    ctx
  });
  renderer.getCachedBallGradient = () => '#000';
  renderer.getLabelFont = () => ({ font: '10px sans-serif', isEnlarged: false });
  const ball = new Ball({ x: 0, y: 0, radius: RADIUS, colorId: ballsConfig.standardColors[0].id });
  renderer.drawBallAt(ctx, ball, CENTER_X, TOP_Y, 0);
  const clipAt = calls.indexOf('clip');
  const restoreAt = calls.indexOf('restore', clipAt);
  const borderStrokeAt = calls.indexOf('stroke', restoreAt);
  assert.ok(clipAt >= 0 && restoreAt > clipAt && borderStrokeAt > restoreAt);
  assert.ok(calls.slice(restoreAt, borderStrokeAt).includes('beginPath'), 'the outline is rebuilt before the border');
});

test('A falling sphere ripples the liquid, which settles back, and reduced motion keeps it still', () => {
  const engine = createEngine();
  engine.startCampaignLevel(1);
  const particles = engine.particleSystem;
  particles.splashLiquid(0.5, physicsConfig.simulation.maxVelocity);
  for (let i = 0; i < 3; i++) {
    particles.update();
  }
  const peak = Math.max(...particles.liquidHeights.map(Math.abs));
  assert.ok(peak > 0, 'the splash moves the surface');
  for (let i = 0; i < SETTLE_FRAMES; i++) {
    particles.update();
  }
  assert.ok(Math.max(...particles.liquidHeights.map(Math.abs)) < peak / 10, 'the surface settles');

  engine.setReducedMotion(true);
  particles.liquidHeights.fill(0);
  particles.liquidVelocities.fill(0);
  particles.splashLiquid(0.5, physicsConfig.simulation.maxVelocity);
  assert.ok(particles.liquidVelocities.every((v) => v === 0));
});

test('Shots bouncing off a side wall crack it, up to a limit, until the next run', () => {
  const engine = createEngine();
  engine.startCampaignLevel(1);
  const canvasCfg = gameConfig.canvas;
  const particles = engine.particleSystem;
  engine.crackWallAt(canvasCfg.wallMargin, TOP_Y);
  engine.crackWallAt(CENTER_X, TOP_Y);
  assert.equal(particles.wallCracks.length, 1, 'only a side-wall bounce cracks');
  for (let i = 0; i < gameConfig.juice.particles.wallCrackMaxCount * 2; i++) {
    engine.crackWallAt(canvasCfg.logicalWidth - canvasCfg.wallMargin, TOP_Y + i);
  }
  assert.equal(particles.wallCracks.length, gameConfig.juice.particles.wallCrackMaxCount);
  engine.startCampaignLevel(1);
  assert.equal(particles.wallCracks.length, 0, 'a new run has clean walls');
});

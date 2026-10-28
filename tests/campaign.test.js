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
import { createHash } from 'node:crypto';

import { configRegistry } from '../src/core/ConfigRegistry.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { CLUSTER_MODIFIERS, OBSTACLE_TYPES } from '../src/core/Constants.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { LevelCatalog, placeGeneratedLevel } from '../src/game/LevelCatalog.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const campaignConfig = loadJson('./configs/campaign.json');
const fluxConfig = loadJson('./configs/flux.json');
const audioConfig = loadJson('./configs/audio.json');
const locales = { fr: loadJson('./locales/fr.json'), en: loadJson('./locales/en.json') };

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('campaign', campaignConfig);
configRegistry.configs.set('audio', audioConfig);
configRegistry.configs.set('flux', fluxConfig);

const BALL_RADIUS = physicsConfig.ball.radius;
const generated = campaignConfig.generated;
const AUTHORED_COUNT = levelsConfig.levels.length;

/**
 * Fingerprints of a few generated levels, frozen: a change to the generator, the Flux
 * shapes or the campaign curve that rebuilds these levels differently fails here, so the
 * change is made on purpose and the star thresholds get measured again.
 */
const FROZEN_FINGERPRINTS = Object.freeze({
  25: '41e4a903760825b8',
  30: 'd66cdf3f7fcae7e8',
  100: '5b6ddc65311478cb',
  437: '45bbd843a78bed13',
  824: 'c69941dfca227514'
});
const FINGERPRINT_LENGTH = 16;

const createCatalog = () =>
  new LevelCatalog({ levelsConfig, campaignConfig, fluxConfig, obstaclesConfig, ballRadius: BALL_RADIUS });

const createEngine = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  return new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    campaignConfig,
    fluxConfig,
    audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
    storageManager,
    onStateChange: () => {}
  });
};

/** What makes a level the level it is, colors and modifier rolls aside. */
const fingerprint = (levelDef) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        family: levelDef.family,
        shapeIds: levelDef.shapeIds,
        spec: levelDef.spec,
        obstacles: levelDef.obstacles,
        maxShots: levelDef.maxShots,
        paletteCount: levelDef.paletteCount,
        modifierWeights: levelDef.modifierWeights,
        minModifierCounts: levelDef.minModifierCounts,
        starThresholds: levelDef.starThresholds,
        specialInventory: levelDef.specialInventory
      })
    )
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);

const generatedIds = () => Array.from({ length: generated.count }, (_, i) => AUTHORED_COUNT + 1 + i);

const obstacleRadius = (type) => obstaclesConfig.types[type]?.radius ?? obstaclesConfig.defaults.radius;

test('The campaign holds the authored levels, then the generated ones', () => {
  const catalog = createCatalog();
  assert.equal(catalog.count, AUTHORED_COUNT + generated.count);
  assert.equal(catalog.lastId, AUTHORED_COUNT + generated.count);
  for (const level of levelsConfig.levels) {
    assert.equal(catalog.get(level.id), level, `level ${level.id} is the authored one`);
    assert.equal(catalog.isGenerated(level.id), false);
  }
  assert.equal(catalog.isGenerated(AUTHORED_COUNT + 1), true);
  assert.equal(catalog.get(catalog.lastId + 1), null);
  assert.equal(catalog.get(0), null);
});

test('A generated level depends only on its number', () => {
  const first = createCatalog();
  const second = createCatalog();
  // Built in a different order, so nothing carries over from one level to the next.
  const ids = generatedIds();
  const forward = ids.map((id) => fingerprint(first.get(id)));
  const backward = [...ids].reverse().map((id) => fingerprint(second.get(id))).reverse();
  assert.deepEqual(forward, backward);
});

test('A few generated levels keep their frozen fingerprint', () => {
  const catalog = createCatalog();
  for (const [id, expected] of Object.entries(FROZEN_FINGERPRINTS)) {
    assert.equal(fingerprint(catalog.get(Number(id))), expected, `level ${id}`);
  }
});

test('Every generated level is a playable board', () => {
  const engine = createEngine();
  const canvas = gameConfig.canvas;
  const leftWall = canvas.wallMargin;
  const rightWall = canvas.logicalWidth - canvas.wallMargin;
  const lowestAllowedY = canvas.dangerLineY - canvas.dangerWarningMarginY;
  for (const id of generatedIds()) {
    engine.startCampaignLevel(id);
    const levelDef = engine.levelCatalog.get(id);
    const label = `level ${id} (${levelDef.shapeIds.join('+')})`;
    const world = engine.physicsWorld;
    const balls = world.balls;

    assert.equal(engine.currentLevelId, id, `${label} starts`);
    assert.ok(balls.length > 0, `${label}: empty board`);
    assert.equal(world.getAnchoredBallIds().size, balls.length, `${label}: loose ball`);
    assert.equal(engine.shotsRemaining, levelDef.maxShots + engine.getStartingShotsBonus(), `${label}: shots`);
    for (const ball of balls) {
      assert.ok(ball.x - BALL_RADIUS >= leftWall && ball.x + BALL_RADIUS <= rightWall, `${label}: ball outside walls`);
      assert.ok(ball.y + BALL_RADIUS < lowestAllowedY, `${label}: ball too close to the danger line`);
    }
    for (const obstacle of world.obstacles.filter((o) => o.type !== OBSTACLE_TYPES.PIVOT)) {
      for (const ball of balls) {
        assert.ok(
          Math.hypot(ball.x - obstacle.x, ball.y - obstacle.y) >= obstacleRadius(obstacle.type) + BALL_RADIUS,
          `${label}: ball overlaps a ${obstacle.type}`
        );
      }
    }

    const counts = {};
    for (const ball of balls) {
      counts[ball.clusterModifier] = (counts[ball.clusterModifier] || 0) + 1;
    }
    assert.equal(counts[CLUSTER_MODIFIERS.BOSS_CORE] || 0, levelDef.isLandmark ? 1 : 0, `${label}: boss core`);
    // The boss core may take the place of one featured sphere.
    const [featured, minCount] = Object.entries(levelDef.minModifierCounts)[0];
    const bossAllowance = levelDef.isLandmark ? 1 : 0;
    assert.ok((counts[featured] || 0) >= minCount - bossAllowance, `${label}: too few ${featured}`);
  }
});

test('Difficulty climbs from chapter to chapter, with a breather at each new chapter', () => {
  const catalog = createCatalog();
  const chapters = new Map();
  for (const id of generatedIds()) {
    const levelDef = catalog.get(id);
    if (!chapters.has(levelDef.chapter)) {
      chapters.set(levelDef.chapter, []);
    }
    chapters.get(levelDef.chapter).push(levelDef);
  }
  const mean = (levels, pick) => levels.reduce((sum, level) => sum + pick(level), 0) / levels.length;
  const ordered = [...chapters.keys()].sort((a, b) => a - b).map((chapter) => chapters.get(chapter));
  assert.equal(ordered.length, Math.ceil(generated.count / generated.chapterSize));

  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    assert.ok(mean(current, (l) => l.difficulty) > mean(previous, (l) => l.difficulty), `chapter ${i + 1} is harder`);
    assert.ok(mean(current, (l) => l.paletteCount) >= mean(previous, (l) => l.paletteCount), `chapter ${i + 1} colors`);
    assert.ok(current[0].difficulty < previous.at(-1).difficulty, `chapter ${i + 1} opens with a breather`);
  }
  const shotsPerSphere = (levels) => mean(levels, (l) => l.maxShots / l.spec.balls.length);
  assert.ok(shotsPerSphere(ordered.at(-1)) < shotsPerSphere(ordered[0]), 'the shot margin tightens');
  assert.ok(mean(ordered.at(-1), (l) => l.spec.balls.length) > mean(ordered[0], (l) => l.spec.balls.length), 'boards grow');
});

test('Every generated level has star thresholds that climb', () => {
  const catalog = createCatalog();
  for (const id of generatedIds()) {
    const [one, two, three] = catalog.get(id).starThresholds;
    assert.ok(one === 0 && two > one && three > two, `level ${id}: ${one}/${two}/${three}`);
  }
});

test('A landmark comes every interval, with a drawn shape or a pair and a boss core', () => {
  const catalog = createCatalog();
  for (const id of generatedIds()) {
    const levelDef = catalog.get(id);
    const isLandmark = id % generated.landmarkInterval === 0;
    assert.equal(levelDef.isLandmark, isLandmark, `level ${id}`);
    if (isLandmark) {
      assert.ok(generated.landmarkFamilies.includes(levelDef.family), `level ${id} draws a landmark family`);
      assert.notEqual(levelDef.bossBallIndex, null, `level ${id} has a boss core`);
    }
  }
});

test('Each chapter features a mechanic the authored levels already teach', () => {
  const taught = new Set();
  for (const level of levelsConfig.levels) {
    for (const modKey of [...Object.keys(level.modifierWeights || {}), ...Object.keys(level.minModifierCounts || {})]) {
      taught.add(modKey);
    }
  }
  for (const mechanic of generated.featuredMechanics) {
    assert.ok(taught.has(mechanic), `${mechanic} is taught before it is featured`);
    assert.ok(ballsConfig.clusterModifiers[mechanic], `${mechanic} is a cluster modifier`);
  }
  for (const modKey of Object.keys(generated.modifiers.pool)) {
    assert.ok(taught.has(modKey), `${modKey} is taught before generated levels roll it`);
  }
});

test('Every generated level has a name and a description in both languages', () => {
  for (const [lang, dict] of Object.entries(locales)) {
    const texts = dict.levels.generated;
    for (const key of ['name', 'description', 'landmarkDescription']) {
      assert.equal(typeof texts[key], 'string', `${lang}: levels.generated.${key}`);
    }
    for (const mechanic of generated.featuredMechanics) {
      assert.equal(typeof texts.themes[mechanic], 'string', `${lang}: levels.generated.themes.${mechanic}`);
    }
  }
});

test('The level select chapters cover every level once, the authored ones first', () => {
  const catalog = createCatalog();
  const chapters = catalog.listChapters();
  assert.equal(chapters.length, 1 + Math.ceil(generated.count / generated.chapterSize));
  assert.deepEqual([chapters[0].isTutorial, chapters[0].firstId, chapters[0].lastId], [true, 1, AUTHORED_COUNT]);
  chapters.forEach((chapter, index) => {
    assert.equal(chapter.index, index);
    if (index > 0) {
      assert.equal(chapter.firstId, chapters[index - 1].lastId + 1, `chapter ${index} follows the previous one`);
      assert.equal(chapter.featuredMechanic, catalog.summarize(chapter.firstId).featuredMechanic);
    }
  });
  assert.equal(chapters.at(-1).lastId, catalog.lastId);
  assert.equal(catalog.chapterIndexOf(1), 0);
  assert.equal(catalog.chapterIndexOf(AUTHORED_COUNT + 1), 1);
  assert.equal(catalog.chapterIndexOf(catalog.lastId), chapters.length - 1);
});

test('Chapters split the generated levels evenly and number them from 1', () => {
  const first = placeGeneratedLevel(0, generated);
  const last = placeGeneratedLevel(generated.count - 1, generated);
  assert.deepEqual([first.chapter, first.chapterLevel, first.difficulty], [1, 1, 0]);
  assert.equal(last.chapter, Math.ceil(generated.count / generated.chapterSize));
  assert.equal(last.chapterLevel, generated.chapterSize);
  assert.equal(last.difficulty, 1);
});

test('Winning a generated level unlocks the next one, up to the last level', () => {
  const engine = createEngine();
  const catalog = engine.levelCatalog;
  for (const id of [AUTHORED_COUNT, AUTHORED_COUNT + 1, catalog.lastId]) {
    engine.storageManager.unlockLevel(id);
    engine.startCampaignLevel(id);
    engine.score = engine.getStarThresholds().at(-1);
    engine.physicsWorld.clear();
    engine.evaluateRoundEnd();
    assert.equal(engine.state, 'victory', `level ${id} is won`);
    assert.equal(engine.storageManager.getUnlockedLevel(), Math.min(id + 1, catalog.lastId), `after level ${id}`);
  }
});

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
import { CLUSTER_MODIFIERS, OBSTACLE_TYPES } from '../src/core/Constants.js';
import { GameEngine } from '../src/game/GameEngine.js';
import {
  LEVEL_FORMATS,
  LevelCatalog,
  fingerprintLevel,
  placeGeneratedLevel,
  starThresholdsFromMedian
} from '../src/game/LevelCatalog.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const campaignConfig = loadJson('./configs/campaign.json');
const campaignTuning = loadJson('./configs/campaignTuning.json');
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

/** Command that measures the generated levels again, quoted when a calibration is stale. */
const CALIBRATION_COMMAND = 'node scripts/calibrate-campaign.mjs';

const createCatalog = (tuning = campaignTuning) =>
  new LevelCatalog({
    levelsConfig,
    campaignConfig,
    campaignTuning: tuning,
    fluxConfig,
    obstaclesConfig,
    ballRadius: BALL_RADIUS
  });

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
    campaignTuning,
    fluxConfig,
    audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
    storageManager,
    onStateChange: () => {}
  });
};

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
  const forward = ids.map((id) => fingerprintLevel(first.get(id)));
  const backward = [...ids].reverse().map((id) => fingerprintLevel(second.get(id))).reverse();
  assert.deepEqual(forward, backward);
});

test('Every generated level is calibrated for the board it is', () => {
  const catalog = createCatalog();
  const missing = [];
  const stale = [];
  for (const id of generatedIds()) {
    const entry = campaignTuning.levels[id];
    if (!entry) {
      missing.push(id);
    } else if (entry.fingerprint !== fingerprintLevel(catalog.get(id))) {
      stale.push(id);
    }
  }
  const rerun = `measure them again with ${CALIBRATION_COMMAND}`;
  assert.deepEqual(missing, [], `levels without a calibration, ${rerun}`);
  assert.deepEqual(stale, [], `levels whose board changed since their calibration, ${rerun}`);
});

test('The calibration header matches the settings it was measured with', () => {
  // The fingerprints only cover the boards: changing how many games are played or the
  // win-rate floors in campaign.json invalidates every measure without changing one.
  const { calibration } = generated;
  const expected = {
    runs: calibration.runs,
    minWinRate: calibration.minWinRate,
    minArsenalWinRate: calibration.minArsenalWinRate
  };
  assert.deepEqual(
    campaignTuning.calibration,
    expected,
    `the calibration settings changed since the last measure, measure again with ${CALIBRATION_COMMAND}`
  );
});

test('A calibration sets the level seed variant, extra shots and star thresholds', () => {
  const id = AUTHORED_COUNT + 1;
  const plain = createCatalog({ levels: {} }).get(id);
  const thresholds = [0, 1000, 2000];
  const tuned = createCatalog({ levels: { [id]: { variant: 1, extraShots: 6, starThresholds: thresholds } } }).get(id);
  assert.notEqual(fingerprintLevel(tuned), fingerprintLevel(plain), 'another variant builds another board');
  assert.deepEqual(tuned.starThresholds, thresholds);
  const sameSeed = createCatalog({ levels: { [id]: { variant: 0, extraShots: 6 } } }).get(id);
  assert.equal(sameSeed.maxShots, plain.maxShots + 6);
  assert.deepEqual(sameSeed.spec, plain.spec);
});

test('Star thresholds follow the bot median the way the authored levels do', () => {
  const [zero, two, three] = starThresholdsFromMedian(20000, generated);
  const { stars, calibration } = generated;
  assert.equal(zero, 0);
  const factor = calibration.threeStarMedianFactors[calibration.starPolicy];
  assert.ok(Math.abs(three - 20000 * factor) <= stars.roundTo / 2);
  assert.ok(Math.abs(two - three * stars.twoStarShare) <= stars.roundTo / 2);
  assert.ok(two > 0 && three > two, 'a tiny median still gives climbing thresholds');
  const [, tinyTwo, tinyThree] = starThresholdsFromMedian(0, generated);
  assert.ok(tinyTwo > 0 && tinyThree > tinyTwo);
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
    const bossAllowance = levelDef.isLandmark ? 1 : 0;
    for (const [featured, minCount] of Object.entries(levelDef.minModifierCounts)) {
      assert.ok((counts[featured] || 0) >= minCount - bossAllowance, `${label}: too few ${featured}`);
    }
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
  for (const mechanic of [...generated.featuredMechanics, ...generated.pairedChapters.flat()]) {
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
    for (const key of ['name', 'description', 'landmarkDescription', 'themePair', 'formatName']) {
      assert.equal(typeof texts[key], 'string', `${lang}: levels.generated.${key}`);
    }
    for (const format of [LEVEL_FORMATS.TWIST, LEVEL_FORMATS.PRECISION, LEVEL_FORMATS.ARSENAL]) {
      for (const key of ['label', 'description']) {
        assert.equal(typeof texts.formats?.[format]?.[key], 'string', `${lang}: levels.generated.formats.${format}.${key}`);
      }
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
      assert.deepEqual(chapter.featuredMechanics, catalog.summarize(chapter.firstId).featuredMechanics);
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

const totalSpecials = (inventory) => Object.values(inventory).reduce((sum, count) => sum + count, 0);

test('Each block of ten levels follows the format pattern, its landmark first', () => {
  const { pattern } = generated.formats;
  assert.equal(pattern.length, generated.landmarkInterval, 'one format per level of a landmark block');
  assert.equal(pattern[0], LEVEL_FORMATS.LANDMARK, 'the landmark closes each block');
  for (const format of pattern) {
    assert.ok(Object.values(LEVEL_FORMATS).includes(format), `unknown format ${format}`);
  }
  const catalog = createCatalog();
  for (const id of generatedIds()) {
    const summary = catalog.summarize(id);
    assert.equal(summary.format, pattern[id % pattern.length], `level ${id}`);
    assert.equal(summary.isLandmark, summary.format === LEVEL_FORMATS.LANDMARK, `level ${id}`);
  }
});

test('No chapter repeats the mechanics of an earlier one', () => {
  const seen = new Set();
  for (const chapter of createCatalog().listChapters().filter((entry) => !entry.isTutorial)) {
    const key = [...chapter.featuredMechanics].sort().join('+');
    assert.ok(!seen.has(key), `chapter ${chapter.index} repeats ${key}`);
    seen.add(key);
  }
});

test('A twist level adds a mechanic from another chapter, and the board shows it', () => {
  const catalog = createCatalog();
  for (const id of generatedIds()) {
    const levelDef = catalog.get(id);
    if (levelDef.format !== LEVEL_FORMATS.TWIST) {
      assert.equal(levelDef.twistMechanic, null, `level ${id} is no twist`);
      continue;
    }
    const twist = levelDef.twistMechanic;
    assert.ok(generated.featuredMechanics.includes(twist), `level ${id}: ${twist} is a featured mechanic`);
    assert.ok(!levelDef.featuredMechanics.includes(twist), `level ${id}: ${twist} is not the chapter's own`);
    // The twist format picks a board with room for one sphere of each mechanic it announces.
    for (const mechanic of [...levelDef.featuredMechanics, twist]) {
      assert.ok(levelDef.minModifierCounts[mechanic] > 0, `level ${id} (${levelDef.shapeIds.join('+')}) guarantees ${mechanic}`);
    }
  }
});

test('The twist levels of a chapter show as many different mechanics as the pool allows', () => {
  const { pattern } = generated.formats;
  const { TWIST, STANDARD } = LEVEL_FORMATS;
  // The shipped pattern, then a shorter and a longer one, so the pick holds whatever the length.
  const patterns = [pattern, pattern.slice(0, -2), [...pattern, STANDARD, TWIST]];
  for (const candidatePattern of patterns) {
    const catalog = new LevelCatalog({
      levelsConfig,
      campaignConfig: { generated: { ...generated, formats: { ...generated.formats, pattern: candidatePattern } } },
      fluxConfig,
      obstaclesConfig,
      ballRadius: BALL_RADIUS
    });
    const twistsByChapter = new Map();
    for (const id of generatedIds()) {
      const summary = catalog.summarize(id);
      if (summary.format === TWIST) {
        twistsByChapter.set(summary.chapter, [...(twistsByChapter.get(summary.chapter) || []), summary]);
      }
    }
    for (const [chapter, twists] of twistsByChapter) {
      const poolSize = generated.featuredMechanics.length - twists[0].featuredMechanics.length;
      const distinct = new Set(twists.map((summary) => summary.twistMechanic)).size;
      assert.equal(
        distinct,
        Math.min(twists.length, poolSize),
        `pattern of ${candidatePattern.length}, chapter ${chapter}: ${distinct} mechanics over ${twists.length} twists`
      );
    }
  }
});

test('Precision levels are small with one bomb, arsenal levels big with twice the specials', () => {
  const catalog = createCatalog();
  const base = totalSpecials(generated.specialInventory.base);
  const spheresByChapter = new Map();
  for (const id of generatedIds()) {
    const levelDef = catalog.get(id);
    if (levelDef.format === LEVEL_FORMATS.PRECISION) {
      assert.deepEqual(levelDef.specialInventory, generated.formats.precision.specialInventory, `level ${id}`);
    } else if (levelDef.format === LEVEL_FORMATS.ARSENAL) {
      assert.equal(totalSpecials(levelDef.specialInventory), base * generated.formats.arsenal.specialInventoryFactor, `level ${id}`);
    }
    const key = `${levelDef.chapter}:${levelDef.format}`;
    spheresByChapter.set(key, [...(spheresByChapter.get(key) || []), levelDef.spec.balls.length]);
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  let smaller = 0;
  let bigger = 0;
  const chapterCount = Math.ceil(generated.count / generated.chapterSize);
  for (let chapter = 1; chapter <= chapterCount; chapter++) {
    const standard = mean(spheresByChapter.get(`${chapter}:${LEVEL_FORMATS.STANDARD}`));
    smaller += mean(spheresByChapter.get(`${chapter}:${LEVEL_FORMATS.PRECISION}`)) < standard ? 1 : 0;
    bigger += mean(spheresByChapter.get(`${chapter}:${LEVEL_FORMATS.ARSENAL}`)) > standard ? 1 : 0;
  }
  assert.equal(smaller, chapterCount, 'precision boards are smaller than the standard ones of their chapter');
  assert.equal(bigger, chapterCount, 'arsenal boards are bigger than the standard ones of their chapter');
});

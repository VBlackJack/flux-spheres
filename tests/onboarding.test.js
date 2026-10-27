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
import { BOARD_MECHANICS, CLUSTER_MODIFIERS, OBSTACLE_TYPES } from '../src/core/Constants.js';
import {
  listBoardMechanics,
  listLevelMechanics,
  listMechanicsSharingHint,
  resolveHintText
} from '../src/game/Discovery.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = loadJson('./configs/game.json');
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const audioConfig = loadJson('./configs/audio.json');
const fluxConfig = loadJson('./configs/flux.json');
const locales = { fr: loadJson('./locales/fr.json'), en: loadJson('./locales/en.json') };

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('audio', audioConfig);
configRegistry.configs.set('flux', fluxConfig);

const onboarding = gameConfig.onboarding;
const levels = levelsConfig.levels;

/** The first level teaches matching and avalanches with a small palette. */
const FIRST_LEVEL_MAX_COLORS = 3;

const ALL_MECHANICS = [
  ...Object.values(CLUSTER_MODIFIERS),
  ...Object.values(OBSTACLE_TYPES),
  ...Object.values(BOARD_MECHANICS)
].sort();

const lookup = (dict, key) => key.split('.').reduce((node, part) => node?.[part], dict);

/** A strict translator: a missing key or an unfilled placeholder fails the test. */
const strictTranslator = (lang) => (key, params = {}) => {
  const text = lookup(locales[lang], key);
  assert.equal(typeof text, 'string', `${lang}: ${key} has a text`);
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    assert.ok(name in params, `${lang}: ${key} gets {{${name}}}`);
    return String(params[name]);
  });
};

const createTestStorage = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  return storageManager;
};

const createTestEngine = (storageManager = createTestStorage()) =>
  new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    fluxConfig,
    audioManager: { playEffect: () => {}, stopAll: () => {}, isMuted: () => true, setMuted: () => {} },
    storageManager,
    onStateChange: () => {}
  });

/** Plays one turn without physics: the engine's own end-of-turn path runs. */
const playTurn = (engine) => {
  engine.hasFiredInRound = true;
  engine.handlePostTurnCleanup(true);
};

test('Every mechanic has a discovery entry and a place in the discovery order', () => {
  assert.deepEqual(Object.keys(onboarding.mechanics).sort(), ALL_MECHANICS);
  assert.deepEqual([...onboarding.order].sort(), ALL_MECHANICS, 'order lists each mechanic once');
  assert.ok(onboarding.hintShotLimit > 0, 'a hint gives way after a positive number of shots');
});

test('Every mechanic resolves a hint text in both languages', () => {
  for (const lang of Object.keys(locales)) {
    const translate = strictTranslator(lang);
    for (const id of ALL_MECHANICS) {
      const text = resolveHintText(id, onboarding, ballsConfig, translate);
      assert.ok(text.trim().length > 0, `${lang}: ${id} has a hint`);
    }
  }
});

test('Mechanics that share a tutorial are discovered together', () => {
  const cores = listMechanicsSharingHint(CLUSTER_MODIFIERS.FREEZE_CORE, onboarding.mechanics).sort();
  assert.deepEqual(cores, [
    CLUSTER_MODIFIERS.FREEZE_CORE,
    CLUSTER_MODIFIERS.LIGHTNING_CORE,
    CLUSTER_MODIFIERS.PAINT_CORE
  ].sort());
  assert.deepEqual(listMechanicsSharingHint(CLUSTER_MODIFIERS.ARMORED, onboarding.mechanics), [
    CLUSTER_MODIFIERS.ARMORED
  ]);
});

test('A level tutorial teaches a known mechanic, and the level guarantees it', () => {
  for (const level of levels.filter((lvl) => lvl.tutorialKey)) {
    const taught = Object.keys(onboarding.mechanics).filter(
      (id) => onboarding.mechanics[id].hintKey === level.tutorialKey
    );
    assert.ok(taught.length > 0, `level ${level.id}: ${level.tutorialKey} explains a mechanic`);
    const guaranteed = listLevelMechanics(level, { guaranteedOnly: true });
    for (const id of taught) {
      assert.ok(guaranteed.has(id), `level ${level.id} teaches ${id}, so it must always show it`);
    }
  }
});

test('A level teaching a modifier sets its exact count: a minimum and no random weight', () => {
  const modifierIds = new Set(Object.values(CLUSTER_MODIFIERS));
  for (const level of levels.filter((lvl) => lvl.tutorialKey)) {
    // Mechanics the layout or the obstacles provide on their own need no count.
    const fromLayout = listLevelMechanics({ ...level, modifierWeights: {}, minModifierCounts: {} });
    const taught = Object.keys(onboarding.mechanics).filter(
      (id) => onboarding.mechanics[id].hintKey === level.tutorialKey && modifierIds.has(id) && !fromLayout.has(id)
    );
    for (const id of taught) {
      assert.ok((level.minModifierCounts?.[id] || 0) > 0, `level ${level.id} sets a count of ${id}`);
      assert.ok(!(level.modifierWeights?.[id] > 0), `level ${level.id} does not roll extra ${id}`);
    }
  }
});

test('Level 1 shows only the basics: no obstacle, modifier or special ball, few colors', () => {
  const first = levels[0];
  assert.deepEqual([...listLevelMechanics(first)], [BOARD_MECHANICS.BASICS]);
  assert.ok(first.paletteCount <= FIRST_LEVEL_MAX_COLORS, `at most ${FIRST_LEVEL_MAX_COLORS} colors`);
  for (const [type, count] of Object.entries(first.specialInventory)) {
    assert.equal(count, 0, `no ${type} ball on level 1`);
  }
});

test('A board lists the basics, its modifiers, its obstacles and its rail anchors', () => {
  const present = listBoardMechanics(
    [{ clusterModifier: CLUSTER_MODIFIERS.ARMORED, railMinX: null }, { clusterModifier: null, railMinX: 40 }],
    [{ type: OBSTACLE_TYPES.BUMPER }]
  );
  assert.deepEqual([...present].sort(), [
    BOARD_MECHANICS.BASICS,
    BOARD_MECHANICS.RAIL,
    CLUSTER_MODIFIERS.ARMORED,
    OBSTACLE_TYPES.BUMPER
  ].sort());
});

test('A new player sees the basics hint once, never again on a retry', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  assert.equal(engine.activeDiscoveryId, BOARD_MECHANICS.BASICS);
  assert.equal(engine.storageManager.getDiscoveries()[BOARD_MECHANICS.BASICS], true);

  engine.dismissDiscovery();
  assert.equal(engine.activeDiscoveryId, null);
  engine.startCampaignLevel(1);
  assert.equal(engine.activeDiscoveryId, null, 'a retry does not show the hint again');
  assert.equal(engine.levelTutorialKey, levels[0].tutorialKey, 'the Pause tip keeps the level tutorial');
});

test('A hint left open gives way to the next one after the configured number of turns', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(2);
  assert.equal(engine.activeDiscoveryId, BOARD_MECHANICS.BASICS);
  for (let i = 0; i < onboarding.hintShotLimit; i++) {
    playTurn(engine);
  }
  assert.equal(engine.activeDiscoveryId, OBSTACLE_TYPES.PIVOT, 'the rotor hint follows the basics');
  assert.equal(engine.storageManager.getDiscoveries()[OBSTACLE_TYPES.PIVOT], true);
});

test('A dismissed hint lets the next one in at the end of the following turn', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(2);
  engine.dismissDiscovery();
  assert.equal(engine.activeDiscoveryId, null);
  playTurn(engine);
  assert.equal(engine.activeDiscoveryId, OBSTACLE_TYPES.PIVOT);
});

test('A mechanic met before its campaign level is explained where it appears', () => {
  const engine = createTestEngine();
  engine.storageManager.markDiscovered([BOARD_MECHANICS.BASICS]);
  engine.startFluxRun('discovery-seed');
  const present = listBoardMechanics(engine.physicsWorld.balls, engine.physicsWorld.obstacles);
  const expected = onboarding.order.find((id) => present.has(id) && id !== BOARD_MECHANICS.BASICS) || null;
  assert.equal(engine.activeDiscoveryId, expected);
});

test('Survival boards trigger discovery hints too', () => {
  const engine = createTestEngine();
  engine.startEndlessMode();
  assert.equal(engine.activeDiscoveryId, BOARD_MECHANICS.BASICS);
});

test('A saved run keeps its open hint, and a restore marks nothing it did not show', () => {
  const storage = createTestStorage();
  const engine = createTestEngine(storage);
  engine.startCampaignLevel(2);
  engine.hasFiredInRound = true;
  engine.saveRunSnapshot();
  const seenBefore = { ...storage.getDiscoveries() };

  const resumed = createTestEngine(storage);
  assert.equal(resumed.restoreSavedRun(), true);
  assert.equal(resumed.activeDiscoveryId, BOARD_MECHANICS.BASICS);
  assert.deepEqual(storage.getDiscoveries(), seenBefore);
});

test('A returning player does not get hints for the levels already played', () => {
  const storage = createTestStorage();
  const reachedLevel = 5;
  storage.unlockLevel(reachedLevel);
  const engine = createTestEngine(storage);
  const seen = storage.getDiscoveries();
  for (const level of levels.filter((lvl) => lvl.id < reachedLevel)) {
    for (const id of listLevelMechanics(level)) {
      assert.equal(seen[id], true, `${id} from level ${level.id} counts as known`);
    }
  }
  assert.notEqual(seen[OBSTACLE_TYPES.PORTAL], true, 'a mechanic from a later level stays new');
  engine.startCampaignLevel(1);
  assert.equal(engine.activeDiscoveryId, null);
});

test('Showing the hints again forgets every discovery and explains the board at once', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(2);
  engine.dismissDiscovery();
  playTurn(engine);
  engine.dismissDiscovery();
  assert.equal(engine.storageManager.getDiscoveries()[OBSTACLE_TYPES.PIVOT], true);

  engine.resetDiscoveries();
  assert.equal(engine.activeDiscoveryId, BOARD_MECHANICS.BASICS);
  assert.deepEqual(engine.storageManager.getDiscoveries(), { [BOARD_MECHANICS.BASICS]: true });
});

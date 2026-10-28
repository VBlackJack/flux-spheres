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

/*
 * Calibrates the generated campaign levels with two bots, outside CI (scripts/bot).
 *
 * For each level the greedy bot, which never plays a special ball, plays
 * `calibration.runs` games. A level it wins less often than `calibration.minWinRate` gets
 * extra shots, then another seed variant, until one passes; if none does, the most
 * winnable candidate is kept. The bot named by `calibration.starPolicy` then plays the
 * chosen candidate, and star thresholds come from its median score over all its games.
 * The result, with each level's fingerprint, is written to configs/campaignTuning.json;
 * tests/campaign.test.js fails on any level whose board no longer matches the fingerprint
 * it was measured with.
 *
 * Usage: node scripts/calibrate-campaign.mjs [--from <id>] [--to <id>] [--workers <n>] [--dry-run]
 * Levels outside the range keep their current entry. --dry-run prints the measures of
 * both bots and writes nothing.
 */

import fs from 'node:fs';
import os from 'node:os';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { configRegistry } from '../src/core/ConfigRegistry.js';
import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { LevelCatalog, fingerprintLevel, starThresholdsFromMedian } from '../src/game/LevelCatalog.js';
import { BOT_POLICIES, playGame } from './bot/CampaignBot.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TUNING_PATH = `${REPO_ROOT}configs/campaignTuning.json`;
const WORKER_FLAG = '--worker';
const DRY_RUN_FLAG = '--dry-run';
/** Workers left free for the rest of the machine. */
const SPARE_CORES = 2;
/** Linear congruential generator (Numerical Recipes), so every measure can be replayed. */
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_RANGE = 4294967296;
/** Seed offset between two seed variants of a level, so their games differ. */
const VARIANT_SEED_STRIDE = 7919;
const JSON_INDENT = '  ';

const loadJson = (name) => JSON.parse(fs.readFileSync(`${REPO_ROOT}configs/${name}`, 'utf8'));

function loadConfigs() {
  const configs = {
    game: applyWorldGeometry(loadJson('game.json')),
    physics: loadJson('physics.json'),
    balls: loadJson('balls.json'),
    obstacles: loadJson('obstacles.json'),
    levels: loadJson('levels.json'),
    campaign: loadJson('campaign.json'),
    audio: loadJson('audio.json'),
    flux: loadJson('flux.json')
  };
  for (const [key, value] of Object.entries(configs)) {
    configRegistry.configs.set(key, value);
  }
  return configs;
}

const SILENT_AUDIO = Object.freeze({ playEffect() {}, stopAll() {}, isMuted: () => true, setMuted() {} });

function createEngine(configs, campaignTuning) {
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
    audioManager: SILENT_AUDIO,
    storageManager,
    onStateChange() {}
  });
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Plays one candidate (seed variant and extra shots) of a level `runs` times with a bot. */
function measureCandidate(configs, levelId, candidate, policy = BOT_POLICIES.GREEDY) {
  const calibration = configs.campaign.generated.calibration;
  const tuning = { levels: { [levelId]: candidate } };
  let seed = calibration.bot.randomSeedBase + levelId + candidate.variant * VARIANT_SEED_STRIDE;
  Math.random = () => {
    seed = (Math.imul(seed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return seed / UINT32_RANGE;
  };
  const scores = [];
  const specialsUsed = [];
  let wins = 0;
  for (let run = 0; run < calibration.runs; run++) {
    const game = playGame(createEngine(configs, tuning), levelId, calibration.bot, policy);
    scores.push(game.score);
    specialsUsed.push(game.specialsUsed);
    wins += game.won ? 1 : 0;
  }
  return {
    ...candidate,
    winRate: wins / calibration.runs,
    medianScore: median(scores),
    medianSpecialsUsed: median(specialsUsed)
  };
}

/** Finds the first candidate the bot wins often enough, or else the most winnable one. */
function calibrateLevel(configs, levelId) {
  const generated = configs.campaign.generated;
  const calibration = generated.calibration;
  const tried = [];
  search: for (let variant = 0; variant < calibration.seedVariants; variant++) {
    for (const extraShots of [0, ...calibration.extraShotSteps]) {
      const result = measureCandidate(configs, levelId, { variant, extraShots });
      tried.push(result);
      if (result.winRate >= calibration.minWinRate) {
        break search;
      }
    }
  }
  const passing = tried.find((result) => result.winRate >= calibration.minWinRate);
  const chosen = passing || tried.reduce((best, result) => (result.winRate > best.winRate ? result : best));
  const candidate = { variant: chosen.variant, extraShots: chosen.extraShots };
  const arsenal = measureCandidate(configs, levelId, candidate, BOT_POLICIES.ARSENAL);
  const starMedian = calibration.starPolicy === BOT_POLICIES.ARSENAL ? arsenal.medianScore : chosen.medianScore;
  const levelDef = new LevelCatalog({
    levelsConfig: configs.levels,
    campaignConfig: configs.campaign,
    campaignTuning: { levels: { [levelId]: candidate } },
    fluxConfig: configs.flux,
    obstaclesConfig: configs.obstacles,
    ballRadius: configs.physics.ball.radius
  }).get(levelId);
  return {
    levelId,
    entry: {
      variant: chosen.variant,
      extraShots: chosen.extraShots,
      starThresholds: starThresholdsFromMedian(starMedian, generated),
      fingerprint: fingerprintLevel(levelDef),
      measured: {
        candidates: tried.length,
        greedy: { winRate: chosen.winRate, medianScore: chosen.medianScore },
        arsenal: {
          winRate: arsenal.winRate,
          medianScore: arsenal.medianScore,
          medianSpecialsUsed: arsenal.medianSpecialsUsed
        }
      }
    }
  };
}

function runWorker() {
  const configs = loadConfigs();
  process.on('message', (levelId) => {
    process.send(calibrateLevel(configs, levelId));
  });
  process.send({ ready: true });
}

function parseArgs(argv, defaults) {
  const options = { ...defaults };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === DRY_RUN_FLAG) {
      options.dryRun = true;
      i--;
      continue;
    }
    const value = Number(argv[i + 1]);
    if (argv[i] === '--from') options.from = value;
    else if (argv[i] === '--to') options.to = value;
    else if (argv[i] === '--workers') options.workers = value;
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return options;
}

function writeTuning(levels, calibration) {
  const ids = Object.keys(levels).map(Number).sort((a, b) => a - b);
  const lines = ids.map((id) => `${JSON_INDENT}${JSON_INDENT}"${id}": ${JSON.stringify(levels[id])}`);
  const header = { runs: calibration.runs, minWinRate: calibration.minWinRate };
  const text = `{\n${JSON_INDENT}"calibration": ${JSON.stringify(header)},\n${JSON_INDENT}"levels": {\n${lines.join(',\n')}\n${JSON_INDENT}}\n}\n`;
  fs.writeFileSync(TUNING_PATH, text);
}

async function runMain() {
  const configs = loadConfigs();
  const catalog = new LevelCatalog({
    levelsConfig: configs.levels,
    campaignConfig: configs.campaign,
    fluxConfig: configs.flux,
    obstaclesConfig: configs.obstacles,
    ballRadius: configs.physics.ball.radius
  });
  const firstGenerated = catalog.firstId + configs.levels.levels.length;
  const options = parseArgs(process.argv.slice(2), {
    from: firstGenerated,
    to: catalog.lastId,
    workers: Math.max(1, os.cpus().length - SPARE_CORES),
    dryRun: false
  });
  const queue = [];
  for (let id = Math.max(options.from, firstGenerated); id <= Math.min(options.to, catalog.lastId); id++) {
    queue.push(id);
  }
  const existing = fs.existsSync(TUNING_PATH) ? JSON.parse(fs.readFileSync(TUNING_PATH, 'utf8')).levels : {};
  const levels = { ...existing };
  const total = queue.length;
  let done = 0;

  await new Promise((resolve, reject) => {
    let running = 0;
    const startWorker = () => {
      const worker = fork(SCRIPT_PATH, [WORKER_FLAG]);
      running++;
      const next = () => {
        const id = queue.shift();
        if (id === undefined) {
          worker.kill();
          return;
        }
        worker.send(id);
      };
      worker.on('message', (message) => {
        if (message.ready) {
          next();
          return;
        }
        levels[message.levelId] = message.entry;
        done++;
        const { candidates, greedy, arsenal } = message.entry.measured;
        console.log(
          `${done}/${total} level ${message.levelId}: greedy win ${greedy.winRate.toFixed(2)} median ${greedy.medianScore}`
          + ` after ${candidates} candidate(s), arsenal win ${arsenal.winRate.toFixed(2)} median ${arsenal.medianScore}`
          + ` specials ${arsenal.medianSpecialsUsed}`
        );
        next();
      });
      worker.on('error', reject);
      worker.on('exit', () => {
        running--;
        if (running === 0) {
          resolve();
        }
      });
    };
    for (let i = 0; i < Math.min(options.workers, total); i++) {
      startWorker();
    }
    if (total === 0) {
      resolve();
    }
  });

  if (options.dryRun) {
    return;
  }
  writeTuning(levels, configs.campaign.generated.calibration);
  console.log(`Wrote ${Object.keys(levels).length} levels to configs/campaignTuning.json`);
}

if (process.argv.includes(WORKER_FLAG)) {
  runWorker();
} else {
  await runMain();
}

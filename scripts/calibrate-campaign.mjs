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
 * For each level both bots play `calibration.runs` games of a candidate: the greedy bot,
 * which never plays a special ball, and the arsenal bot, which plays them as a player
 * would. A candidate the greedy bot wins less often than `calibration.minWinRate`, or the
 * arsenal bot less often than `calibration.minArsenalWinRate`, gives way to one with
 * extra shots, then to another seed variant, until one passes both floors; if none does,
 * the candidate that fails the fewest floors, then the most winnable for the greedy bot,
 * is kept. Star thresholds come from the median score of the bot named by
 * `calibration.starPolicy` over all its games on the chosen candidate.
 * The result, with each level's fingerprint, is written to configs/campaignTuning.json;
 * tests/campaign.test.js fails on any level whose board no longer matches the fingerprint
 * it was measured with.
 *
 * Usage: node scripts/calibrate-campaign.mjs [--from <id>] [--to <id>] [--workers <n>] [--dry-run]
 * Levels outside the range keep their current entry. --dry-run prints the measures of
 * both bots and writes nothing; only a dry run may start on an authored level, which a
 * writing run skips. A candidate whose board is the same as one already tried for the
 * level is skipped. A worker that crashes hands its level back to the queue, up to
 * `calibration.maxLevelAttempts` tries; when a level stays unmeasured, the script writes
 * nothing and exits with code 1. Bad options exit with code 2 and the usage line.
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
/** Options that take an integer value, by flag, with the option key they set. */
const VALUE_FLAGS = Object.freeze({ '--from': 'from', '--to': 'to', '--workers': 'workers' });
const USAGE = 'Usage: node scripts/calibrate-campaign.mjs [--from <id>] [--to <id>] [--workers <n>] [--dry-run]';
const INTEGER_PATTERN = /^\d+$/;
const EXIT_CODES = Object.freeze({ FAILURE: 1, USAGE: 2 });
const MIN_WORKERS = 1;
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

/** The level a candidate (seed variant and extra shots) builds, as the game will see it. */
function buildCandidateLevel(configs, levelId, candidate) {
  return new LevelCatalog({
    levelsConfig: configs.levels,
    campaignConfig: configs.campaign,
    campaignTuning: { levels: { [levelId]: candidate } },
    fluxConfig: configs.flux,
    obstaclesConfig: configs.obstacles,
    ballRadius: configs.physics.ball.radius
  }).get(levelId);
}

/** The win-rate floor of each bot, by policy, as the calibration config names it. */
const FLOOR_KEYS = Object.freeze({
  [BOT_POLICIES.GREEDY]: 'minWinRate',
  [BOT_POLICIES.ARSENAL]: 'minArsenalWinRate'
});

/**
 * Names the bots whose win rate on a candidate lies below their floor. A bot with no
 * measure fails its floor, so a candidate is never accepted on half its evidence.
 * @param {object} measured - The candidate's measures, by policy: `{greedy: {winRate}, arsenal: {winRate}}`.
 * @param {object} calibration - `campaign.generated.calibration`, which holds the floors.
 * @returns {string[]} The failing policies, greedy first; empty when the candidate passes.
 */
export function failedFloors(measured, calibration) {
  return Object.entries(FLOOR_KEYS)
    .filter(([policy, floorKey]) => !(measured[policy]?.winRate >= calibration[floorKey]))
    .map(([policy]) => policy);
}

/**
 * True when a candidate meets the floor of both bots.
 * @param {object} measured - The candidate's measures, by policy (see failedFloors).
 * @param {object} calibration - `campaign.generated.calibration`.
 * @returns {boolean}
 */
export function candidatePasses(measured, calibration) {
  return failedFloors(measured, calibration).length === 0;
}

/**
 * Orders two candidates for the fallback when none passes: fewer failed floors first, then
 * the higher greedy win rate, then the higher arsenal win rate. Negative when `a` is better.
 */
function compareFallback(a, b, calibration) {
  return failedFloors(a, calibration).length - failedFloors(b, calibration).length
    || b.greedy.winRate - a.greedy.winRate
    || b.arsenal.winRate - a.arsenal.winRate;
}

/**
 * Finds the first candidate that passes both floors, or else the best fallback (see
 * compareFallback; the first tried wins a tie). A candidate that builds the same board as
 * one already tried (same fingerprint, as for an authored level, which no tuning changes)
 * is skipped and counted in `measured.skipped`.
 */
function calibrateLevel(configs, levelId) {
  const generated = configs.campaign.generated;
  const calibration = generated.calibration;
  const tried = [];
  const seenFingerprints = new Set();
  let skipped = 0;
  search: for (let variant = 0; variant < calibration.seedVariants; variant++) {
    for (const extraShots of [0, ...calibration.extraShotSteps]) {
      const candidate = { variant, extraShots };
      const fingerprint = fingerprintLevel(buildCandidateLevel(configs, levelId, candidate));
      if (seenFingerprints.has(fingerprint)) {
        skipped++;
        continue;
      }
      seenFingerprints.add(fingerprint);
      const result = {
        ...candidate,
        fingerprint,
        greedy: measureCandidate(configs, levelId, candidate, BOT_POLICIES.GREEDY),
        arsenal: measureCandidate(configs, levelId, candidate, BOT_POLICIES.ARSENAL)
      };
      tried.push(result);
      if (candidatePasses(result, calibration)) {
        break search;
      }
    }
  }
  const chosen = tried.find((result) => candidatePasses(result, calibration))
    || tried.reduce((best, result) => (compareFallback(result, best, calibration) < 0 ? result : best));
  const { greedy, arsenal } = chosen;
  const starMedian = calibration.starPolicy === BOT_POLICIES.ARSENAL ? arsenal.medianScore : greedy.medianScore;
  return {
    levelId,
    entry: {
      variant: chosen.variant,
      extraShots: chosen.extraShots,
      starThresholds: starThresholdsFromMedian(starMedian, generated),
      fingerprint: chosen.fingerprint,
      measured: {
        candidates: tried.length,
        skipped,
        greedy: { winRate: greedy.winRate, medianScore: greedy.medianScore },
        arsenal: {
          winRate: arsenal.winRate,
          medianScore: arsenal.medianScore,
          medianSpecialsUsed: arsenal.medianSpecialsUsed
        }
      }
    }
  };
}

/** The end of a progress line: which floors the chosen candidate failed, if any. */
function describeFloors(measured, calibration) {
  const failed = failedFloors(measured, calibration);
  if (failed.length === 0) {
    return 'both floors met';
  }
  const floors = failed.map((policy) => `${policy} ${calibration[FLOOR_KEYS[policy]]}`);
  return `BELOW FLOOR (${floors.join(', ')}), best candidate kept`;
}

function runWorker() {
  const configs = loadConfigs();
  process.on('message', (levelId) => {
    process.send(calibrateLevel(configs, levelId));
  });
  process.send({ ready: true });
}

/** A command line the script cannot run; main prints it with the usage line. */
export class UsageError extends Error {}

/**
 * Reads the command line. Level ids must lie in the campaign; a writing run starts no
 * earlier than the first generated level (the authored ones carry no tuning), while a dry
 * run may measure an authored level as it is.
 * @param {string[]} argv - Arguments after the script path.
 * @param {object} bounds
 * @param {number} bounds.firstId - First campaign level.
 * @param {number} bounds.firstGenerated - First generated level.
 * @param {number} bounds.lastId - Last campaign level.
 * @param {number} bounds.workers - Default worker count.
 * @returns {{from: number, to: number, workers: number, dryRun: boolean}}
 * @throws {UsageError} On an unknown option, a missing or non-integer value, an id outside
 *   the campaign, fewer than one worker, or a range that holds no level to measure.
 */
export function parseArgs(argv, { firstId, firstGenerated, lastId, workers }) {
  const options = { from: firstGenerated, to: lastId, workers, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === DRY_RUN_FLAG) {
      options.dryRun = true;
      continue;
    }
    const key = VALUE_FLAGS[flag];
    if (!key) {
      throw new UsageError(`Unknown option ${flag}`);
    }
    const text = argv[++i];
    if (text === undefined || !INTEGER_PATTERN.test(text)) {
      throw new UsageError(`${flag} takes a whole number, got ${text === undefined ? 'nothing' : `"${text}"`}`);
    }
    options[key] = Number(text);
  }
  if (options.workers < MIN_WORKERS) {
    throw new UsageError(`--workers must be at least ${MIN_WORKERS}, got ${options.workers}`);
  }
  for (const key of ['from', 'to']) {
    if (options[key] < firstId || options[key] > lastId) {
      throw new UsageError(`--${key} must lie between ${firstId} and ${lastId}, got ${options[key]}`);
    }
  }
  if (options.from > options.to) {
    throw new UsageError(`--from (${options.from}) is after --to (${options.to})`);
  }
  if (!options.dryRun) {
    options.from = Math.max(options.from, firstGenerated);
    if (options.from > options.to) {
      throw new UsageError(`levels ${firstId} to ${firstGenerated - 1} are authored: measure them with ${DRY_RUN_FLAG}`);
    }
  }
  return options;
}

function writeTuning(levels, calibration) {
  const ids = Object.keys(levels).map(Number).sort((a, b) => a - b);
  const lines = ids.map((id) => `${JSON_INDENT}${JSON_INDENT}"${id}": ${JSON.stringify(levels[id])}`);
  const header = {
    runs: calibration.runs,
    minWinRate: calibration.minWinRate,
    minArsenalWinRate: calibration.minArsenalWinRate
  };
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
  let options;
  try {
    options = parseArgs(process.argv.slice(2), {
      firstId: catalog.firstId,
      firstGenerated: catalog.firstId + configs.levels.levels.length,
      lastId: catalog.lastId,
      workers: Math.max(MIN_WORKERS, os.cpus().length - SPARE_CORES)
    });
  } catch (error) {
    if (!(error instanceof UsageError)) {
      throw error;
    }
    console.error(`${error.message}\n${USAGE}`);
    process.exitCode = EXIT_CODES.USAGE;
    return;
  }
  const queue = [];
  for (let id = options.from; id <= options.to; id++) {
    queue.push(id);
  }
  const existing = fs.existsSync(TUNING_PATH) ? JSON.parse(fs.readFileSync(TUNING_PATH, 'utf8')).levels : {};
  const levels = { ...existing };
  const total = queue.length;
  const { calibration } = configs.campaign.generated;
  const { maxLevelAttempts } = calibration;
  const measuredIds = new Set();
  const unmeasured = [];
  const attempts = new Map();
  let failures = 0;

  await new Promise((resolve, reject) => {
    let running = 0;
    const startWorker = () => {
      const worker = fork(SCRIPT_PATH, [WORKER_FLAG]);
      /** The level this worker is measuring, null while it waits for one. */
      let inFlight = null;
      running++;
      const next = () => {
        const id = queue.shift();
        if (id === undefined) {
          // Closing the channel lets the worker leave with code 0.
          worker.disconnect();
          return;
        }
        inFlight = id;
        attempts.set(id, (attempts.get(id) || 0) + 1);
        worker.send(id);
      };
      worker.on('message', (message) => {
        if (message.ready) {
          next();
          return;
        }
        inFlight = null;
        levels[message.levelId] = message.entry;
        measuredIds.add(message.levelId);
        const { candidates, skipped, greedy, arsenal } = message.entry.measured;
        console.log(
          `${measuredIds.size}/${total} level ${message.levelId}: greedy win ${greedy.winRate.toFixed(2)} median ${greedy.medianScore}`
          + ` after ${candidates} candidate(s) and ${skipped} skipped, arsenal win ${arsenal.winRate.toFixed(2)}`
          + ` median ${arsenal.medianScore} specials ${arsenal.medianSpecialsUsed},`
          + ` +${message.entry.extraShots} shots variant ${message.entry.variant}: ${describeFloors(message.entry.measured, calibration)}`
        );
        next();
      });
      worker.on('error', reject);
      worker.on('exit', (code, signal) => {
        running--;
        const crashed = code !== 0 || inFlight !== null;
        if (crashed) {
          failures++;
          const lost = inFlight === null ? 'no level' : `level ${inFlight}`;
          console.error(`Worker ${worker.pid} exited with ${signal || `code ${code}`} while measuring ${lost}`);
        }
        if (inFlight !== null) {
          if (attempts.get(inFlight) < maxLevelAttempts) {
            queue.unshift(inFlight);
          } else {
            unmeasured.push(inFlight);
          }
          // Only a worker that took a level is replaced, so a worker that cannot start ends the run.
          if (queue.length > 0) {
            startWorker();
          }
        }
        if (running === 0) {
          unmeasured.push(...queue.splice(0));
          resolve();
        }
      });
    };
    for (let i = 0; i < Math.min(options.workers, total); i++) {
      startWorker();
    }
  });

  if (unmeasured.length > 0) {
    console.error(
      `${unmeasured.length} level(s) left unmeasured after ${failures} worker failure(s):`
      + ` ${unmeasured.sort((a, b) => a - b).join(', ')}. Nothing was written.`
    );
    process.exitCode = EXIT_CODES.FAILURE;
    return;
  }
  if (failures > 0) {
    console.warn(`${failures} worker failure(s), every level measured on a later attempt`);
  }
  if (options.dryRun) {
    return;
  }
  writeTuning(levels, calibration);
  console.log(`Wrote ${Object.keys(levels).length} levels to configs/campaignTuning.json`);
}

/** True when this file is the script node was started with, not a module imported by a test. */
const isEntryPoint = () => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(SCRIPT_PATH);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

if (isEntryPoint()) {
  if (process.argv.includes(WORKER_FLAG)) {
    runWorker();
  } else {
    await runMain();
  }
}

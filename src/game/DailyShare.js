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

import { GAME_MODES } from '../core/Constants.js';
import { t, formatNumber } from '../core/I18n.js';

/**
 * Shareable result text of every mode that shares one (Daily Challenge, Survival, Flux),
 * plus the time left before the next Daily Challenge. Pure functions, no DOM and no storage.
 */

const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * MS_PER_MINUTE;

/** Number of the challenge played on the epoch day itself. */
const FIRST_CHALLENGE_NUMBER = 1;

const LINE_SEPARATOR = '\n';
const SYMBOL_OVERFLOW_SEPARATOR = ' ';

/**
 * Challenge number of a UTC date key ("YYYY-MM-DD"): the epoch day is challenge 1.
 * @param {string} dateKey - Daily seed date key.
 * @param {string} epochDateKey - Date key of challenge 1.
 * @returns {number}
 */
export function getDailyChallengeNumber(dateKey, epochDateKey) {
  const elapsedDays = Math.round((Date.parse(dateKey) - Date.parse(epochDateKey)) / MS_PER_DAY);
  return elapsedDays + FIRST_CHALLENGE_NUMBER;
}

/**
 * One symbol per wave passed, in order. Past the configured cap the row stops and
 * counts the remaining waves, so a long run still fits in a short message.
 * @param {string[]} waveLog - Kind of each wave passed (WAVE_TYPES values).
 * @param {object} shareConfig - The `share` section of configs/game.json.
 * @returns {string}
 */
function buildWaveRow(waveLog, shareConfig) {
  const shown = waveLog.slice(0, shareConfig.maxWaveSymbols);
  const row = shown.map((type) => shareConfig.waveEmoji[type] ?? shareConfig.waveEmoji.normal).join('');
  const hiddenCount = waveLog.length - shown.length;
  if (hiddenCount <= 0) {
    return row;
  }
  return row + SYMBOL_OVERFLOW_SEPARATOR + t('share.daily.overflow', { count: formatNumber(hiddenCount) });
}

/**
 * Builds the spoiler-free result of a Daily Challenge run: challenge number and mutator,
 * wave and score, one symbol per wave passed, then the game address. Board layout and
 * shot details stay out of it, so the text gives nothing away to someone yet to play.
 * Texts and numbers follow the current locale.
 * @param {object} run
 * @param {string} run.dateKey - Daily seed date key.
 * @param {string|null} run.mutatorKey - Active mutator key, null when none applied.
 * @param {number} run.wave - Wave reached.
 * @param {number} run.score - Final score.
 * @param {string[]} run.waveLog - Kind of each wave passed.
 * @param {string} run.url - Game address appended on the last line.
 * @param {object} shareConfig - The `share` section of configs/game.json.
 * @returns {string}
 */
export function buildDailyShareText({ dateKey, mutatorKey, wave, score, waveLog, url }, shareConfig) {
  const number = getDailyChallengeNumber(dateKey, shareConfig.epochDateKey);
  const header = mutatorKey
    ? t('share.daily.header', { number, mutator: t(`gameplay.mutators.${mutatorKey}`) })
    : t('share.daily.headerNoMutator', { number });
  const stats = t('share.daily.stats', { wave: formatNumber(wave), score: formatNumber(score) });
  const lines = [header, stats];
  const waveRow = buildWaveRow(waveLog || [], shareConfig);
  if (waveRow) {
    lines.push(waveRow);
  }
  lines.push(url);
  return lines.join(LINE_SEPARATOR);
}

/**
 * Builds the result of a Survival run: mode header, wave and score, one symbol per wave
 * passed (omitted when none was), then the game address.
 * @param {object} run
 * @param {number} run.wave - Wave reached.
 * @param {number} run.score - Final score.
 * @param {string[]} [run.waveLog] - Kind of each wave passed.
 * @param {string} run.url - Game address appended on the last line.
 * @param {object} shareConfig - The `share` section of configs/game.json.
 * @returns {string}
 */
function buildSurvivalShareText({ wave, score, waveLog, url }, shareConfig) {
  const lines = [
    t('share.survival.header'),
    t('share.survival.stats', { wave: formatNumber(wave), score: formatNumber(score) })
  ];
  const waveRow = buildWaveRow(waveLog || [], shareConfig);
  if (waveRow) {
    lines.push(waveRow);
  }
  lines.push(url);
  return lines.join(LINE_SEPARATOR);
}

/**
 * Builds the result of a Flux run: mode header, shape reached and score, then the game
 * address. Flux has no waves, so the text has no symbol row.
 * @param {object} run
 * @param {number} run.stage - Flux shape reached.
 * @param {number} run.score - Final score.
 * @param {string} run.url - Game address appended on the last line.
 * @returns {string}
 */
function buildFluxShareText({ stage, score, url }) {
  return [
    t('share.flux.header'),
    t('share.flux.stats', { stage: formatNumber(stage), score: formatNumber(score) }),
    url
  ].join(LINE_SEPARATOR);
}

/**
 * Builds the shareable result of a run in the mode it was played. The campaign never
 * shares, so it is rejected like any unknown mode.
 * @param {object} run - Run summary; `run.mode` is a GAME_MODES value, the other fields
 *   are those of the mode's builder (see buildDailyShareText for the Daily Challenge).
 * @param {object} shareConfig - The `share` section of configs/game.json.
 * @returns {string}
 * @throws {RangeError} When the mode has no shareable result.
 */
export function buildShareText(run, shareConfig) {
  switch (run.mode) {
    case GAME_MODES.DAILY:
      return buildDailyShareText(run, shareConfig);
    case GAME_MODES.ENDLESS:
      return buildSurvivalShareText(run, shareConfig);
    case GAME_MODES.FLUX:
      return buildFluxShareText(run);
    default:
      throw new RangeError(`No shareable result for game mode "${run.mode}"`);
  }
}

/**
 * Milliseconds until the next UTC midnight, when the Daily Challenge seed (the UTC date)
 * changes. Exactly at midnight the challenge has just started, so a full day remains.
 * @param {number} [nowMs=Date.now()] - Current time, in milliseconds since the Unix epoch.
 * @returns {number}
 */
export function getMsUntilNextDaily(nowMs = Date.now()) {
  // The Unix epoch is a UTC midnight, so UTC days are whole multiples of MS_PER_DAY.
  const nextMidnightMs = (Math.floor(nowMs / MS_PER_DAY) + 1) * MS_PER_DAY;
  return nextMidnightMs - nowMs;
}

/**
 * Splits a remaining time into hours and minutes, rounded up to the minute so the
 * countdown never reads zero while time remains.
 * @param {number} ms - Remaining time in milliseconds; negative values count as zero.
 * @returns {{hours: number, minutes: number}}
 */
export function formatDailyCountdown(ms) {
  const totalMinutes = Math.ceil(Math.max(0, ms) / MS_PER_MINUTE);
  return {
    hours: Math.floor(totalMinutes / MINUTES_PER_HOUR),
    minutes: totalMinutes % MINUTES_PER_HOUR
  };
}

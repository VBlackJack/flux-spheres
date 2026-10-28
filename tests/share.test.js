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

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { WAVE_TYPES } from '../src/core/Constants.js';
import { i18n, formatNumber } from '../src/core/I18n.js';
import { buildDailyShareText, getDailyChallengeNumber } from '../src/game/DailyShare.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const shareConfig = loadJson('./configs/game.json').share;
const locales = { en: loadJson('./locales/en.json'), fr: loadJson('./locales/fr.json') };
for (const [locale, dictionary] of Object.entries(locales)) {
  i18n.dictionaries.set(locale, dictionary);
}

// setLocale also translates the page, which does not exist here.
const useLocale = (locale) => {
  i18n.currentLocale = locale;
};

afterEach(() => useLocale('en'));

const DAYS_AFTER_EPOCH = 311;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const dateKeyAfterEpoch = (days) =>
  new Date(Date.parse(shareConfig.epochDateKey) + days * MS_PER_DAY).toISOString().slice(0, shareConfig.epochDateKey.length);

const RUN = Object.freeze({
  dateKey: dateKeyAfterEpoch(DAYS_AFTER_EPOCH),
  mutatorKey: 'hyperGravity',
  wave: 5,
  score: 48300,
  waveLog: [WAVE_TYPES.NORMAL, WAVE_TYPES.GOLD_RUSH, WAVE_TYPES.NORMAL, WAVE_TYPES.BOSS],
  url: shareConfig.url
});

test('The epoch day is challenge 1 and each later UTC day adds one', () => {
  assert.equal(getDailyChallengeNumber(shareConfig.epochDateKey, shareConfig.epochDateKey), 1);
  assert.equal(getDailyChallengeNumber(RUN.dateKey, shareConfig.epochDateKey), DAYS_AFTER_EPOCH + 1);
});

test('The English share text lists challenge, mutator, wave, score, one symbol per wave, then the address', () => {
  useLocale('en');
  const lines = buildDailyShareText(RUN, shareConfig).split('\n');
  const emoji = shareConfig.waveEmoji;
  assert.deepEqual(lines, [
    `FluxSpheres - Daily #${DAYS_AFTER_EPOCH + 1} (${locales.en.gameplay.mutators.hyperGravity})`,
    `Wave 5 - ${formatNumber(RUN.score)} pts`,
    [emoji.normal, emoji.goldRush, emoji.normal, emoji.boss].join(''),
    shareConfig.url
  ]);
});

test('The French share text uses French words and number grouping', () => {
  useLocale('fr');
  const lines = buildDailyShareText(RUN, shareConfig).split('\n');
  assert.equal(lines[0], `FluxSpheres - Défi #${DAYS_AFTER_EPOCH + 1} (${locales.fr.gameplay.mutators.hyperGravity})`);
  assert.equal(lines[1], `Vague 5 - ${new Intl.NumberFormat('fr').format(RUN.score)} pts`);
  assert.equal(lines.at(-1), shareConfig.url);
});

test('A long run shows the capped symbol row and counts the waves left out', () => {
  const extra = 7;
  const waveLog = Array.from({ length: shareConfig.maxWaveSymbols + extra }, () => WAVE_TYPES.NORMAL);
  const lines = buildDailyShareText({ ...RUN, waveLog }, shareConfig).split('\n');
  const capped = shareConfig.waveEmoji.normal.repeat(shareConfig.maxWaveSymbols);
  assert.equal(lines[2], `${capped} +${extra}`);
});

test('A run lost before any wave has no symbol row, and a run without a mutator still gets a header', () => {
  const lines = buildDailyShareText({ ...RUN, mutatorKey: null, wave: 1, waveLog: [] }, shareConfig).split('\n');
  assert.deepEqual(lines, [`FluxSpheres - Daily #${DAYS_AFTER_EPOCH + 1}`, 'Wave 1 - 48,300 pts', shareConfig.url]);
});

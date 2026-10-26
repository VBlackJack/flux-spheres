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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { i18n, resolveInitialLocale } from '../src/core/I18n.js';
import {
  MODAL_FOCUSABLE_SELECTOR,
  filterFocusTrapCandidates,
  shouldIgnoreRepeatedKey
} from '../src/ui/UIManager.js';

const loadJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const gameConfig = loadJson('./configs/game.json');
const SUPPORTED = gameConfig.defaults.supportedLanguages;
const FALLBACK = gameConfig.defaults.language;

test('resolveInitialLocale keeps a supported stored choice over browser preferences', () => {
  assert.equal(resolveInitialLocale('en', SUPPORTED, FALLBACK, ['fr-FR']), 'en');
  assert.equal(resolveInitialLocale('fr', SUPPORTED, FALLBACK, ['en-US']), 'fr');
});

test('resolveInitialLocale uses the first supported browser language on first visit', () => {
  assert.equal(resolveInitialLocale(null, SUPPORTED, FALLBACK, ['en-GB', 'fr']), 'en');
  assert.equal(resolveInitialLocale(null, SUPPORTED, FALLBACK, ['de-DE', 'fr-CA', 'en']), 'fr');
  assert.equal(resolveInitialLocale(undefined, SUPPORTED, FALLBACK, ['EN_us']), 'en');
});

test('resolveInitialLocale falls back to the configured default', () => {
  assert.equal(resolveInitialLocale(null, SUPPORTED, FALLBACK, ['de-DE', 'ja']), FALLBACK);
  assert.equal(resolveInitialLocale(null, SUPPORTED, FALLBACK, []), FALLBACK);
  assert.equal(resolveInitialLocale('xx', SUPPORTED, FALLBACK, ['', null]), FALLBACK);
});

function fakeElement({ tabindex = null, disabled = false, hidden = false, insideHidden = false, rendered = true } = {}) {
  return {
    disabled,
    hidden,
    getAttribute: (name) => (name === 'tabindex' ? tabindex : null),
    closest: () => (insideHidden ? {} : null),
    getClientRects: () => (rendered ? [{}] : [])
  };
}

test('focus-trap selector excludes tabindex="-1" in every branch', () => {
  for (const branch of MODAL_FOCUSABLE_SELECTOR.split(',')) {
    assert.match(branch, /:not\(\[tabindex="-1"\]\)/, `branch "${branch.trim()}" must exclude tabindex=-1`);
  }
});

test('focus-trap filter keeps only reachable elements', () => {
  const reachable = fakeElement({ tabindex: '0' });
  const plainButton = fakeElement();
  const candidates = [
    reachable,
    plainButton,
    fakeElement({ tabindex: '-1' }),
    fakeElement({ disabled: true }),
    fakeElement({ hidden: true }),
    fakeElement({ insideHidden: true }),
    fakeElement({ rendered: false })
  ];
  assert.deepEqual(filterFocusTrapCandidates(candidates), [reachable, plainButton]);
});

test('held-down toggle keys are ignored but aiming arrows keep repeating', () => {
  for (const code of ['Space', 'KeyF', 'Enter', 'Escape', 'Digit1', 'Digit5']) {
    assert.equal(shouldIgnoreRepeatedKey(code, true), true, `${code} repeat must be ignored`);
    assert.equal(shouldIgnoreRepeatedKey(code, false), false, `${code} first press must pass`);
  }
  for (const code of ['ArrowLeft', 'ArrowRight']) {
    assert.equal(shouldIgnoreRepeatedKey(code, true), false, `${code} must keep repeating`);
  }
});

test('formatNumber groups digits per locale and caches one formatter per locale', () => {
  const previous = i18n.currentLocale;
  try {
    i18n.currentLocale = 'en';
    assert.equal(i18n.formatNumber(1234567), new Intl.NumberFormat('en').format(1234567));
    const enFormatter = i18n.numberFormatters.get('en');
    i18n.formatNumber(42);
    assert.equal(i18n.numberFormatters.get('en'), enFormatter);
    i18n.currentLocale = 'fr';
    assert.equal(i18n.formatNumber(1234567), new Intl.NumberFormat('fr').format(1234567));
  } finally {
    i18n.currentLocale = previous;
  }
});

function flattenStrings(node, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      flattenStrings(value, path, out);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

const placeholdersOf = (text) => [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

test('en and fr locales have identical keys and identical placeholders', () => {
  const en = flattenStrings(loadJson('./locales/en.json'));
  const fr = flattenStrings(loadJson('./locales/fr.json'));
  assert.deepEqual([...en.keys()].sort(), [...fr.keys()].sort());
  for (const [key, enText] of en) {
    assert.deepEqual(placeholdersOf(fr.get(key)), placeholdersOf(enText), `placeholders differ for ${key}`);
  }
});

test('every t() key literal used by the UI exists in both locales', () => {
  const en = flattenStrings(loadJson('./locales/en.json'));
  const fr = flattenStrings(loadJson('./locales/fr.json'));
  const sources = [readFileSync('./src/ui/UIManager.js', 'utf8'), readFileSync('./index.html', 'utf8')];
  const keys = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/(?:\bt\(|data-i18n(?:-[a-z-]+)?=)\s*['"]([a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)+)['"]/g)) {
      keys.add(match[1]);
    }
  }
  assert.ok(keys.size > 0, 'the key scan must find keys');
  const missing = [...keys].filter((key) => !en.has(key) || !fr.has(key));
  assert.deepEqual(missing, []);
});

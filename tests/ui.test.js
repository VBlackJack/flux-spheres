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

import { GAME_OVER_REASONS, INPUT_MODES } from '../src/core/Constants.js';
import { I18nService, i18n, resolveInitialLocale } from '../src/core/I18n.js';
import {
  HIGH_CONTRAST_CLASS,
  INPUT_ARIA_HINTS,
  MODAL_FOCUSABLE_SELECTOR,
  canOpenDrawer,
  filterFocusTrapCandidates,
  gameOverReasonKey,
  isBrowserShortcut,
  resolveModalFocusTarget,
  revealLiveRegion,
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

test('browser chords are left to the browser, Shift still aims faster', () => {
  assert.equal(isBrowserShortcut({ ctrlKey: true }), true, 'Ctrl+F opens the find bar');
  assert.equal(isBrowserShortcut({ metaKey: true }), true, 'Cmd+1 switches tabs');
  assert.equal(isBrowserShortcut({ altKey: true }), true, 'Alt+Left goes back');
  assert.equal(isBrowserShortcut({ shiftKey: true }), false);
  assert.equal(isBrowserShortcut({}), false);
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

const mainCss = readFileSync('./styles/main.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Text of the first block opened by `header`, nested blocks included. */
function cssBlock(css, header) {
  const start = css.indexOf(header);
  assert.notEqual(start, -1, `missing CSS block ${header}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') {
      depth++;
    } else if (css[i] === '}' && --depth === 0) {
      return css.slice(start, i + 1);
    }
  }
  return css.slice(start);
}

test('high contrast is a root theme: in-app class, system preference and forced colors', () => {
  const classBlock = cssBlock(mainCss, `:root.${HIGH_CONTRAST_CLASS} {`);
  const preferenceBlock = cssBlock(mainCss, '@media (prefers-contrast: more)');
  for (const token of ['--text-muted', '--bg-panel-alpha-85', '--bg-dark-alpha-78', '--text-gold']) {
    assert.match(classBlock, new RegExp(`${token}:`), `the class theme must raise ${token}`);
    assert.match(preferenceBlock, new RegExp(`${token}:`), `the system theme must raise ${token}`);
  }
  const forcedBlock = cssBlock(mainCss, '@media (forced-colors: active)');
  assert.match(forcedBlock, /\.nav-btn[\s\S]*ButtonText/);
  assert.match(forcedBlock, /:focus-visible\s*\{[^}]*Highlight/);
});

test('colors outside the :root token blocks only reference tokens', () => {
  const withoutTokenBlocks = mainCss.replace(/:root[^{]*\{[^{}]*\}/g, '');
  const literals = withoutTokenBlocks.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g) || [];
  assert.deepEqual(literals, []);
  assert.match(mainCss, /\.gold-text\s*\{\s*color:\s*var\(--text-gold\)/);
});

test('coarse pointers get 44px controls whatever the viewport size', () => {
  const coarse = cssBlock(mainCss, '@media (pointer: coarse)');
  for (const selector of ['.nav-btn', '.nav-btn.icon-btn', '.modal-tab', '.hud-menu-btn', '.powerup-btn']) {
    assert.ok(coarse.includes(selector), `${selector} must be enlarged on touch screens`);
  }
  assert.match(coarse, /min-height:\s*var\(--touch-target\)/);
});

test('the menu cannot open during the victory celebration or over a dialog', () => {
  const base = { isOpen: false, isDrawerLayout: true, isModalOpen: false, isVictoryCelebrating: false };
  assert.equal(canOpenDrawer(base), true);
  assert.equal(canOpenDrawer({ ...base, isVictoryCelebrating: true }), false);
  assert.equal(canOpenDrawer({ ...base, isModalOpen: true }), false);
  assert.equal(canOpenDrawer({ ...base, isDrawerLayout: false }), false);
  assert.equal(canOpenDrawer({ ...base, isOpen: true }), false);
});

test('closing a stacked Confirm sends focus back into the dialog underneath', () => {
  const opener = fakeElement();
  const first = fakeElement();
  const outside = fakeElement();
  const members = new Set([opener, first]);
  const pause = { contains: (el) => members.has(el) };
  assert.equal(resolveModalFocusTarget(pause, outside, opener, [first, opener]), opener);
  assert.equal(resolveModalFocusTarget(pause, outside, null, [first, opener]), first);
  assert.equal(resolveModalFocusTarget(pause, outside, outside, [first]), first, 'an opener outside is ignored');
  assert.equal(resolveModalFocusTarget(pause, first, opener, [first]), null, 'focus already inside stays');
  assert.equal(resolveModalFocusTarget(null, outside, opener, []), null);
});

function fakeRegion(hidden) {
  const classes = new Set(hidden ? ['hidden'] : []);
  return {
    classList: {
      contains: (name) => classes.has(name),
      remove: (name) => classes.delete(name),
      add: (name) => classes.add(name)
    }
  };
}

test('a revealed live region is shown empty and filled on the next frame', () => {
  const region = fakeRegion(true);
  const textElement = { textContent: 'stale tip' };
  const queued = [];
  revealLiveRegion({ region, textElement, text: 'first tip', schedule: (cb) => queued.push(cb) });
  assert.equal(region.classList.contains('hidden'), false);
  assert.equal(textElement.textContent, '', 'the text must not be present when the region appears');
  revealLiveRegion({ region, textElement, text: 'newer tip', schedule: (cb) => queued.push(cb) });
  assert.equal(queued.length, 1);
  queued[0]();
  assert.equal(textElement.textContent, 'newer tip');
  revealLiveRegion({ region, textElement, text: 'next tip', schedule: () => assert.fail('no deferral when visible') });
  assert.equal(textElement.textContent, 'next tip');
});

test('the board text alternative has a touch and a pointer wording in both locales', () => {
  for (const path of ['./locales/en.json', './locales/fr.json']) {
    const strings = flattenStrings(loadJson(path));
    for (const { key } of INPUT_ARIA_HINTS) {
      const pointer = strings.get(`${key}.${INPUT_MODES.POINTER}`);
      const touch = strings.get(`${key}.${INPUT_MODES.TOUCH}`);
      assert.ok(pointer && touch, `${path} must define both wordings of ${key}`);
      assert.notEqual(pointer, touch);
    }
  }
});

test('game-over reasons map to existing texts, unknown reasons to the crossed line', () => {
  const en = flattenStrings(loadJson('./locales/en.json'));
  for (const reason of Object.values(GAME_OVER_REASONS)) {
    assert.ok(en.has(gameOverReasonKey(reason)), `missing text for ${reason}`);
  }
  assert.equal(gameOverReasonKey(undefined), gameOverReasonKey(GAME_OVER_REASONS.LINE_CROSSED));
});

test('t() falls back to another loaded locale before returning the raw key', () => {
  const service = new I18nService();
  service.dictionaries.set('en', { menu: { play: 'Play' } });
  service.dictionaries.set('fr', { menu: { quit: 'Quitter' } });
  service.fallbackLocale = 'en';
  service.currentLocale = 'fr';
  assert.equal(service.t('menu.quit'), 'Quitter');
  assert.equal(service.t('menu.play'), 'Play', 'a key missing in fr comes from en');
  service.dictionaries.delete('fr');
  assert.equal(service.t('menu.play'), 'Play', 'a locale that failed to load uses the fallback');
  assert.equal(service.t('menu.missing'), 'menu.missing');
});

test('a locale that fails to load is replaced by one that loaded', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (path) => {
    if (path.includes('fr')) {
      throw new Error('offline');
    }
    return { ok: true, json: async () => ({ menu: { play: 'Play' } }) };
  };
  try {
    const service = new I18nService();
    await service.init('fr', 'fr');
    assert.equal(service.getLocale(), 'en');
    assert.equal(service.t('menu.play'), 'Play');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

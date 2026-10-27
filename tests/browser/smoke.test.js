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
 * Browser smoke tests: the real page in headless Chromium, at the four layouts the game
 * supports. They catch what the engine tests cannot see: console errors, layout overflow,
 * dialogs that do not open, pause or close, and end-of-round screens.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { GAME_OVER_REASONS, GAME_STATES } from '../../src/core/Constants.js';
import { startStaticServer } from './staticServer.js';

/** The four layouts of styles/main.css: wide desktop, portrait tablet, landscape and portrait phones. */
const VIEWPORTS = Object.freeze([
  { name: 'desktop', width: 1300, height: 850, isTouch: false, hasDrawer: false },
  { name: 'tablet', width: 768, height: 1024, isTouch: true, hasDrawer: false },
  { name: 'phone landscape', width: 844, height: 390, isTouch: true, hasDrawer: false },
  { name: 'phone portrait', width: 390, height: 844, isTouch: true, hasDrawer: true }
]);

/** Controls whose text must fit: a clipped label is a layout regression. */
const FITTED_TEXT_SELECTOR =
  '.nav-btn, .modal-btn, .modal-tab, .powerup-btn, .powerup-name, .launcher-caption, .hud-label, .hud-value';

/** Sub-pixel rounding tolerance when comparing scroll and client sizes. */
const OVERFLOW_TOLERANCE_PX = 1;

/** Upper bound for any wait on the page, so a broken page fails instead of hanging. */
const WAIT_TIMEOUT_MS = 10000;

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

let server;
let browser;

before(async () => {
  server = await startStaticServer(APP_ROOT);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * Opens the game in a fresh profile and records every console error and uncaught exception.
 * The engine is reached through a prototype hook installed after load, so the game code
 * carries no test-only entry point.
 */
async function openGame(viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.isTouch,
    isMobile: viewport.isTouch,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(WAIT_TIMEOUT_MS);
  await page.goto(server.origin);
  await captureEngine(page);
  return { context, page, errors };
}

async function captureEngine(page) {
  await page.evaluate(async () => {
    const { GameEngine } = await import('/src/game/GameEngine.js');
    const original = GameEngine.prototype.getTimeScale;
    // The game loop asks for the time scale on every frame, paused or not.
    GameEngine.prototype.getTimeScale = function captureAndScale(...args) {
      window.__fluxEngine = this;
      return original.apply(this, args);
    };
  });
  await page.waitForFunction(() => Boolean(window.__fluxEngine));
}

const engineState = (page) => page.evaluate(() => window.__fluxEngine.state);

const isShown = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return Boolean(el) && !el.classList.contains('hidden') && el.checkVisibility();
  }, selector);

async function waitShown(page, selector) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el) && !el.classList.contains('hidden') && el.checkVisibility();
    },
    selector
  );
}

/** Starts a run from a known state: level 1, playing, nothing open. */
async function startLevelOne(page) {
  await page.evaluate(() => {
    const engine = window.__fluxEngine;
    engine.startCampaignLevel(1);
    engine.notifyUI();
  });
  await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
}

/** Clicks a header control; on portrait phones it sits in the slide-in menu. */
async function clickMenuButton(page, viewport, selector) {
  if (viewport.hasDrawer) {
    await page.click('#btn-menu');
  }
  await page.click(selector);
}

for (const viewport of VIEWPORTS) {
  describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test('boots without console errors, scrolls nowhere and clips no control label', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await startLevelOne(page);
        const layout = await page.evaluate(
          ({ selector, tolerance }) => {
            const clipped = [...document.querySelectorAll(selector)]
              .filter((el) => el.checkVisibility() && el.offsetWidth > tolerance)
              .filter((el) => el.scrollWidth > el.clientWidth + tolerance)
              .map((el) => `${el.id || el.className}: "${el.textContent.trim()}"`);
            return {
              pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
              clipped
            };
          },
          { selector: FITTED_TEXT_SELECTOR, tolerance: OVERFLOW_TOLERANCE_PX }
        );
        assert.ok(layout.pageOverflow <= OVERFLOW_TOLERANCE_PX, `the page scrolls sideways by ${layout.pageOverflow}px`);
        assert.deepEqual(layout.clipped, []);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('Settings, Levels and Workshop pause the run and Escape closes them', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await startLevelOne(page);
        for (const { button, dialog } of [
          { button: '#btn-settings', dialog: '#modal-settings' },
          { button: '#btn-levels', dialog: '#modal-levels' },
          { button: '#btn-shop', dialog: '#modal-shop' }
        ]) {
          await clickMenuButton(page, viewport, button);
          await waitShown(page, dialog);
          assert.equal(await engineState(page), GAME_STATES.PAUSED, `${dialog} pauses the run`);
          assert.ok(
            await page.evaluate((sel) => document.querySelector(sel).contains(document.activeElement), dialog),
            `${dialog} takes focus`
          );
          await page.keyboard.press('Escape');
          await page.waitForFunction((sel) => document.querySelector(sel).classList.contains('hidden'), dialog);
          assert.equal(await engineState(page), GAME_STATES.PLAYING, `closing ${dialog} resumes the run`);
          assert.equal(await isShown(page, '#modal-pause'), false, `closing ${dialog} leaves no Pause dialog`);
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('Pause opens its dialog and Resume closes it', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await startLevelOne(page);
        await clickMenuButton(page, viewport, '#btn-pause');
        await waitShown(page, '#modal-pause');
        assert.equal(await engineState(page), GAME_STATES.PAUSED);
        await page.click('#btn-resume');
        await page.waitForFunction(() => document.querySelector('#modal-pause').classList.contains('hidden'));
        assert.equal(await engineState(page), GAME_STATES.PLAYING);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}

describe('end of round (desktop)', () => {
  const desktop = VIEWPORTS[0];

  test('clearing the board shows the victory screen, and Next Level starts level 2', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        engine.physicsWorld.balls.length = 0;
        engine.physicsWorld.ballMap.clear();
        engine.evaluateRoundEnd();
      });
      await waitShown(page, '#modal-victory');
      const victory = await page.evaluate(() => ({
        focused: document.activeElement?.id,
        stars: document.querySelector('#victory-stars').textContent.trim(),
        score: document.querySelector('#victory-score').textContent.trim()
      }));
      assert.equal(victory.focused, 'btn-next-level');
      assert.ok(victory.stars.length > 0 && victory.score.length > 0, 'the victory screen states stars and score');
      await page.click('#btn-next-level');
      await page.waitForFunction(() => window.__fluxEngine.currentLevelId === 2);
      assert.equal(await isShown(page, '#modal-victory'), false);
      assert.equal(await engineState(page), GAME_STATES.PLAYING);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a lost run shows the game over screen with its reason, and Retry restarts', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      await page.evaluate((reason) => window.__fluxEngine.triggerGameOver(reason), GAME_OVER_REASONS.OUT_OF_SHOTS);
      await waitShown(page, '#modal-gameover');
      const reason = await page.evaluate(() => document.querySelector('#gameover-reason').textContent.trim());
      assert.ok(reason.length > 0, 'the game over screen states why');
      await page.click('#btn-retry');
      await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
      assert.equal(await isShown(page, '#modal-gameover'), false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  test('a run saved after its discovery hint was dismissed resumes, paused, after a reload', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        engine.dismissDiscovery();
        engine.hasFiredInRound = true;
        engine.score = 1234;
        engine.saveRunSnapshot();
      });
      await page.reload();
      await captureEngine(page);
      await waitShown(page, '#modal-pause');
      assert.equal(await page.evaluate(() => window.__fluxEngine.score), 1234, 'the saved score is back');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

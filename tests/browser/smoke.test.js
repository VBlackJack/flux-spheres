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
 * Browser smoke tests: the real page in headless Chromium, at the layouts the game
 * supports. They catch what the engine tests cannot see: console errors, layout overflow,
 * dialogs that do not open, pause or close, and end-of-round screens.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { GAME_MODES, GAME_OVER_REASONS, GAME_STATES } from '../../src/core/Constants.js';
import { startStaticServer } from './staticServer.js';

/**
 * The layouts of styles/main.css: wide desktop, portrait tablet, landscape and portrait
 * phones, and a narrow portrait phone where the eight-button control row is the tightest.
 * hasRestartButton: the header (or its slide-in menu) shows Restart; the landscape phone
 * layout leaves it to the Pause dialog.
 */
const VIEWPORTS = Object.freeze([
  { name: 'desktop', width: 1300, height: 850, isTouch: false, hasDrawer: false, hasRestartButton: true },
  { name: 'tablet', width: 768, height: 1024, isTouch: true, hasDrawer: false, hasRestartButton: true },
  { name: 'phone landscape', width: 844, height: 390, isTouch: true, hasDrawer: false, hasRestartButton: false },
  { name: 'phone portrait', width: 390, height: 844, isTouch: true, hasDrawer: true, hasRestartButton: true },
  { name: 'narrow phone portrait', width: 360, height: 800, isTouch: true, hasDrawer: true, hasRestartButton: true }
]);

/** Controls whose text must fit: a clipped label is a layout regression. */
const FITTED_TEXT_SELECTOR =
  '.nav-btn, .modal-btn, .modal-tab, .powerup-btn, .powerup-name, .launcher-caption, .hud-label, .hud-value';

/** Sub-pixel rounding tolerance when comparing scroll and client sizes. */
const OVERFLOW_TOLERANCE_PX = 1;
/** A generated level in a later chapter, for the level select test. */
const UNLOCKED_GENERATED_LEVEL = 130;

/** Upper bound for any wait on the page, so a broken page fails instead of hanging. */
const WAIT_TIMEOUT_MS = 20000;

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

/** Starts a campaign level from a known state: playing, nothing open. */
async function startLevel(page, levelId) {
  await page.evaluate((id) => {
    const engine = window.__fluxEngine;
    engine.startCampaignLevel(id);
    engine.notifyUI();
  }, levelId);
  await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
}

const startLevelOne = (page) => startLevel(page, 1);

/** Level 1 hands out no special ball; level 2 is the first that shows their slots. */
const LEVELS_WITHOUT_AND_WITH_SPECIALS = [
  { levelId: 1, showsSpecials: false },
  { levelId: 2, showsSpecials: true }
];

/** Fails when the page scrolls sideways or a visible control label is clipped. */
async function assertLayoutFits(page, levelId) {
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
  assert.ok(
    layout.pageOverflow <= OVERFLOW_TOLERANCE_PX,
    `level ${levelId}: the page scrolls sideways by ${layout.pageOverflow}px`
  );
  assert.deepEqual(layout.clipped, [], `level ${levelId}: clipped labels`);
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
        for (const { levelId, showsSpecials } of LEVELS_WITHOUT_AND_WITH_SPECIALS) {
          await startLevel(page, levelId);
          // The bar itself is display: contents on portrait phones, so check one of its buttons.
          assert.equal(await isShown(page, '#powerups-bar .powerup-btn'), showsSpecials, `level ${levelId} special ball slots`);
          await assertLayoutFits(page, levelId);
        }
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

    // Only where Restart sits in the header: elsewhere it is in the Pause dialog, reached from a pause.
    if (viewport.hasRestartButton) {
      test('the Confirm of a mid-round Restart holds the run until it is dismissed', async () => {
        const { context, page, errors } = await openGame(viewport);
        try {
          await startLevelOne(page);
          await page.evaluate(() => {
            const engine = window.__fluxEngine;
            engine.dismissDiscovery();
            engine.shoot();
          });
          assert.ok(await page.evaluate(() => window.__fluxEngine.hasFiredInRound), 'one shot is fired');
          for (const dismiss of [() => page.click('#btn-confirm-no'), () => page.keyboard.press('Escape')]) {
            await clickMenuButton(page, viewport, '#btn-restart');
            await waitShown(page, '#modal-confirm');
            assert.equal(await engineState(page), GAME_STATES.PAUSED, 'the Confirm pauses the run');
            assert.equal(await isShown(page, '#modal-pause'), false, 'the Confirm opens no Pause dialog');
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-confirm-no');
            await dismiss();
            await page.waitForFunction(() => document.querySelector('#modal-confirm').classList.contains('hidden'));
            assert.equal(await engineState(page), GAME_STATES.PLAYING, 'dismissing the Confirm resumes the run');
            assert.equal(await isShown(page, '#modal-pause'), false, 'dismissing the Confirm leaves no Pause dialog');
          }
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }

    test('The level select opens on the chapter of the current level and switches chapters', async () => {
      const { context, page, errors } = await openGame(viewport);
      try {
        await page.waitForFunction(() => Boolean(window.__fluxEngine));
        await page.evaluate((levelId) => window.__fluxEngine.storageManager.unlockLevel(levelId), UNLOCKED_GENERATED_LEVEL);
        // The game opens on the furthest unlocked level, which the dialog then suggests.
        await page.reload();
        await captureEngine(page);
        await clickMenuButton(page, viewport, '#btn-levels');
        await waitShown(page, '#modal-levels');
        const opened = await page.evaluate(() => ({
          activeTabs: document.querySelectorAll('#levels-chapters [role="tab"][aria-selected="true"]').length,
          currentCard: document.querySelector('#levels-grid .level-card.current .level-card-header')?.textContent || '',
          cardCount: document.querySelectorAll('#levels-grid .level-card').length,
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth
        }));
        assert.equal(opened.activeTabs, 1, 'one chapter is selected');
        assert.ok(opened.currentCard.includes(String(UNLOCKED_GENERATED_LEVEL)), `the dialog shows level ${UNLOCKED_GENERATED_LEVEL}`);
        assert.ok(opened.cardCount < UNLOCKED_GENERATED_LEVEL, 'only the chapter is listed');
        assert.ok(opened.pageOverflow <= OVERFLOW_TOLERANCE_PX, 'the chapter strip does not widen the page');

        await page.click('#levels-chapters [role="tab"]:first-child');
        const firstCard = await page.textContent('#levels-grid .level-card .level-card-header');
        assert.match(firstCard, /\b1\b/, 'the first chapter starts at level 1');
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

describe('precise aim (desktop)', () => {
  const desktop = VIEWPORTS[0];
  /** Small mouse movement that must not undo a keyboard adjustment, in CSS pixels. */
  const MOUSE_TREMOR_PX = 4;
  /** Mouse movement that must hand the aim back to the pointer, in CSS pixels. */
  const MOUSE_SWEEP_PX = 120;
  const ANGLE_TOLERANCE_RAD = 1e-6;

  test('arrows fine-tune the aim, a mouse tremor keeps it, and a click shoots along it', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await startLevelOne(page);
      await page.evaluate(() => window.__fluxEngine.dismissDiscovery());
      const box = await page.locator('#game-canvas').boundingBox();
      const aimX = box.x + box.width / 2;
      const aimY = box.y + box.height * 0.4;
      await page.mouse.move(aimX, aimY);
      const before = await page.evaluate(() => window.__fluxEngine.aimAngle);

      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      const tuned = await page.evaluate(() => window.__fluxEngine.aimAngle);
      const fineStep = await page.evaluate(() => window.__fluxEngine.gameConfig.canvas.keyboardAimFineStepRad);
      assert.ok(Math.abs(tuned - before - 2 * fineStep) < ANGLE_TOLERANCE_RAD, 'two fine steps');

      await page.mouse.move(aimX + MOUSE_TREMOR_PX, aimY);
      assert.equal(await page.evaluate(() => window.__fluxEngine.aimAngle), tuned, 'a tremor keeps the tuned aim');

      await page.mouse.down();
      await page.mouse.up();
      const shot = await page.evaluate(() => {
        const projectile = window.__fluxEngine.physicsWorld.projectile;
        return projectile ? Math.atan2(projectile.vy, projectile.vx) : null;
      });
      assert.ok(shot !== null && Math.abs(shot - tuned) < ANGLE_TOLERANCE_RAD, 'the click shoots along the tuned aim');

      await page.keyboard.press('ArrowLeft');
      const relocked = await page.evaluate(() => window.__fluxEngine.aimAngle);
      await page.mouse.move(aimX + MOUSE_TREMOR_PX + MOUSE_SWEEP_PX, aimY, { steps: 4 });
      assert.notEqual(await page.evaluate(() => window.__fluxEngine.aimAngle), relocked, 'a long sweep takes the aim back');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

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

  test('winning the last level offers the level select, never Survival', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      const lastId = await page.evaluate(() => window.__fluxEngine.levelCatalog.lastId);
      await startLevel(page, lastId);
      await page.evaluate(() => {
        const engine = window.__fluxEngine;
        engine.physicsWorld.balls.length = 0;
        engine.physicsWorld.ballMap.clear();
        engine.evaluateRoundEnd();
      });
      await waitShown(page, '#modal-victory');
      const label = await page.evaluate(async () => {
        const { t } = await import('/src/core/I18n.js');
        return {
          shown: document.querySelector('#btn-next-level').textContent,
          expected: t('modals.victory.button.backToLevels')
        };
      });
      assert.equal(label.shown, label.expected, 'the button names the level select');
      await page.click('#btn-next-level');
      await waitShown(page, '#modal-levels');
      const after = await page.evaluate(() => ({
        mode: window.__fluxEngine.mode,
        levelId: window.__fluxEngine.currentLevelId
      }));
      assert.deepEqual(after, { mode: GAME_MODES.CAMPAIGN, levelId: lastId }, 'no Survival run started');
      assert.equal(await isShown(page, '#modal-victory'), false);
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

  test('only a Daily game over offers Share, and Share copies the result when no share sheet exists', async () => {
    const { context, page, errors } = await openGame(desktop);
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
      await startLevelOne(page);
      await page.evaluate((reason) => window.__fluxEngine.triggerGameOver(reason), GAME_OVER_REASONS.OUT_OF_SHOTS);
      await waitShown(page, '#modal-gameover');
      assert.equal(await isShown(page, '#btn-share-gameover'), false, 'a campaign run has nothing to share');
      await page.click('#btn-retry');
      await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);

      // Desktop browsers may offer a share sheet; removing it exercises the clipboard path.
      await page.evaluate(() => {
        delete Navigator.prototype.share;
        const engine = window.__fluxEngine;
        engine.startDailyChallenge();
        engine.spawnEndlessWave();
        engine.spawnEndlessWave();
        engine.notifyUI();
      });
      await page.waitForFunction((playing) => window.__fluxEngine.state === playing, GAME_STATES.PLAYING);
      await page.evaluate((reason) => window.__fluxEngine.triggerGameOver(reason), GAME_OVER_REASONS.LINE_CROSSED);
      await waitShown(page, '#btn-share-gameover');
      await page.click('#btn-share-gameover');
      const config = await page.evaluate(() => window.__fluxEngine.gameConfig.share);
      await page.waitForFunction((url) => navigator.clipboard.readText().then((text) => text.endsWith(url)), config.url);
      const lines = (await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/);
      assert.equal(lines.length, 4, 'header, stats, wave row and address');
      assert.equal(lines[2], config.waveEmoji.normal + config.waveEmoji.goldRush);
      await page.waitForFunction(async () => {
        const { t } = await import('/src/core/I18n.js');
        return document.querySelector('#sr-announcer').textContent.includes(t('share.feedback.copied'));
      });
      assert.equal(await isShown(page, '#gameover-share-fallback'), false);
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

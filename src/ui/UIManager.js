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

import {
  GAME_MODES,
  GAME_OVER_REASONS,
  GAME_STATES,
  INPUT_MODES,
  MATH_CONSTANTS,
  SPECIAL_TYPES,
  SPECIAL_TYPES_ORDER,
  OBSTACLE_TYPES_ORDER
} from '../core/Constants.js';
import { i18n, t, formatNumber } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { resolveHintText } from '../game/Discovery.js';
import { buildDailyShareText } from '../game/DailyShare.js';
import { decodeGeneratedShapeId, isGeneratedShapeId } from '../game/layouts/ShapeGenerator.js';
import { LEVEL_FORMATS } from '../game/LevelCatalog.js';

/** Elements a modal focus trap may cycle through (inactive tabs use tabindex="-1"). */
export const MODAL_FOCUSABLE_SELECTOR =
  'button:not(:disabled):not([tabindex="-1"]), textarea:not([tabindex="-1"]), [href]:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

/** Ancestors that remove an element from the interactive tree. */
const NON_INTERACTIVE_ANCESTOR_SELECTOR = '.hidden, [hidden], [inert]';

/** Error name of a share sheet the player dismissed: not a failure, nothing to report. */
const SHARE_ABORT_ERROR_NAME = 'AbortError';

/** Root class mirroring the in-app reduced motion setting for CSS. */
export const REDUCED_MOTION_CLASS = 'reduced-motion';

/** Root class mirroring the in-app high contrast setting, so CSS raises the HUD and menus too. */
export const HIGH_CONTRAST_CLASS = 'high-contrast';

/** Cubic ease-out of the victory score roll-up: fast at first, settling on the total. */
const COUNT_UP_EASE_POWER = 3;

/** App shell class that slides the menu in on portrait phones. */
const DRAWER_OPEN_CLASS = 'drawer-open';

/** Pointer types that mean a finger-like input without a keyboard at hand. */
const TOUCH_POINTER_TYPES = new Set(['touch', 'pen']);

/** Root data attribute mirroring the current input mode for CSS. */
const INPUT_MODE_DATASET_KEY = 'input';

/** Special ball button with no stock left: a click opens the Workshop ammo tab. */
const EMPTY_POWERUP_CLASS = 'is-empty';

/** Workshop tab names. */
export const SHOP_TABS = Object.freeze({
  UPGRADES: 'upgrades',
  AMMO: 'ammo',
  ACHIEVEMENTS: 'achievements',
  CODEX: 'codex'
});

/** Mode buttons, keyed by the game mode each one starts. */
const MODE_BUTTON_KEYS = Object.freeze({
  [GAME_MODES.CAMPAIGN]: 'btnLevels',
  [GAME_MODES.ENDLESS]: 'btnEndless',
  [GAME_MODES.DAILY]: 'btnDaily',
  [GAME_MODES.FLUX]: 'btnFlux'
});

/** Pause modal hints that have one wording per input mode. */
const PAUSE_INPUT_HINTS = Object.freeze([
  { elementId: 'pause-instruction-aim', key: 'modals.pause.instructions.aim' },
  { elementId: 'pause-instruction-swap', key: 'modals.pause.instructions.swap' },
  { elementId: 'pause-instruction-cancel', key: 'modals.pause.instructions.cancel' }
]);

/** Accessible names that have one wording per input mode (the board's text alternative). */
export const INPUT_ARIA_HINTS = Object.freeze([{ elementId: 'game-canvas', key: 'hud.canvas.aria.label' }]);

/** Percent scale of the star gauge. */
const FULL_PERCENT = 100;

/**
 * How far a score has gone from the last star threshold it passed toward the next one.
 * @param {number} score - Current score.
 * @param {number[]} thresholds - Star thresholds, ascending.
 * @param {number|undefined} nextThreshold - The first threshold above the score, if any.
 * @returns {number} A whole percentage; 100 once every star is earned.
 */
export function computeStarProgressPct(score, thresholds, nextThreshold) {
  if (nextThreshold === undefined) {
    return FULL_PERCENT;
  }
  const passed = thresholds.filter((th) => th <= score);
  const floor = passed.length > 0 ? passed[passed.length - 1] : 0;
  const span = nextThreshold - floor;
  if (span <= 0) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(1, (score - floor) / span)) * FULL_PERCENT);
}

/**
 * Maps a pointer event type to an input mode; mouse and unknown types keep the
 * mouse/keyboard wording.
 */
export function inputModeForPointerType(pointerType) {
  return TOUCH_POINTER_TYPES.has(pointerType) ? INPUT_MODES.TOUCH : INPUT_MODES.POINTER;
}

/** Keys whose action is a one-shot toggle or trigger; auto-repeat must not re-fire them. */
const REPEAT_SENSITIVE_KEY_CODES = new Set(['Space', 'KeyF', 'Enter', 'NumpadEnter', 'Escape']);
const SPECIAL_BALL_KEY_PATTERN = /^Digit\d$/;

/**
 * Keeps only elements a keyboard user can actually reach: not disabled,
 * not tabindex="-1", not inside a hidden or inert subtree, and rendered.
 */
export function filterFocusTrapCandidates(elements) {
  return Array.from(elements).filter((el) => {
    if (!el || el.disabled || el.hidden) {
      return false;
    }
    if (typeof el.getAttribute === 'function' && el.getAttribute('tabindex') === '-1') {
      return false;
    }
    if (typeof el.closest === 'function' && el.closest(NON_INTERACTIVE_ANCESTOR_SELECTOR)) {
      return false;
    }
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) {
      return false;
    }
    return true;
  });
}

/** True when a held-down key repeat must be ignored (aiming arrows keep repeating). */
export function shouldIgnoreRepeatedKey(code, isRepeat) {
  if (!isRepeat || typeof code !== 'string') {
    return false;
  }
  return REPEAT_SENSITIVE_KEY_CODES.has(code) || SPECIAL_BALL_KEY_PATTERN.test(code);
}

/**
 * True for Ctrl, Cmd and Alt chords, which belong to the browser (find, tab switching,
 * history). Shift is not one of them: it selects the fast aim step.
 */
export function isBrowserShortcut(event) {
  return Boolean(event.ctrlKey || event.metaKey || event.altKey);
}

/**
 * The slide-in menu opens only in the drawer layout, over nothing else: not over a
 * dialog, and not during the victory celebration, whose dialog would open behind it.
 */
export function canOpenDrawer({ isOpen, isDrawerLayout, isModalOpen, isVictoryCelebrating }) {
  return !isOpen && isDrawerLayout && !isModalOpen && !isVictoryCelebrating;
}

/** Generated level formats whose name and description say what sets them apart. */
const LABELLED_LEVEL_FORMATS = new Set([LEVEL_FORMATS.TWIST, LEVEL_FORMATS.PRECISION, LEVEL_FORMATS.ARSENAL]);

/** i18n key of the defeat explanation; an unknown reason reads as a crossed line. */
export function gameOverReasonKey(reason) {
  const known = Object.values(GAME_OVER_REASONS).includes(reason) ? reason : GAME_OVER_REASONS.LINE_CROSSED;
  return `modals.gameOver.reason.${known}`;
}

/**
 * Where focus goes when the dialog on top changed under it (a stacked Confirm closed
 * over Pause or Levels): nowhere when focus is already inside the top dialog, else the
 * element that opened the closed dialog when it belongs to the top one, else the top
 * dialog's first reachable element.
 */
export function resolveModalFocusTarget(topModal, activeElement, preferred, focusables) {
  if (!topModal || (activeElement && topModal.contains(activeElement))) {
    return null;
  }
  if (preferred && topModal.contains(preferred) && filterFocusTrapCandidates([preferred]).length > 0) {
    return preferred;
  }
  return filterFocusTrapCandidates(focusables)[0] || null;
}

/** Latest text waiting to be written into a live region revealed this frame. */
const pendingLiveRegionTexts = new WeakMap();

/**
 * Shows a polite live region and writes its text. A region revealed from display:none
 * is shown empty first and filled on the next frame: screen readers ignore text that
 * was already there when the region appeared.
 *
 * @param {{region: Element, textElement: Element, text: string, schedule: (cb: Function) => void}} options
 */
export function revealLiveRegion({ region, textElement, text, schedule }) {
  if (pendingLiveRegionTexts.has(textElement)) {
    region.classList.remove('hidden');
    pendingLiveRegionTexts.set(textElement, text);
    return;
  }
  if (!region.classList.contains('hidden')) {
    setTextIfChanged(textElement, text);
    return;
  }
  textElement.textContent = '';
  region.classList.remove('hidden');
  pendingLiveRegionTexts.set(textElement, text);
  schedule(() => {
    const latest = pendingLiveRegionTexts.get(textElement);
    pendingLiveRegionTexts.delete(textElement);
    if (!region.classList.contains('hidden')) {
      setTextIfChanged(textElement, latest);
    }
  });
}

/** Runs a callback on the next frame, or at once where frames are not available. */
function scheduleNextFrame(callback) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
  } else {
    callback();
  }
}

/** Screen orientation angles, in degrees, as reported by screen.orientation.angle. */
const SCREEN_ANGLES = Object.freeze({ PORTRAIT: 0, LANDSCAPE_LEFT: 90, UPSIDE_DOWN: 180, LANDSCAPE_RIGHT: 270 });
const FULL_TURN_DEGREES = 360;

/**
 * Signed share of gravity pushed sideways by the device tilt. The tilt axis follows the
 * screen orientation; tilts inside the dead zone count as level, and the share reaches
 * its maximum at fullTiltDegrees.
 * @param {{gamma: number|null, beta: number|null}} orientation - A deviceorientation event.
 * @param {number} screenAngle - screen.orientation.angle.
 * @param {{fullTiltDegrees: number, deadZoneDegrees: number, maxGravityShare: number}} tiltCfg
 */
export function computeTiltShare(orientation, screenAngle, tiltCfg) {
  const angle = ((screenAngle % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;
  const gamma = orientation.gamma || 0;
  const beta = orientation.beta || 0;
  let degrees = gamma;
  if (angle === SCREEN_ANGLES.UPSIDE_DOWN) {
    degrees = -gamma;
  } else if (angle === SCREEN_ANGLES.LANDSCAPE_LEFT) {
    degrees = beta;
  } else if (angle === SCREEN_ANGLES.LANDSCAPE_RIGHT) {
    degrees = -beta;
  }
  const magnitude = Math.abs(degrees) - tiltCfg.deadZoneDegrees;
  if (magnitude <= 0) {
    return 0;
  }
  const span = tiltCfg.fullTiltDegrees - tiltCfg.deadZoneDegrees;
  return Math.sign(degrees) * Math.min(1, magnitude / span) * tiltCfg.maxGravityShare;
}

/** Writes text only when it differs, so live regions are not re-announced needlessly. */
function setTextIfChanged(element, text) {
  if (element && element.textContent !== text) {
    element.textContent = text;
  }
}

function setAttributeIfChanged(element, name, value) {
  if (element && element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/**
 * Manages DOM HUD updates, accessible modal dialogs, shop/codex tabs,
 * and keyboard/button event bindings.
 */
export class UIManager {
  constructor({ engine, renderer, storageManager, audioManager, gameConfig, ballsConfig }) {
    this.engine = engine;
    this.renderer = renderer;
    this.storageManager = storageManager;
    this.audioManager = audioManager;
    this.gameConfig = gameConfig;
    this.ballsConfig = ballsConfig;

    this.elements = {
      appShell: document.querySelector('.app-shell'),
      canvasWrapper: document.querySelector('.canvas-wrapper'),
      gameCanvas: document.getElementById('game-canvas'),
      scoreValue: document.getElementById('hud-score-value'),
      starProgress: document.getElementById('hud-star-progress'),
      starGlyphs: document.getElementById('hud-star-glyphs'),
      starNext: document.getElementById('hud-star-next'),
      starMeter: document.getElementById('hud-star-meter'),
      starMeterFill: document.getElementById('hud-star-meter-fill'),
      highScoreValue: document.getElementById('hud-best-value'),
      coinsValue: document.getElementById('hud-coins-value'),
      overchargePct: document.getElementById('hud-overcharge-pct'),
      overchargeFill: document.getElementById('hud-overcharge-fill'),
      modeBanner: document.getElementById('hud-mode-banner'),
      compactInfo: document.getElementById('hud-compact-info'),
      shotsLabel: document.getElementById('hud-shots-label'),
      shotsValue: document.getElementById('hud-shots-value'),
      comboBadge: document.getElementById('hud-combo-badge'),
      frozenBadge: document.getElementById('hud-frozen-badge'),
      powerupsContainer: document.getElementById('powerups-bar'),
      powerupsHeader: document.getElementById('powerups-header'),
      btnLevels: document.getElementById('btn-levels'),
      btnEndless: document.getElementById('btn-endless'),
      btnDaily: document.getElementById('btn-daily'),
      btnFlux: document.getElementById('btn-flux'),
      btnShop: document.getElementById('btn-shop'),
      btnRestart: document.getElementById('btn-restart'),
      btnPause: document.getElementById('btn-pause'),
      btnSound: document.getElementById('btn-sound'),
      btnContrast: document.getElementById('btn-contrast'),
      btnPatterns: document.getElementById('btn-patterns'),
      btnTilt: document.getElementById('btn-tilt'),
      btnMotion: document.getElementById('btn-motion'),
      btnResetHints: document.getElementById('btn-reset-hints'),
      btnLang: document.getElementById('btn-lang'),
      swapBtn: document.getElementById('btn-swap-ball'),
      polarityBtn: document.getElementById('btn-polarity'),
      drawer: document.getElementById('app-drawer'),
      drawerBackdrop: document.getElementById('drawer-backdrop'),
      btnMenu: document.getElementById('btn-menu'),
      btnCloseDrawer: document.getElementById('btn-close-drawer'),
      hudBar: document.querySelector('.hud-bar'),
      stageContainer: document.querySelector('.stage-container'),
      drawerMode: document.getElementById('drawer-mode'),
      drawerStarProgress: document.getElementById('drawer-star-progress'),
      drawerCoins: document.getElementById('drawer-coins'),
      drawerBest: document.getElementById('drawer-best'),
      drawerOvercharge: document.getElementById('drawer-overcharge'),
      tutorialBanner: document.getElementById('tutorial-banner'),
      tutorialBannerText: document.getElementById('tutorial-banner-text'),
      btnDismissTutorial: document.getElementById('btn-dismiss-tutorial'),
      specialEquippedBanner: document.getElementById('special-equipped-banner'),
      cancelAimBanner: document.getElementById('cancel-aim-banner'),
      modalLevels: document.getElementById('modal-levels'),
      levelsStarsSummary: document.getElementById('levels-stars-summary'),
      levelsChapters: document.getElementById('levels-chapters'),
      levelsGrid: document.getElementById('levels-grid'),
      btnCloseLevels: document.getElementById('btn-close-levels'),
      btnPlayLevelModal: document.getElementById('btn-play-level-modal'),
      modalShop: document.getElementById('modal-shop'),
      shopBalance: document.getElementById('shop-balance'),
      tabShopUpgrades: document.getElementById('tab-shop-upgrades'),
      tabShopAmmo: document.getElementById('tab-shop-ammo'),
      shopAmmoPane: document.getElementById('shop-ammo-pane'),
      tabShopAchievements: document.getElementById('tab-shop-achievements'),
      tabShopCodex: document.getElementById('tab-shop-codex'),
      shopUpgradesPane: document.getElementById('shop-upgrades-pane'),
      shopGrid: document.getElementById('shop-grid'),
      shopAmmoGrid: document.getElementById('shop-ammo-grid'),
      achievementsGrid: document.getElementById('achievements-grid'),
      codexPane: document.getElementById('codex-pane'),
      btnCloseShop: document.getElementById('btn-close-shop'),
      modalVictory: document.getElementById('modal-victory'),
      victoryScore: document.getElementById('victory-score'),
      victoryBonus: document.getElementById('victory-bonus'),
      victoryStars: document.getElementById('victory-stars'),
      btnNextLevel: document.getElementById('btn-next-level'),
      btnReplayVictory: document.getElementById('btn-replay-victory'),
      btnLevelsVictory: document.getElementById('btn-levels-victory'),
      modalGameOver: document.getElementById('modal-gameover'),
      gameOverReason: document.getElementById('gameover-reason'),
      gameOverScore: document.getElementById('gameover-score'),
      gameOverBest: document.getElementById('gameover-best'),
      gameOverStage: document.getElementById('gameover-stage'),
      btnRetry: document.getElementById('btn-retry'),
      btnLevelsGameOver: document.getElementById('btn-levels-gameover'),
      btnShareGameOver: document.getElementById('btn-share-gameover'),
      gameOverShareFallback: document.getElementById('gameover-share-fallback'),
      gameOverShareText: document.getElementById('gameover-share-text'),
      modalPause: document.getElementById('modal-pause'),
      pauseLevelTip: document.getElementById('pause-level-tip'),
      btnResume: document.getElementById('btn-resume'),
      btnRestartPause: document.getElementById('btn-restart-pause'),
      btnSoundPause: document.getElementById('btn-sound-pause'),
      btnContrastPause: document.getElementById('btn-contrast-pause'),
      btnPatternsPause: document.getElementById('btn-patterns-pause'),
      btnTiltPause: document.getElementById('btn-tilt-pause'),
      btnMotionPause: document.getElementById('btn-motion-pause'),
      btnLangPause: document.getElementById('btn-lang-pause'),
      btnSettings: document.getElementById('btn-settings'),
      modalSettings: document.getElementById('modal-settings'),
      btnCloseSettings: document.getElementById('btn-close-settings'),
      modalConfirm: document.getElementById('modal-confirm'),
      btnConfirmYes: document.getElementById('btn-confirm-yes'),
      btnConfirmNo: document.getElementById('btn-confirm-no'),
      srAnnouncer: document.getElementById('sr-announcer')
    };

    this.pendingAnnouncements = [];
    this.isAnnouncementScheduled = false;
    this.lastExtra = {};
    this.pendingConfirmCallback = null;
    this.activeShopTab = SHOP_TABS.UPGRADES;
    this.levelsChapterIndex = 0;
    this.autoPausedByOverlay = false;
    this.lastFocusedElement = null;
    this.stackedModalOpener = null;
    this.prevEngineState = null;
    this.isVictoryModalRevealed = false;
    this.isVictoryPresented = false;
    this.victoryStarsLabel = null;
    this.scoreCountUpFrame = null;
    this.inputMode = this.detectInitialInputMode();
    this.isDrawerOpen = false;
    this.drawerMedia = null;
  }

  detectInitialInputMode() {
    const query = this.gameConfig.defaults.coarsePointerMediaQuery;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && query) {
      return window.matchMedia(query).matches ? INPUT_MODES.TOUCH : INPUT_MODES.POINTER;
    }
    return INPUT_MODES.POINTER;
  }

  /**
   * Switches every input-specific hint (keyboard shortcuts, tap or click wording)
   * when the player changes device, e.g. a touch laptop used with its keyboard.
   */
  setInputMode(mode) {
    if (mode === this.inputMode) {
      return;
    }
    this.inputMode = mode;
    this.applyInputMode();
    this.refresh(this.engine, this.lastExtra);
  }

  applyInputMode() {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.dataset[INPUT_MODE_DATASET_KEY] = this.inputMode;
    }
    this.updateInputHints();
  }

  /** A launcher label, followed by its keyboard shortcut only when a keyboard is in use. */
  formatLauncherLabel(labelKey, shortcutKey) {
    const label = t(labelKey);
    if (this.inputMode === INPUT_MODES.TOUCH) {
      return label;
    }
    return t('hud.launcher.shortcutFormat', { label, key: t(shortcutKey) });
  }

  /**
   * Fills a launcher button's icon and text parts. The text stays in the
   * accessibility tree even where the compact layout only shows the icon.
   */
  setLauncherButton(button, iconKey, labelKey, shortcutKey, captionKey) {
    if (!button) {
      return;
    }
    setTextIfChanged(button.querySelector('.launcher-icon'), t(iconKey));
    setTextIfChanged(button.querySelector('.launcher-text'), this.formatLauncherLabel(labelKey, shortcutKey));
    // The short caption under the icon, shown where the compact layout hides the label.
    setTextIfChanged(button.querySelector('.launcher-caption'), t(captionKey));
  }

  updateInputHints() {
    this.setLauncherButton(
      this.elements.swapBtn,
      'hud.launcher.swap.icon',
      'hud.launcher.swap.label',
      'hud.launcher.swap.shortcut',
      'hud.launcher.swap.caption'
    );
    for (const { elementId, key } of PAUSE_INPUT_HINTS) {
      setTextIfChanged(document.getElementById(elementId), t(`${key}.${this.inputMode}`));
    }
    for (const { elementId, key } of INPUT_ARIA_HINTS) {
      setAttributeIfChanged(document.getElementById(elementId), 'aria-label', t(`${key}.${this.inputMode}`));
    }
  }

  init() {
    this.applyCanvasLayoutVariables();
    this.applyInputMode();
    this.buildPowerupButtons();
    this.bindEvents();
    this.updateSoundButton();
    this.updateContrastButton();
    this.updatePatternsButton();
    this.setupTiltControl();
    this.updateMotionButton();
    this.updateLanguageButton();

    i18n.onChange(() => {
      this.updateInputHints();
      this.buildPowerupButtons();
      this.updateSoundButton();
      this.updateContrastButton();
      this.updatePatternsButton();
      this.updateTiltButton();
      this.updateMotionButton();
      this.updateLanguageButton();
      this.refresh(this.engine, this.lastExtra);
    });
  }

  /**
   * Exposes canvas geometry to CSS: the board takes the world's shape, and overlays are
   * placed relative to the danger line.
   */
  applyCanvasLayoutVariables() {
    const { logicalWidth, logicalHeight, dangerLineY } = this.gameConfig.canvas;
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.style.setProperty('--canvas-aspect', `${logicalWidth} / ${logicalHeight}`);
    }
    if (this.elements.canvasWrapper) {
      const belowDangerPct = ((logicalHeight - dangerLineY) / logicalHeight) * 100;
      this.elements.canvasWrapper.style.setProperty('--tutorial-bottom', `${belowDangerPct}%`);
    }
  }

  buildPowerupButtons() {
    const container = this.elements.powerupsContainer;
    container.innerHTML = '';

    for (const type of SPECIAL_TYPES_ORDER) {
      const spec = this.ballsConfig.specialTypes[type];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'powerup-btn';
      btn.dataset.specialType = type;
      btn.title = t(`hud.powerups.${type}.tooltip`);

      const iconSpan = document.createElement('span');
      iconSpan.className = 'powerup-icon';
      iconSpan.style.background = `radial-gradient(circle at 30% 30%, ${spec.highlight}, ${spec.fill})`;
      iconSpan.textContent = spec.icon;

      iconSpan.setAttribute('aria-hidden', 'true');

      const labelSpan = document.createElement('span');
      labelSpan.className = 'powerup-name';
      labelSpan.textContent = t(`hud.powerups.${type}.name`);

      const count = this.engine.specialInventory[type] || 0;
      const countSpan = document.createElement('span');
      countSpan.className = 'powerup-count';
      countSpan.id = `powerup-count-${type}`;
      countSpan.textContent = String(count);

      // The visible name is hidden on narrow screens, so the name and stock
      // are carried by an explicit label rather than by the content.
      btn.setAttribute('aria-label', this.getPowerupAriaLabel(type, count));

      btn.append(iconSpan, labelSpan, countSpan);
      btn.addEventListener('click', () => {
        // An empty stock leads to where more can be bought.
        if (btn.classList.contains(EMPTY_POWERUP_CLASS)) {
          this.openShopModal(SHOP_TABS.AMMO);
          return;
        }
        this.engine.equipSpecialBall(type);
      });

      container.appendChild(btn);
    }
  }

  getPowerupAriaLabel(type, count) {
    return t('hud.powerups.button.aria', {
      name: t(`hud.powerups.${type}.name`),
      count: formatNumber(count)
    });
  }

  /**
   * Queues a message for the visually hidden polite live region. Messages
   * raised in the same frame are joined so none of them is dropped.
   */
  announce(message) {
    const region = this.elements.srAnnouncer;
    if (!region || !message) {
      return;
    }
    this.pendingAnnouncements.push(message);
    if (this.isAnnouncementScheduled) {
      return;
    }
    this.isAnnouncementScheduled = true;
    // Clearing first lets an identical message be announced again.
    region.textContent = '';
    const flush = () => {
      this.isAnnouncementScheduled = false;
      region.textContent = this.pendingAnnouncements.join(' ');
      this.pendingAnnouncements = [];
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
    } else {
      flush();
    }
  }

  /** True when the layout turns the header into a slide-in menu (portrait phones). */
  isDrawerLayout() {
    return Boolean(this.drawerMedia && this.drawerMedia.matches);
  }

  /**
   * Opens the slide-in menu. The run is paused like it is for the Shop or the
   * level select, and everything behind the menu is taken out of reach.
   */
  openDrawer() {
    const isAllowed = canOpenDrawer({
      isOpen: this.isDrawerOpen,
      isDrawerLayout: this.isDrawerLayout(),
      isModalOpen: this.isAnyModalOpen(),
      isVictoryCelebrating: this.engine.isVictoryCelebrating()
    });
    if (!isAllowed) {
      return;
    }
    this.isDrawerOpen = true;
    if (this.engine.state === GAME_STATES.PLAYING) {
      this.autoPausedByOverlay = true;
      this.engine.state = GAME_STATES.PAUSED;
    }
    this.syncDrawerState();
    if (this.elements.btnCloseDrawer) {
      this.elements.btnCloseDrawer.focus();
    }
  }

  /**
   * Closes the slide-in menu and gives focus back to the menu button.
   * @param {{resume: boolean}} options - resume: restart a run the menu paused. A menu
   *   action that opens a dialog passes false, and that dialog resumes the run when it closes.
   */
  closeDrawer({ resume }) {
    if (!this.isDrawerOpen) {
      return;
    }
    this.isDrawerOpen = false;
    this.syncDrawerState();
    if (this.elements.btnMenu && this.isDrawerLayout()) {
      this.elements.btnMenu.focus();
    }
    if (resume && this.autoPausedByOverlay && this.engine.state === GAME_STATES.PAUSED) {
      this.autoPausedByOverlay = false;
      this.engine.state = GAME_STATES.PLAYING;
      this.refresh(this.engine, this.lastExtra);
    }
  }

  syncDrawerState() {
    const isOpen = this.isDrawerOpen;
    if (this.elements.appShell) {
      this.elements.appShell.classList.toggle(DRAWER_OPEN_CLASS, isOpen);
    }
    for (const behind of [this.elements.hudBar, this.elements.stageContainer]) {
      if (behind) {
        behind.inert = isOpen;
      }
    }
    if (this.elements.btnMenu) {
      this.elements.btnMenu.setAttribute('aria-expanded', String(isOpen));
    }
    const drawer = this.elements.drawer;
    if (drawer) {
      if (isOpen) {
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
      } else {
        drawer.removeAttribute('role');
        drawer.removeAttribute('aria-modal');
      }
    }
  }

  /** Copies the HUD values the compact layout hides into the menu. */
  syncDrawerStats() {
    const mirrors = [
      [this.elements.modeBanner, this.elements.drawerMode],
      [this.elements.starProgress, this.elements.drawerStarProgress],
      [this.elements.coinsValue, this.elements.drawerCoins],
      [this.elements.highScoreValue, this.elements.drawerBest],
      [this.elements.overchargePct, this.elements.drawerOvercharge]
    ];
    for (const [source, mirror] of mirrors) {
      if (source && mirror) {
        setTextIfChanged(mirror, source.textContent);
        mirror.classList.toggle('hidden', source.classList.contains('hidden'));
      }
    }
  }

  bindDrawerEvents() {
    const query = this.gameConfig.defaults.drawerMediaQuery;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && query) {
      this.drawerMedia = window.matchMedia(query);
      this.drawerMedia.addEventListener('change', () => {
        if (!this.drawerMedia.matches) {
          this.closeDrawer({ resume: true });
        }
      });
    }
    if (this.elements.btnMenu) {
      this.elements.btnMenu.addEventListener('click', () => {
        this.openDrawer();
      });
    }
    if (this.elements.btnCloseDrawer) {
      this.elements.btnCloseDrawer.addEventListener('click', () => {
        this.closeDrawer({ resume: true });
      });
    }
    if (this.elements.drawerBackdrop) {
      this.elements.drawerBackdrop.addEventListener('click', () => {
        this.closeDrawer({ resume: true });
      });
    }
    // Bound before the buttons' own handlers so the menu is gone, and focus is back
    // on the menu button, before they open a dialog or change the run.
    if (this.elements.drawer) {
      for (const button of this.elements.drawer.querySelectorAll('[data-closes-drawer]')) {
        button.addEventListener('click', () => {
          this.closeDrawer({ resume: false });
        });
      }
    }
  }

  isRunActive() {
    return this.engine.state === GAME_STATES.PLAYING || this.engine.state === GAME_STATES.PAUSED;
  }

  bindEvents() {
    this.bindDrawerEvents();

    this.elements.btnLevels.addEventListener('click', () => {
      this.openLevelsModal();
    });

    this.elements.btnEndless.addEventListener('click', () => {
      this.requestDestructiveAction(() => {
        this.hideAllModals();
        this.engine.startEndlessMode();
      });
    });

    if (this.elements.btnDaily) {
      this.elements.btnDaily.addEventListener('click', () => {
        this.requestDestructiveAction(() => {
          this.hideAllModals();
          this.engine.startDailyChallenge();
        });
      });
    }

    if (this.elements.btnFlux) {
      this.elements.btnFlux.addEventListener('click', () => {
        this.requestDestructiveAction(() => {
          this.hideAllModals();
          this.engine.startFluxRun();
        });
      });
    }

    this.elements.btnShop.addEventListener('click', () => {
      this.openShopModal();
    });

    if (this.elements.btnSettings) {
      this.elements.btnSettings.addEventListener('click', () => {
        this.openOverlayModal(this.elements.modalSettings, this.elements.btnCloseSettings);
      });
    }
    if (this.elements.btnCloseSettings) {
      this.elements.btnCloseSettings.addEventListener('click', () => {
        this.closeOverlayModal(this.elements.modalSettings);
      });
    }

    this.elements.btnRestart.addEventListener('click', () => {
      this.requestDestructiveAction(() => {
        this.hideAllModals();
        this.engine.restartCurrent();
      });
    });

    this.elements.btnPause.addEventListener('click', () => {
      // From the menu, the run is held by the menu pause: turn it into a regular
      // pause so the Pause dialog opens.
      if (this.autoPausedByOverlay && this.engine.state === GAME_STATES.PAUSED) {
        this.autoPausedByOverlay = false;
        this.engine.state = GAME_STATES.PLAYING;
      }
      this.engine.togglePause();
    });

    const toggleSound = () => {
      const nextMuted = !this.audioManager.isMuted();
      this.audioManager.setMuted(nextMuted);
      this.storageManager.setMuted(nextMuted);
      this.updateSoundButton();
    };
    this.elements.btnSound.addEventListener('click', toggleSound);
    if (this.elements.btnSoundPause) {
      this.elements.btnSoundPause.addEventListener('click', toggleSound);
    }

    const toggleContrast = () => {
      const nextContrast = !this.storageManager.getHighContrast();
      this.storageManager.setHighContrast(nextContrast);
      if (this.renderer) {
        this.renderer.setHighContrast(nextContrast);
      }
      this.updateContrastButton();
    };
    if (this.elements.btnContrast) {
      this.elements.btnContrast.addEventListener('click', toggleContrast);
    }
    if (this.elements.btnContrastPause) {
      this.elements.btnContrastPause.addEventListener('click', toggleContrast);
    }

    const togglePatterns = () => {
      const nextPatterns = !this.storageManager.getColorPatterns();
      this.storageManager.setColorPatterns(nextPatterns);
      if (this.renderer) {
        this.renderer.setColorPatterns(nextPatterns);
      }
      this.updatePatternsButton();
    };
    for (const btn of [this.elements.btnPatterns, this.elements.btnPatternsPause]) {
      if (btn) {
        btn.addEventListener('click', togglePatterns);
      }
    }

    const toggleMotion = () => {
      const nextReduced = !this.storageManager.getReducedMotion();
      this.storageManager.setReducedMotion(nextReduced);
      if (this.engine && typeof this.engine.setReducedMotion === 'function') {
        this.engine.setReducedMotion(nextReduced);
      }
      if (this.audioManager && typeof this.audioManager.setReducedMotion === 'function') {
        this.audioManager.setReducedMotion(nextReduced);
      }
      this.updateMotionButton();
    };
    if (this.elements.btnMotion) {
      this.elements.btnMotion.addEventListener('click', toggleMotion);
    }
    if (this.elements.btnMotionPause) {
      this.elements.btnMotionPause.addEventListener('click', toggleMotion);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.engine.state === GAME_STATES.PLAYING) {
        this.engine.togglePause();
      }
    });

    const toggleLang = () => {
      const supported = this.gameConfig.defaults.supportedLanguages;
      const current = i18n.getLocale();
      const nextIdx = (supported.indexOf(current) + 1) % supported.length;
      const nextLang = supported[nextIdx];
      i18n.setLocale(nextLang);
      this.storageManager.setLanguage(nextLang);
    };
    this.elements.btnLang.addEventListener('click', toggleLang);
    if (this.elements.btnLangPause) {
      this.elements.btnLangPause.addEventListener('click', toggleLang);
    }

    this.elements.swapBtn.addEventListener('click', () => {
      this.engine.swapLauncherBalls();
    });

    if (this.elements.polarityBtn) {
      this.elements.polarityBtn.addEventListener('click', () => {
        this.engine.togglePolarityFlip();
      });
    }

    if (this.elements.btnResetHints) {
      this.elements.btnResetHints.addEventListener('click', () => {
        this.engine.resetDiscoveries();
        this.announce(t('hud.announcer.hints.reset'));
      });
    }

    if (this.elements.btnDismissTutorial) {
      this.elements.btnDismissTutorial.addEventListener('click', () => {
        this.engine.dismissDiscovery();
      });
    }

    const shopTabs = this.getShopTabs();
    if (shopTabs.length > 0) {
      for (let i = 0; i < shopTabs.length; i++) {
        const { name, el } = shopTabs[i];
        el.addEventListener('click', () => {
          this.switchShopTab(name);
        });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const dir = e.key === 'ArrowRight' ? 1 : -1;
            const nextIdx = (i + dir + shopTabs.length) % shopTabs.length;
            this.switchShopTab(shopTabs[nextIdx].name);
            shopTabs[nextIdx].el.focus();
          }
        });
      }
    }

    if (this.elements.btnConfirmYes && this.elements.btnConfirmNo) {
      this.elements.btnConfirmYes.addEventListener('click', () => {
        const cb = this.pendingConfirmCallback;
        this.pendingConfirmCallback = null;
        this.elements.modalConfirm.classList.add('hidden');
        if (cb) {
          cb();
        }
      });
      this.elements.btnConfirmNo.addEventListener('click', () => {
        this.pendingConfirmCallback = null;
        this.closeOverlayModal(this.elements.modalConfirm);
      });
    }

    const bindBackdropDismiss = (modalEl, onDismiss) => {
      if (!modalEl) {
        return;
      }
      modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) {
          onDismiss();
        }
      });
    };

    bindBackdropDismiss(this.elements.modalLevels, () => {
      this.closeOverlayModal(this.elements.modalLevels);
    });
    bindBackdropDismiss(this.elements.modalShop, () => {
      this.closeOverlayModal(this.elements.modalShop);
    });
    bindBackdropDismiss(this.elements.modalSettings, () => {
      this.closeOverlayModal(this.elements.modalSettings);
    });
    bindBackdropDismiss(this.elements.modalPause, () => {
      if (this.engine.state === GAME_STATES.PAUSED) {
        this.engine.togglePause();
      }
    });
    bindBackdropDismiss(this.elements.modalConfirm, () => {
      this.pendingConfirmCallback = null;
      this.closeOverlayModal(this.elements.modalConfirm);
    });

    this.elements.btnCloseLevels.addEventListener('click', () => {
      this.closeOverlayModal(this.elements.modalLevels);
    });

    this.elements.btnCloseShop.addEventListener('click', () => {
      this.closeOverlayModal(this.elements.modalShop);
    });

    this.elements.btnPlayLevelModal.addEventListener('click', () => {
      if (this.isCampaignRunActive()) {
        this.closeOverlayModal(this.elements.modalLevels);
        return;
      }
      this.hideAllModals();
      this.engine.startCampaignLevel(this.getSuggestedLevelId());
    });

    this.elements.btnNextLevel.addEventListener('click', () => {
      this.hideAllModals();
      const nextId = this.engine.currentLevelId + 1;
      const exists = this.engine.levelCatalog.has(nextId);
      if (exists) {
        this.engine.startCampaignLevel(nextId);
      } else {
        this.engine.startEndlessMode();
      }
    });

    this.elements.btnReplayVictory.addEventListener('click', () => {
      this.hideAllModals();
      this.engine.restartCurrent();
    });

    this.elements.btnLevelsVictory.addEventListener('click', () => {
      this.hideAllModals();
      this.openLevelsModal();
    });

    this.elements.btnRetry.addEventListener('click', () => {
      this.hideAllModals();
      this.engine.restartCurrent();
    });

    this.elements.btnLevelsGameOver.addEventListener('click', () => {
      this.hideAllModals();
      this.openLevelsModal();
    });

    this.elements.btnShareGameOver?.addEventListener('click', () => {
      this.shareDailyResult();
    });

    this.elements.btnResume.addEventListener('click', () => {
      this.engine.togglePause();
    });

    this.elements.btnRestartPause.addEventListener('click', () => {
      this.requestDestructiveAction(() => {
        this.hideAllModals();
        this.engine.restartCurrent();
      });
    });

    // Capture phase: the mode must switch even when a handler below stops the event.
    window.addEventListener(
      'pointerdown',
      (e) => {
        this.setInputMode(inputModeForPointerType(e.pointerType));
      },
      { capture: true }
    );

    window.addEventListener('keydown', (e) => {
      this.setInputMode(INPUT_MODES.POINTER);
      if (e.code === 'Tab' && this.isAnyModalOpen()) {
        this.trapModalFocus(e);
        return;
      }
      if (e.code === 'Tab' && this.isDrawerOpen) {
        this.trapFocusWithin(this.elements.drawer, e);
        return;
      }

      if (shouldIgnoreRepeatedKey(e.code, e.repeat)) {
        return;
      }

      if (e.code === 'Escape') {
        if (this.isDrawerOpen) {
          this.closeDrawer({ resume: true });
          return;
        }
        if (this.elements.modalConfirm && !this.elements.modalConfirm.classList.contains('hidden')) {
          this.pendingConfirmCallback = null;
          this.closeOverlayModal(this.elements.modalConfirm);
          return;
        }
        if (!this.elements.modalLevels.classList.contains('hidden')) {
          this.closeOverlayModal(this.elements.modalLevels);
          return;
        }
        if (!this.elements.modalShop.classList.contains('hidden')) {
          this.closeOverlayModal(this.elements.modalShop);
          return;
        }
        if (this.elements.modalSettings && !this.elements.modalSettings.classList.contains('hidden')) {
          this.closeOverlayModal(this.elements.modalSettings);
          return;
        }
        if (this.engine.state === GAME_STATES.PLAYING || this.engine.state === GAME_STATES.PAUSED) {
          this.engine.togglePause();
        }
        return;
      }

      if (this.isAnyModalOpen()) {
        return;
      }

      if (isBrowserShortcut(e)) {
        return;
      }

      const activeEl = document.activeElement;
      const isKeyboardInteractiveFocused = Boolean(
        activeEl &&
          activeEl !== document.body &&
          activeEl !== document.documentElement &&
          activeEl.id !== 'game-canvas' &&
          typeof activeEl.matches === 'function' &&
          activeEl.matches(':focus-visible') &&
          typeof activeEl.closest === 'function' &&
          activeEl.closest('button, a, input, select, textarea, [role="button"], [role="tab"]')
      );

      if (e.code === 'Space') {
        if (isKeyboardInteractiveFocused) {
          return;
        }
        e.preventDefault();
        this.engine.swapLauncherBalls();
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        this.engine.togglePolarityFlip();
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey
          ? this.gameConfig.canvas.keyboardAimStepRad
          : this.gameConfig.canvas.keyboardAimFineStepRad;
        const dir = e.code === 'ArrowLeft' ? -1 : 1;
        this.engine.adjustAimByDelta(dir * step);
        this.updateAimState(this.engine);
      } else if (e.code === 'Enter') {
        if (isKeyboardInteractiveFocused) {
          return;
        }
        e.preventDefault();
        this.engine.shoot();
        this.updateAimState(this.engine);
      } else if (e.code.startsWith('Digit')) {
        const idx = Number.parseInt(e.code.replace('Digit', ''), 10) - 1;
        if (idx >= 0 && idx < SPECIAL_TYPES_ORDER.length) {
          e.preventDefault();
          this.engine.equipSpecialBall(SPECIAL_TYPES_ORDER[idx]);
        }
      }
    });
  }

  requestDestructiveAction(actionCallback) {
    const isMidRound =
      (this.engine.state === GAME_STATES.PLAYING || this.engine.state === GAME_STATES.PAUSED) &&
      this.engine.hasFiredInRound &&
      this.engine.physicsWorld.balls.length > 0;

    if (!isMidRound || !this.elements.modalConfirm) {
      actionCallback();
      return;
    }

    this.pendingConfirmCallback = actionCallback;
    // Over another dialog, its opener is where focus returns when the Confirm closes.
    this.stackedModalOpener = this.isAnyModalOpen() ? document.activeElement : null;
    this.saveLastFocusedElement();
    this.elements.modalConfirm.classList.remove('hidden');
    this.syncModalInertState();
    if (this.elements.btnConfirmNo) {
      this.elements.btnConfirmNo.focus();
    }
  }

  saveLastFocusedElement() {
    if (
      !this.isAnyModalOpen() &&
      document.activeElement &&
      document.activeElement !== document.body &&
      document.activeElement !== document.documentElement
    ) {
      this.lastFocusedElement = document.activeElement;
    }
  }

  /** All modals, topmost first: the first open one is the active dialog. */
  getModalsByPriority() {
    return [
      this.elements.modalConfirm,
      ...this.getOverlayModals(),
      this.elements.modalVictory,
      this.elements.modalGameOver,
      this.elements.modalPause
    ].filter(Boolean);
  }

  /** Dialogs opened from the menu over a run, which they pause until they close. */
  getOverlayModals() {
    return [this.elements.modalLevels, this.elements.modalShop, this.elements.modalSettings].filter(Boolean);
  }

  isAnyOverlayModalOpen() {
    return this.getOverlayModals().some((modal) => !modal.classList.contains('hidden'));
  }

  /**
   * Opens a menu dialog over the run, pausing it, and focuses the given control.
   * @param {HTMLElement} modal - The dialog to show.
   * @param {HTMLElement} [focusTarget] - The control that receives focus.
   */
  openOverlayModal(modal, focusTarget) {
    if (!modal) {
      return;
    }
    this.saveLastFocusedElement();
    if (this.engine.state === GAME_STATES.PLAYING) {
      this.autoPausedByOverlay = true;
      this.engine.state = GAME_STATES.PAUSED;
    }
    modal.classList.remove('hidden');
    this.syncModalInertState();
    if (focusTarget) {
      focusTarget.focus();
    }
  }

  getActiveTopModal() {
    for (const m of this.getModalsByPriority()) {
      if (!m.classList.contains('hidden')) {
        return m;
      }
    }
    return null;
  }

  trapModalFocus(e) {
    this.trapFocusWithin(this.getActiveTopModal(), e);
  }

  /** Keeps Tab and Shift+Tab cycling inside a container (a modal or the open menu). */
  trapFocusWithin(activeModal, e) {
    if (!activeModal) {
      return;
    }
    const focusables = filterFocusTrapCandidates(activeModal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!activeModal.contains(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  syncModalInertState() {
    const anyOpen = this.isAnyModalOpen();
    if (this.elements.appShell) {
      this.elements.appShell.inert = anyOpen;
      if (anyOpen) {
        this.elements.appShell.setAttribute('aria-hidden', 'true');
      } else {
        this.elements.appShell.removeAttribute('aria-hidden');
      }
    }
    // A modal stacked on another (Confirm over Pause or Levels) leaves the
    // one underneath visible but unreachable.
    const topModal = this.getActiveTopModal();
    for (const modal of this.getModalsByPriority()) {
      const isCovered = Boolean(topModal) && modal !== topModal && !modal.classList.contains('hidden');
      modal.inert = isCovered;
      if (isCovered) {
        modal.setAttribute('aria-hidden', 'true');
      } else {
        modal.removeAttribute('aria-hidden');
      }
    }
    if (!anyOpen && this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      const target = this.lastFocusedElement;
      this.lastFocusedElement = null;
      target.focus();
    }
    if (anyOpen) {
      this.keepFocusInTopModal(topModal);
    } else {
      this.stackedModalOpener = null;
    }
  }

  /** Brings focus back into the top dialog when the one that held it just closed. */
  keepFocusInTopModal(topModal) {
    if (topModal === this.elements.modalConfirm) {
      return;
    }
    const target = resolveModalFocusTarget(
      topModal,
      document.activeElement,
      this.stackedModalOpener,
      topModal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR)
    );
    this.stackedModalOpener = null;
    if (target) {
      target.focus();
    }
  }

  /** The Workshop tabs in display order, each with its tab button and panel. */
  getShopTabs() {
    return [
      { name: SHOP_TABS.UPGRADES, el: this.elements.tabShopUpgrades, pane: this.elements.shopUpgradesPane },
      { name: SHOP_TABS.AMMO, el: this.elements.tabShopAmmo, pane: this.elements.shopAmmoPane },
      { name: SHOP_TABS.ACHIEVEMENTS, el: this.elements.tabShopAchievements, pane: this.elements.achievementsGrid },
      { name: SHOP_TABS.CODEX, el: this.elements.tabShopCodex, pane: this.elements.codexPane }
    ].filter((tab) => tab.el && tab.pane);
  }

  switchShopTab(tabName) {
    const tabs = this.getShopTabs();
    this.activeShopTab = tabs.some((tab) => tab.name === tabName) ? tabName : SHOP_TABS.UPGRADES;
    for (const { name, el, pane } of tabs) {
      const isActive = name === this.activeShopTab;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', String(isActive));
      el.tabIndex = isActive ? 0 : -1;
      pane.classList.toggle('hidden', !isActive);
    }
  }

  getAffordableUpgradeCount() {
    const coins = this.storageManager.getCoins();
    let count = 0;
    for (const [upgradeKey, spec] of Object.entries(this.gameConfig.upgrades)) {
      const currentLevel = this.storageManager.getUpgradeLevel(upgradeKey);
      if (currentLevel < spec.maxLevel && coins >= this.storageManager.getUpgradeCost(upgradeKey)) {
        count++;
      }
    }
    return count;
  }

  closeOverlayModal(modalElement) {
    modalElement.classList.add('hidden');
    const otherOverlayStillOpen =
      this.isAnyOverlayModalOpen() ||
      Boolean(this.elements.modalConfirm && !this.elements.modalConfirm.classList.contains('hidden'));

    if (!otherOverlayStillOpen && this.autoPausedByOverlay && this.engine.state === GAME_STATES.PAUSED) {
      this.autoPausedByOverlay = false;
      this.engine.state = GAME_STATES.PLAYING;
      this.elements.modalPause.classList.add('hidden');
    } else if (this.engine.state === GAME_STATES.VICTORY && !this.engine.isVictoryCelebrating()) {
      this.isVictoryModalRevealed = true;
      this.elements.modalVictory.classList.remove('hidden');
    } else if (this.engine.state === GAME_STATES.GAME_OVER) {
      this.elements.modalGameOver.classList.remove('hidden');
    } else if (this.engine.state === GAME_STATES.PAUSED && !this.autoPausedByOverlay) {
      this.elements.modalPause.classList.remove('hidden');
    }
    this.syncModalInertState();
  }

  isAnyModalOpen() {
    return this.getModalsByPriority().some((modal) => !modal.classList.contains('hidden'));
  }

  /**
   * Victory stars as one element per star, so CSS can pop them in one after another.
   * The glyphs are decorative; the label next to them carries the count.
   */
  buildVictoryStars(stars, maxStars) {
    const theme = this.gameConfig.theme;
    const stepMs = this.gameConfig.victory.starRevealStepMs;
    const glyphs = document.createElement('span');
    glyphs.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < maxStars; i++) {
      const star = document.createElement('span');
      const isFilled = i < stars;
      star.className = isFilled ? 'victory-star filled' : 'victory-star';
      star.textContent = isFilled ? theme.starFilledSymbol : theme.starEmptySymbol;
      star.style.animationDelay = `${i * stepMs}ms`;
      glyphs.append(star);
    }
    this.victoryStarsLabel = document.createElement('span');
    this.victoryStarsLabel.className = 'victory-stars-label';
    this.victoryStarsLabel.textContent = t('modals.victory.stats.stars', { stars, maxStars });
    this.elements.victoryStars.replaceChildren(glyphs, this.victoryStarsLabel);
  }

  /**
   * Rolls the victory score up from zero (ease-out), or writes it at once under reduced
   * motion. Every frame goes through the same i18n line as the final value.
   */
  startScoreCountUp(finalScore) {
    this.stopScoreCountUp();
    const writeScore = (value) => {
      setTextIfChanged(this.elements.victoryScore, t('modals.victory.stats.score', { score: formatNumber(value) }));
    };
    const durationMs = this.gameConfig.victory.countUpMs;
    if (this.storageManager.getReducedMotion() || durationMs <= 0 || typeof requestAnimationFrame !== 'function') {
      writeScore(finalScore);
      return;
    }
    let startTime = null;
    const step = (now) => {
      if (startTime === null) {
        startTime = now;
      }
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - (1 - progress) ** COUNT_UP_EASE_POWER;
      writeScore(Math.round(finalScore * eased));
      this.scoreCountUpFrame = progress < 1 ? requestAnimationFrame(step) : null;
    };
    writeScore(0);
    this.scoreCountUpFrame = requestAnimationFrame(step);
  }

  stopScoreCountUp() {
    if (this.scoreCountUpFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.scoreCountUpFrame);
    }
    this.scoreCountUpFrame = null;
  }

  /** Display name of a Flux shape; a two-part shape reads "left and right". */
  formatFluxShapeName(shapeIds) {
    const names = shapeIds.map((id) => {
      if (isGeneratedShapeId(id)) {
        const { type, fill, points } = decodeGeneratedShapeId(id);
        return t(`gameplay.flux.generated.${type}.${fill}`, { count: points });
      }
      return t(`gameplay.flux.shapes.${id}`);
    });
    if (names.length > 1) {
      return t('gameplay.flux.shapes.pairFormat', { left: names[0], right: names[1] });
    }
    return names[0] || '';
  }

  /** Theme of a generated chapter: its featured mechanic, or its pair of them. */
  formatChapterTheme(featuredMechanics) {
    const [first, second] = featuredMechanics.map((mechanic) => t(`levels.generated.themes.${mechanic}`));
    return second ? t('levels.generated.themePair', { first, second }) : first;
  }

  /**
   * Display name of a campaign level: its own name when authored, else its chapter theme
   * and its place in the chapter, then its format when it is not a standard level.
   * @param {object} summary - A level summary from the level catalog.
   */
  formatLevelName(summary) {
    if (!summary.isGenerated) {
      return t(summary.nameKey);
    }
    const name = t('levels.generated.name', {
      theme: this.formatChapterTheme(summary.featuredMechanics),
      index: summary.chapterLevel
    });
    if (!LABELLED_LEVEL_FORMATS.has(summary.format)) {
      return name;
    }
    const format = t(`levels.generated.formats.${summary.format}.label`, {
      mechanic: summary.twistMechanic ? t(`levels.generated.themes.${summary.twistMechanic}`) : ''
    });
    return t('levels.generated.formatName', { name, format });
  }

  /** Description of a campaign level, from its summary in the level catalog. */
  formatLevelDescription(summary) {
    if (!summary.isGenerated) {
      return t(summary.descriptionKey);
    }
    const params = { chapter: summary.chapter, index: summary.chapterLevel, size: summary.chapterSize };
    if (summary.isLandmark) {
      return t('levels.generated.landmarkDescription', params);
    }
    if (LABELLED_LEVEL_FORMATS.has(summary.format)) {
      return t(`levels.generated.formats.${summary.format}.description`, {
        ...params,
        mechanic: summary.twistMechanic ? t(`levels.generated.themes.${summary.twistMechanic}`) : ''
      });
    }
    return t('levels.generated.description', params);
  }

  formatStars(stars, maxStars) {
    const theme = this.gameConfig.theme;
    const filled = Math.max(0, Math.min(maxStars, stars));
    return theme.starFilledSymbol.repeat(filled) + theme.starEmptySymbol.repeat(maxStars - filled);
  }

  /**
   * Toggle buttons keep a stable accessible name and expose their state
   * through aria-pressed; the tooltip still spells the current value out.
   */
  applyToggleState(buttons, { label, ariaLabel, tooltip, pressed }) {
    for (const btn of buttons) {
      if (btn) {
        setTextIfChanged(btn, label);
        setAttributeIfChanged(btn, 'aria-label', ariaLabel);
        setAttributeIfChanged(btn, 'aria-pressed', String(pressed));
        btn.title = tooltip;
        // Touch screens never show the title, so the menu and Pause copies spell the state out.
        setTextIfChanged(document.querySelector(`[data-caption-for="${btn.id}"]`), tooltip);
      }
    }
  }

  updateSoundButton() {
    const isMuted = this.audioManager.isMuted();
    this.applyToggleState([this.elements.btnSound, this.elements.btnSoundPause], {
      label: t(isMuted ? 'app.nav.button.soundOff' : 'app.nav.button.soundOn'),
      ariaLabel: t('app.nav.button.soundAria'),
      tooltip: t(isMuted ? 'app.nav.button.soundOffAria' : 'app.nav.button.soundOnAria'),
      pressed: !isMuted
    });
  }

  updateContrastButton() {
    const isHigh = this.storageManager.getHighContrast();
    this.applyToggleState([this.elements.btnContrast, this.elements.btnContrastPause], {
      label: t(isHigh ? 'app.nav.button.contrastOn' : 'app.nav.button.contrastOff'),
      ariaLabel: t('app.nav.button.contrastAria'),
      tooltip: t(isHigh ? 'app.nav.button.contrastOnAria' : 'app.nav.button.contrastOffAria'),
      pressed: isHigh
    });
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.toggle(HIGH_CONTRAST_CLASS, isHigh);
    }
  }

  updatePatternsButton() {
    const isOn = this.storageManager.getColorPatterns();
    this.applyToggleState([this.elements.btnPatterns, this.elements.btnPatternsPause], {
      label: t(isOn ? 'app.nav.button.patternsOn' : 'app.nav.button.patternsOff'),
      ariaLabel: t('app.nav.button.patternsAria'),
      tooltip: t(isOn ? 'app.nav.button.patternsOnAria' : 'app.nav.button.patternsOffAria'),
      pressed: isOn
    });
  }

  /**
   * Tilt control exists only on touch devices that report their orientation, and is on
   * unless the player turned it off (tilt.enabledByDefault). Where the browser asks
   * permission (iOS), the request must come from a tap: it is made on the first tap on the
   * board, and a refusal is stored as the player's choice.
   */
  setupTiltControl() {
    this.isTiltActive = false;
    this.handleOrientation = (event) => {
      const screenAngle = typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0;
      this.engine.setTilt(computeTiltShare(event, screenAngle, this.gameConfig.tilt));
    };
    const isSupported =
      typeof window !== 'undefined' &&
      typeof window.DeviceOrientationEvent !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(this.gameConfig.tilt.touchMediaQuery).matches;
    for (const btn of [this.elements.btnTilt, this.elements.btnTiltPause]) {
      btn?.closest('.pause-setting')?.classList.toggle('hidden', !isSupported);
    }
    // Named even while hidden, so no audit tool finds an unnamed button.
    this.updateTiltButton();
    if (!isSupported) {
      return;
    }
    const needsPermission = typeof window.DeviceOrientationEvent.requestPermission === 'function';
    const wantsTilt = this.storageManager.getTilt(this.gameConfig.tilt.enabledByDefault);
    if (wantsTilt && !needsPermission) {
      this.setTiltActive(true);
    } else if (wantsTilt) {
      this.requestTiltOnFirstTap();
    }
    const toggleTilt = async () => {
      const next = !this.isTiltActive;
      if (next && needsPermission) {
        const answer = await window.DeviceOrientationEvent.requestPermission().catch(() => 'denied');
        if (answer !== 'granted') {
          return;
        }
      }
      this.storageManager.setTilt(next);
      this.setTiltActive(next);
    };
    for (const btn of [this.elements.btnTilt, this.elements.btnTiltPause]) {
      btn?.addEventListener('click', toggleTilt);
    }
    this.updateTiltButton();
  }

  /** Asks the orientation permission on the first tap on the board (iOS needs a tap). */
  requestTiltOnFirstTap() {
    const canvas = this.elements.gameCanvas;
    if (!canvas) {
      return;
    }
    const askOnce = async () => {
      if (this.isTiltActive) {
        return;
      }
      const answer = await window.DeviceOrientationEvent.requestPermission().catch(() => 'denied');
      const isGranted = answer === 'granted';
      this.storageManager.setTilt(isGranted);
      this.setTiltActive(isGranted);
    };
    canvas.addEventListener('pointerup', askOnce, { once: true });
  }

  setTiltActive(isActive) {
    this.isTiltActive = isActive;
    if (isActive) {
      window.addEventListener('deviceorientation', this.handleOrientation);
    } else {
      window.removeEventListener('deviceorientation', this.handleOrientation);
      this.engine.setTilt(0);
    }
    this.updateTiltButton();
  }

  updateTiltButton() {
    const isOn = Boolean(this.isTiltActive);
    this.applyToggleState([this.elements.btnTilt, this.elements.btnTiltPause], {
      label: t(isOn ? 'app.nav.button.tiltOn' : 'app.nav.button.tiltOff'),
      ariaLabel: t('app.nav.button.tiltAria'),
      tooltip: t(isOn ? 'app.nav.button.tiltOnAria' : 'app.nav.button.tiltOffAria'),
      pressed: isOn
    });
  }

  updateMotionButton() {
    const isReduced = this.storageManager.getReducedMotion();
    this.applyToggleState([this.elements.btnMotion, this.elements.btnMotionPause], {
      label: t(isReduced ? 'app.nav.button.motionReduced' : 'app.nav.button.motionOn'),
      ariaLabel: t('app.nav.button.motionAria'),
      tooltip: t(isReduced ? 'app.nav.button.motionReducedAria' : 'app.nav.button.motionOnAria'),
      pressed: isReduced
    });
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.toggle(REDUCED_MOTION_CLASS, isReduced);
    }
  }

  updateAimState(engine) {
    if (this.elements.cancelAimBanner) {
      this.elements.cancelAimBanner.classList.toggle('hidden', !engine.isAimCancelled);
    }
  }

  updateLanguageButton() {
    const locale = i18n.getLocale();
    const label = t('app.nav.button.language');
    const ariaLabel = t('app.nav.button.languageAria');
    for (const btn of [this.elements.btnLang, this.elements.btnLangPause]) {
      if (btn) {
        const codeSpan = document.createElement('span');
        codeSpan.lang = locale;
        codeSpan.textContent = label;
        btn.replaceChildren(codeSpan);
        btn.setAttribute('aria-label', ariaLabel);
        btn.title = ariaLabel;
      }
    }
    if (this.elements.btnDismissTutorial) {
      const dismissLabel = t('hud.tutorial.dismiss');
      this.elements.btnDismissTutorial.setAttribute('aria-label', dismissLabel);
      this.elements.btnDismissTutorial.title = dismissLabel;
    }
  }

  /**
   * Shares the finished Daily Challenge: the system share sheet when there is one, else the
   * clipboard, else a read-only field with the text selected for a manual copy. The outcome
   * is announced to screen readers.
   */
  async shareDailyResult() {
    const engine = this.engine;
    const shareConfig = this.gameConfig.share;
    const text = buildDailyShareText(
      {
        dateKey: engine.dailySeedKey,
        mutatorKey: engine.activeMutatorKey,
        wave: engine.waveCount,
        score: engine.score,
        waveLog: engine.waveLog,
        url: shareConfig.url
      },
      shareConfig
    );
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
        this.announce(t('share.feedback.shared'));
        return;
      } catch (error) {
        if (error?.name === SHARE_ABORT_ERROR_NAME) {
          return;
        }
      }
    }
    let feedbackKey = 'share.feedback.manual';
    if (typeof navigator.clipboard?.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        this.announce(t('share.feedback.copied'));
        return;
      } catch {
        feedbackKey = 'share.feedback.failed';
      }
    }
    this.showShareFallback(text);
    this.announce(t(feedbackKey));
  }

  /** Shows the share text in the game over window, selected and focused, ready to copy. */
  showShareFallback(text) {
    const field = this.elements.gameOverShareText;
    if (!field || !this.elements.gameOverShareFallback) {
      return;
    }
    field.value = text;
    this.elements.gameOverShareFallback.classList.remove('hidden');
    field.focus();
    field.select();
  }

  hideAllModals() {
    this.autoPausedByOverlay = false;
    for (const modal of this.getModalsByPriority()) {
      modal.classList.add('hidden');
    }
    this.syncModalInertState();
  }

  /**
   * @param {string} [tabName] - Tab to show; the last one used when omitted.
   */
  openShopModal(tabName = this.activeShopTab) {
    this.renderShopContents();
    if (this.elements.codexPane) {
      this.buildCodexPane();
    }
    this.switchShopTab(tabName);
    this.openOverlayModal(this.elements.modalShop, this.elements.btnCloseShop);
  }

  /**
   * Re-renders the shop after a purchase without reopening it, then puts
   * focus back on the same buy button (or the nearest usable one when that
   * button just became disabled).
   */
  rerenderShopKeepingFocus(focusSelector) {
    this.renderShopContents();
    const modal = this.elements.modalShop;
    const target = modal.querySelector(focusSelector);
    if (target && !target.disabled) {
      target.focus();
      return;
    }
    const fallback =
      filterFocusTrapCandidates(modal.querySelectorAll('.shop-pane button'))[0] ||
      this.elements.btnCloseShop;
    if (fallback) {
      fallback.focus();
    }
  }

  renderShopContents() {
    const coins = this.storageManager.getCoins();
    this.elements.shopBalance.textContent = t('modals.shop.balance.label', { coins: formatNumber(coins) });
    const grid = this.elements.shopGrid;
    grid.innerHTML = '';

    for (const [upgradeKey, spec] of Object.entries(this.gameConfig.upgrades)) {
      const currentLevel = this.storageManager.getUpgradeLevel(upgradeKey);
      const isMaxed = currentLevel >= spec.maxLevel;
      const cost = this.storageManager.getUpgradeCost(upgradeKey);

      const card = document.createElement('div');
      card.className = 'level-card';

      const header = document.createElement('div');
      header.className = 'level-card-header';
      header.textContent = t('modals.shop.card.level', {
        level: currentLevel,
        maxLevel: spec.maxLevel
      });

      const title = document.createElement('div');
      title.className = 'level-card-title';
      title.textContent = t(`modals.shop.upgrades.${upgradeKey}.name`);

      const desc = document.createElement('div');
      desc.className = 'level-card-desc';
      desc.textContent = t(`modals.shop.upgrades.${upgradeKey}.description`);

      if (isMaxed) {
        // A finished upgrade shows a status, not a button that only looks pressable.
        const maxedBadge = document.createElement('span');
        maxedBadge.className = 'upgrade-maxed-badge';
        const maxedGlyph = document.createElement('span');
        maxedGlyph.setAttribute('aria-hidden', 'true');
        maxedGlyph.textContent = t('modals.shop.card.maxed');
        const maxedText = document.createElement('span');
        maxedText.className = 'visually-hidden';
        maxedText.textContent = t('modals.shop.card.maxedAria');
        maxedBadge.append(maxedGlyph, maxedText);
        card.append(header, title, desc, maxedBadge);
        grid.appendChild(card);
        continue;
      }

      const buyBtn = document.createElement('button');
      buyBtn.type = 'button';
      buyBtn.className = 'modal-btn primary';
      buyBtn.dataset.upgradeKey = upgradeKey;
      buyBtn.disabled = coins < cost;
      buyBtn.textContent = t('modals.shop.card.buy', { cost: formatNumber(cost) });

      buyBtn.addEventListener('click', () => {
        if (this.storageManager.purchaseUpgrade(upgradeKey)) {
          this.audioManager.playEffect('match', currentLevel + 1);
          this.engine.updateAimFromAngle(this.engine.aimAngle);
          this.refresh(this.engine, this.lastExtra);
          this.rerenderShopKeepingFocus(`[data-upgrade-key="${upgradeKey}"]`);
        }
      });

      card.append(header, title, desc, buyBtn);
      grid.appendChild(card);
    }

    if (this.elements.shopAmmoGrid && this.gameConfig.specialShopCosts) {
      const ammoGrid = this.elements.shopAmmoGrid;
      ammoGrid.innerHTML = '';
      // Ammo is stocked into the current run, so it cannot be bought between runs.
      const canBuyAmmo = this.isRunActive();
      for (const type of SPECIAL_TYPES_ORDER) {
        const spec = this.ballsConfig.specialTypes[type];
        const cost = this.gameConfig.specialShopCosts[type];
        const count = this.engine.specialInventory[type] || 0;

        const card = document.createElement('div');
        card.className = 'ammo-card';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'powerup-icon';
        iconSpan.style.background = `radial-gradient(circle at 30% 30%, ${spec.highlight}, ${spec.fill})`;
        iconSpan.textContent = spec.icon;
        iconSpan.setAttribute('aria-hidden', 'true');

        const titleEl = document.createElement('div');
        titleEl.className = 'ammo-card-title';
        titleEl.textContent = t(`hud.powerups.${type}.name`);

        const stockEl = document.createElement('div');
        stockEl.className = 'ammo-card-stock';
        stockEl.textContent = t('modals.shop.specialAmmo.stock', { count: formatNumber(count) });

        const buyAmmoBtn = document.createElement('button');
        buyAmmoBtn.type = 'button';
        buyAmmoBtn.className = 'modal-btn primary ammo-buy-btn';
        buyAmmoBtn.dataset.specialType = type;
        buyAmmoBtn.disabled = !canBuyAmmo || coins < cost;
        buyAmmoBtn.classList.toggle('unavailable', !canBuyAmmo);
        if (canBuyAmmo) {
          buyAmmoBtn.textContent = t('modals.shop.specialAmmo.buy', { cost: formatNumber(cost) });
        } else {
          buyAmmoBtn.textContent = t('modals.shop.specialAmmo.unavailable');
          buyAmmoBtn.title = t('modals.shop.specialAmmo.unavailableHint');
        }

        buyAmmoBtn.addEventListener('click', () => {
          if (this.engine.buySpecialAmmo(type)) {
            this.rerenderShopKeepingFocus(`.ammo-buy-btn[data-special-type="${type}"]`);
          }
        });

        card.append(iconSpan, titleEl, stockEl, buyAmmoBtn);
        ammoGrid.appendChild(card);
      }
    }

    if (this.elements.achievementsGrid && this.gameConfig.achievements) {
      const achGrid = this.elements.achievementsGrid;
      achGrid.innerHTML = '';
      const unlockedMap = this.storageManager.getUnlockedAchievements();
      const achEntries = Object.entries(this.gameConfig.achievements);
      let unlockedCount = 0;

      for (const [achId, achSpec] of achEntries) {
        const isUnlocked = Boolean(unlockedMap[achId]);
        if (isUnlocked) {
          unlockedCount++;
        }
        const card = document.createElement('div');
        card.className = `level-card ${isUnlocked ? 'unlocked' : 'locked'}`;

        const header = document.createElement('div');
        header.className = 'level-card-header';
        header.textContent = t('modals.shop.achievements.reward', { coins: achSpec.rewardCoins });

        const title = document.createElement('div');
        title.className = 'level-card-title';
        title.textContent = t(`modals.shop.achievements.items.${achId}.name`);

        const desc = document.createElement('div');
        desc.className = 'level-card-desc';
        desc.textContent = t(`modals.shop.achievements.items.${achId}.description`);

        const footer = document.createElement('div');
        footer.className = 'level-card-footer';
        const statusEl = document.createElement('span');
        statusEl.className = isUnlocked ? 'achievement-unlocked-badge' : 'level-locked-badge';
        statusEl.textContent = isUnlocked
          ? t('modals.shop.achievements.unlockedBadge')
          : t('modals.shop.achievements.lockedBadge');
        footer.appendChild(statusEl);

        card.append(header, title, desc, footer);
        achGrid.appendChild(card);
      }

      if (this.elements.tabShopAchievements) {
        this.elements.tabShopAchievements.textContent = t('modals.shop.tabs.achievements', {
          unlocked: unlockedCount,
          total: achEntries.length
        });
      }
    }
  }

  buildCodexPane() {
    const pane = this.elements.codexPane;
    if (!pane) {
      return;
    }
    pane.innerHTML = '';

    const modHeading = document.createElement('h3');
    modHeading.className = 'modal-subtitle';
    modHeading.textContent = t('modals.shop.codex.modifiersTitle');
    pane.appendChild(modHeading);

    const modGrid = document.createElement('div');
    modGrid.className = 'codex-grid';
    for (const [modKey, modSpec] of Object.entries(this.ballsConfig.clusterModifiers || {})) {
      const card = document.createElement('div');
      card.className = 'codex-card';

      const badge = document.createElement('div');
      badge.className = 'codex-badge';
      badge.style.borderColor = modSpec.ringColor;
      badge.textContent = modSpec.badge || '';

      const info = document.createElement('div');
      info.className = 'codex-info';
      const title = document.createElement('div');
      title.className = 'codex-title';
      title.textContent = t(`modals.shop.codex.modifiers.${modKey}.name`);
      const desc = document.createElement('div');
      desc.className = 'codex-desc';
      desc.textContent = t(`modals.shop.codex.modifiers.${modKey}.description`);
      info.append(title, desc);

      card.append(badge, info);
      modGrid.appendChild(card);
    }
    pane.appendChild(modGrid);

    const obsHeading = document.createElement('h3');
    obsHeading.className = 'modal-subtitle';
    obsHeading.textContent = t('modals.shop.codex.obstaclesTitle');
    pane.appendChild(obsHeading);

    const obsGrid = document.createElement('div');
    obsGrid.className = 'codex-grid';
    for (const obsKey of OBSTACLE_TYPES_ORDER) {
      const card = document.createElement('div');
      card.className = 'codex-card';

      const badge = document.createElement('div');
      badge.className = 'codex-badge';
      badge.textContent = t(`modals.shop.codex.obstacles.${obsKey}.icon`);

      const info = document.createElement('div');
      info.className = 'codex-info';
      const title = document.createElement('div');
      title.className = 'codex-title';
      title.textContent = t(`modals.shop.codex.obstacles.${obsKey}.name`);
      const desc = document.createElement('div');
      desc.className = 'codex-desc';
      desc.textContent = t(`modals.shop.codex.obstacles.${obsKey}.description`);
      info.append(title, desc);

      card.append(badge, info);
      obsGrid.appendChild(card);
    }
    pane.appendChild(obsGrid);
  }

  isCampaignRunActive() {
    return this.engine.mode === GAME_MODES.CAMPAIGN && this.isRunActive();
  }

  /** The level the select dialog puts forward: the one being played, else the furthest unlocked. */
  getSuggestedLevelId() {
    if (this.engine.mode === GAME_MODES.CAMPAIGN && this.engine.currentLevelId) {
      return this.engine.currentLevelId;
    }
    return Math.min(this.storageManager.getUnlockedLevel(), this.engine.levelCatalog.lastId);
  }

  openLevelsModal() {
    const suggestedLevelId = this.getSuggestedLevelId();

    if (this.elements.levelsStarsSummary) {
      const totalStars = this.storageManager.getTotalStars();
      const maxCampaignStars = this.engine.levelCatalog.count * this.gameConfig.scoring.maxStars;
      this.elements.levelsStarsSummary.textContent = t('modals.levelSelect.starsTotal', {
        stars: totalStars,
        maxStars: maxCampaignStars
      });
    }

    // The dialog opens on the chapter of the suggested level.
    this.levelsChapterIndex = this.engine.levelCatalog.chapterIndexOf(suggestedLevelId);
    this.renderLevelChapters();
    const suggestedCard = this.renderLevelCards(suggestedLevelId);
    const grid = this.elements.levelsGrid;

    const playButton = this.elements.btnPlayLevelModal;
    setTextIfChanged(
      playButton,
      t(this.isCampaignRunActive() ? 'modals.levelSelect.button.resume' : 'modals.levelSelect.button.play', {
        level: suggestedLevelId
      })
    );
    this.openOverlayModal(this.elements.modalLevels, playButton);
    this.centerActiveChapter();
    if (suggestedCard) {
      // Only the grid scrolls: scrollIntoView would also move the dialog inside its backdrop.
      const gridRect = grid.getBoundingClientRect();
      const cardRect = suggestedCard.getBoundingClientRect();
      grid.scrollTop += cardRect.top - gridRect.top - (gridRect.height - cardRect.height) * MATH_CONSTANTS.HALF;
    }
  }

  /** Display name of a chapter of the level select. */
  formatChapterName(chapter) {
    if (chapter.isTutorial) {
      return t('modals.levelSelect.chapters.tutorial');
    }
    return t('modals.levelSelect.chapters.numbered', {
      chapter: chapter.index,
      theme: this.formatChapterTheme(chapter.featuredMechanics)
    });
  }

  /**
   * Fills the chapter strip of the level select: one tab per chapter with the stars won in
   * it. A chapter whose first level is still locked cannot be opened.
   */
  renderLevelChapters() {
    const strip = this.elements.levelsChapters;
    if (!strip) {
      return;
    }
    const unlocked = this.storageManager.getUnlockedLevel();
    const stats = this.storageManager.getLevelStats();
    const maxStarsPerLevel = this.gameConfig.scoring.maxStars;
    const chapters = this.engine.levelCatalog.listChapters();
    const openable = chapters.filter((chapter) => chapter.firstId <= unlocked);
    strip.innerHTML = '';

    for (const chapter of chapters) {
      const isLocked = chapter.firstId > unlocked;
      const isActive = chapter.index === this.levelsChapterIndex;
      let stars = 0;
      for (let id = chapter.firstId; id <= chapter.lastId; id++) {
        stars += Math.max(0, Math.min(maxStarsPerLevel, stats[id]?.stars || 0));
      }
      const maxStars = (chapter.lastId - chapter.firstId + 1) * maxStarsPerLevel;
      const name = this.formatChapterName(chapter);

      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `level-chapter${isActive ? ' active' : ''}${isLocked ? ' locked' : ''}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(isActive));
      tab.setAttribute('aria-controls', 'levels-grid');
      tab.tabIndex = isActive ? 0 : -1;
      if (isLocked) {
        tab.setAttribute('aria-disabled', 'true');
      }
      tab.setAttribute(
        'aria-label',
        t(isLocked ? 'modals.levelSelect.chapters.ariaLocked' : 'modals.levelSelect.chapters.aria', {
          name,
          first: chapter.firstId,
          last: chapter.lastId,
          stars,
          maxStars
        })
      );

      const titleEl = document.createElement('span');
      titleEl.className = 'level-chapter-title';
      titleEl.textContent = name;
      const starsEl = document.createElement('span');
      starsEl.className = 'level-chapter-stars';
      starsEl.textContent = isLocked
        ? t('modals.levelSelect.chapters.locked')
        : t('modals.levelSelect.chapters.stars', { stars, maxStars });
      tab.append(titleEl, starsEl);

      tab.addEventListener('click', () => this.selectLevelChapter(chapter.index));
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') {
          return;
        }
        e.preventDefault();
        const position = openable.findIndex((entry) => entry.index === this.levelsChapterIndex);
        const step = e.key === 'ArrowRight' ? 1 : -1;
        const next = openable[(position + step + openable.length) % openable.length];
        this.selectLevelChapter(next.index, { focus: true });
      });
      strip.appendChild(tab);
    }
  }

  /** Scrolls the chapter strip, and only it, so the active chapter sits in the middle. */
  centerActiveChapter() {
    const strip = this.elements.levelsChapters;
    const active = strip?.querySelector('.level-chapter.active');
    if (!active) {
      return;
    }
    const stripRect = strip.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    strip.scrollLeft += activeRect.left - stripRect.left - (stripRect.width - activeRect.width) * MATH_CONSTANTS.HALF;
  }

  /**
   * Shows the levels of another chapter. A locked chapter is left closed.
   * @param {number} index - Chapter index from the level catalog.
   * @param {{focus?: boolean}} options - focus moves the keyboard focus to the new tab.
   */
  selectLevelChapter(index, { focus = false } = {}) {
    const chapter = this.engine.levelCatalog.listChapters()[index];
    if (!chapter || chapter.firstId > this.storageManager.getUnlockedLevel()) {
      return;
    }
    this.levelsChapterIndex = index;
    this.renderLevelChapters();
    this.renderLevelCards(this.getSuggestedLevelId());
    this.elements.levelsGrid.scrollTop = 0;
    this.centerActiveChapter();
    if (focus) {
      this.elements.levelsChapters.querySelector('.level-chapter.active')?.focus();
    }
  }

  /**
   * Fills the level grid with the cards of the selected chapter.
   * @param {number} suggestedLevelId - Level marked as the current one.
   * @returns {HTMLElement|null} The card of the suggested level, when it is in the chapter.
   */
  renderLevelCards(suggestedLevelId) {
    const catalog = this.engine.levelCatalog;
    const chapter = catalog.listChapters()[this.levelsChapterIndex];
    const unlocked = this.storageManager.getUnlockedLevel();
    const stats = this.storageManager.getLevelStats();
    const grid = this.elements.levelsGrid;
    let suggestedCard = null;
    grid.innerHTML = '';

    for (let levelId = chapter.firstId; levelId <= chapter.lastId; levelId++) {
      const lvl = catalog.summarize(levelId);
      const isUnlocked = lvl.id <= unlocked;
      const lvlStat = stats[lvl.id] || { bestScore: 0, stars: 0 };

      const card = document.createElement('div');
      card.className = `level-card ${isUnlocked ? 'unlocked' : 'locked'}`;

      const header = document.createElement('div');
      header.className = 'level-card-header';
      header.textContent = t('modals.levelSelect.card.levelNumber', { id: lvl.id });
      if (lvl.id === suggestedLevelId) {
        suggestedCard = card;
        card.classList.add('current');
        card.setAttribute('aria-current', 'true');
        const currentBadge = document.createElement('span');
        currentBadge.className = 'level-current-badge';
        currentBadge.textContent = t('modals.levelSelect.card.current');
        header.append(' ', currentBadge);
      }

      const title = document.createElement('div');
      title.className = 'level-card-title';
      title.textContent = this.formatLevelName(lvl);

      const desc = document.createElement('div');
      desc.className = 'level-card-desc';
      desc.textContent = this.formatLevelDescription(lvl);

      const footer = document.createElement('div');
      footer.className = 'level-card-footer';

      if (isUnlocked) {
        const maxStars = this.gameConfig.scoring.maxStars;
        const starsEl = document.createElement('span');
        starsEl.className = 'level-stars';
        // Star glyphs are decorative; the hidden text states the count.
        const starsGlyphs = document.createElement('span');
        starsGlyphs.setAttribute('aria-hidden', 'true');
        starsGlyphs.textContent = this.formatStars(lvlStat.stars, maxStars);
        const starsText = document.createElement('span');
        starsText.className = 'visually-hidden';
        starsText.textContent = t('modals.levelSelect.card.starsAria', {
          stars: Math.max(0, Math.min(maxStars, lvlStat.stars)),
          maxStars
        });
        starsEl.append(starsGlyphs, starsText);

        const scoreEl = document.createElement('span');
        scoreEl.className = 'level-best';
        scoreEl.textContent = t('modals.levelSelect.card.bestScore', { score: formatNumber(lvlStat.bestScore) });

        footer.append(starsEl, scoreEl);
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        const selectLevel = () => {
          const isOtherLevelOrMidRound =
            lvl.id !== this.engine.currentLevelId ||
            (this.engine.hasFiredInRound && this.engine.physicsWorld.balls.length > 0);
          if (isOtherLevelOrMidRound) {
            this.requestDestructiveAction(() => {
              this.hideAllModals();
              this.engine.startCampaignLevel(lvl.id);
            });
          } else {
            this.hideAllModals();
            this.engine.startCampaignLevel(lvl.id);
          }
        };
        card.addEventListener('click', selectLevel);
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectLevel();
          }
        });
      } else {
        const lockEl = document.createElement('span');
        lockEl.className = 'level-locked-badge';
        lockEl.textContent = t('modals.levelSelect.card.locked', { previous: lvl.id - 1 });
        footer.appendChild(lockEl);
      }

      card.append(header, title, desc, footer);
      grid.appendChild(card);
    }
    return suggestedCard;
  }

  /** Fills the gauge from the last star earned toward the next one. */
  updateStarMeter(score, thresholds, nextThreshold) {
    const meter = this.elements.starMeter;
    if (!meter) {
      return;
    }
    const pct = computeStarProgressPct(score, thresholds, nextThreshold);
    this.elements.starMeterFill.style.width = `${pct}%`;
    setAttributeIfChanged(meter, 'aria-valuenow', String(pct));
  }

  refresh(engine, extra = {}) {
    // One-shot extras must not replay when refresh is re-run with lastExtra
    // (language change, shop purchase).
    const { unlockedAchievementId, ...persistentExtra } = extra;
    this.lastExtra = persistentExtra;
    setTextIfChanged(this.elements.scoreValue, formatNumber(engine.score));
    setTextIfChanged(
      this.elements.coinsValue,
      t('hud.stats.coins.value', { coins: formatNumber(this.storageManager.getCoins()) })
    );

    const affordableCount = this.getAffordableUpgradeCount();
    setTextIfChanged(
      this.elements.btnShop,
      affordableCount > 0
        ? t('app.nav.button.shopBadge', { count: affordableCount })
        : t('app.nav.button.shop')
    );
    this.elements.btnShop.classList.toggle('has-affordable', affordableCount > 0);

    // Only the mode being played stands out, and says so to screen readers.
    for (const [mode, elementKey] of Object.entries(MODE_BUTTON_KEYS)) {
      const button = this.elements[elementKey];
      if (button) {
        const isActive = engine.mode === mode;
        button.classList.toggle('active-mode', isActive);
        if (isActive) {
          setAttributeIfChanged(button, 'aria-current', 'true');
        } else {
          button.removeAttribute('aria-current');
        }
      }
    }
    if (this.elements.btnDaily) {
      const todayKey = SeededRandom.getTodayDateKey();
      const dailyBonusCoins = this.gameConfig.daily?.firstPlayBonusCoins || 0;
      const canClaimDaily = dailyBonusCoins > 0 && !this.storageManager.hasPlayedDailyToday(todayKey);
      setTextIfChanged(
        this.elements.btnDaily,
        canClaimDaily
          ? t('app.nav.button.dailyBonusBadge', { coins: dailyBonusCoins })
          : t('app.nav.button.daily')
      );
    }

    const overchargePct = Math.min(
      100,
      Math.round((engine.overcharge / this.gameConfig.scoring.overchargeMax) * 100)
    );
    setTextIfChanged(this.elements.overchargePct, t('hud.stats.overcharge.pct', { pct: overchargePct }));
    this.elements.overchargeFill.style.width = `${overchargePct}%`;

    let bestScore = 0;
    if (engine.mode === GAME_MODES.CAMPAIGN) {
      bestScore = this.storageManager.getLevelStats()[engine.currentLevelId]?.bestScore || 0;
    } else if (engine.mode === GAME_MODES.DAILY) {
      bestScore = this.storageManager.getDailyHighScore(engine.dailySeedKey || SeededRandom.getTodayDateKey());
    } else if (engine.mode === GAME_MODES.FLUX) {
      bestScore = this.storageManager.getFluxHighScore();
    } else {
      bestScore = this.storageManager.getEndlessHighScore();
    }

    setTextIfChanged(this.elements.highScoreValue, formatNumber(Math.max(bestScore, engine.score)));

    if (this.elements.polarityBtn) {
      const polState = engine.isPolarityFlipped ? 'inverted' : 'normal';
      this.setLauncherButton(
        this.elements.polarityBtn,
        'hud.launcher.polarity.icon',
        `hud.launcher.polarity.${polState}`,
        'hud.launcher.polarity.shortcut',
        `hud.launcher.polarity.caption.${polState}`
      );
      this.elements.polarityBtn.classList.toggle('active', Boolean(engine.isPolarityFlipped));
    }

    const warningShotsThreshold = this.gameConfig.canvas.survivalWaveWarningThreshold;

    if (engine.mode === GAME_MODES.CAMPAIGN) {
      const lvl = engine.levelCatalog.summarize(engine.currentLevelId);
      setTextIfChanged(
        this.elements.modeBanner,
        t('hud.stats.mode.campaign', {
          level: engine.currentLevelId,
          name: lvl ? this.formatLevelName(lvl) : ''
        })
      );
      if (this.elements.shotsLabel) {
        setTextIfChanged(this.elements.shotsLabel, t('hud.stats.shots.label'));
      }
      setTextIfChanged(this.elements.shotsValue, formatNumber(engine.shotsRemaining));
      this.elements.shotsValue.classList.toggle(
        'warning',
        engine.shotsRemaining <= warningShotsThreshold
      );

      if (this.elements.starProgress) {
        const thresholds = engine.getStarThresholds();
        const maxStars = this.gameConfig.scoring.maxStars;
        const currentStars = engine.computeStars(engine.score);
        const starsStr = this.formatStars(currentStars, maxStars);
        const nextThreshold = thresholds.find((th) => th > engine.score);
        this.updateStarMeter(engine.score, thresholds, nextThreshold);
        // Two unbreakable parts, so a narrow HUD wraps between them and never inside one.
        setTextIfChanged(this.elements.starGlyphs, starsStr);
        setTextIfChanged(
          this.elements.starNext,
          nextThreshold !== undefined
            ? t('hud.stats.score.nextThreshold', { next: formatNumber(nextThreshold) })
            : t('hud.stats.score.maxReached')
        );
        this.elements.starProgress.classList.remove('hidden');
      }
    } else if (engine.mode === GAME_MODES.FLUX) {
      setTextIfChanged(
        this.elements.modeBanner,
        t(engine.fluxIsBossStage ? 'hud.stats.mode.fluxBoss' : 'hud.stats.mode.flux', {
          stage: engine.fluxStage,
          shape: this.formatFluxShapeName(engine.fluxShapeIds)
        })
      );
      if (this.elements.shotsLabel) {
        setTextIfChanged(this.elements.shotsLabel, t('hud.stats.shots.label'));
      }
      setTextIfChanged(this.elements.shotsValue, formatNumber(engine.shotsRemaining));
      this.elements.shotsValue.classList.toggle('warning', engine.shotsRemaining <= warningShotsThreshold);
      if (this.elements.starProgress) {
        this.elements.starProgress.classList.add('hidden');
      }
    } else {
      if (engine.mode === GAME_MODES.DAILY) {
        const mutatorLabel = engine.activeMutatorKey
          ? t(`gameplay.mutators.${engine.activeMutatorKey}`)
          : '';
        setTextIfChanged(
          this.elements.modeBanner,
          t('hud.stats.mode.daily', {
            mutator: mutatorLabel,
            wave: engine.waveCount
          })
        );
      } else {
        setTextIfChanged(
          this.elements.modeBanner,
          t('hud.stats.mode.endless', {
            wave: engine.waveCount
          })
        );
      }
      if (this.elements.shotsLabel) {
        setTextIfChanged(this.elements.shotsLabel, t('hud.stats.shots.waveLabel'));
      }
      setTextIfChanged(this.elements.shotsValue, formatNumber(engine.shotsUntilWave));
      this.elements.shotsValue.classList.toggle(
        'warning',
        engine.shotsUntilWave <= warningShotsThreshold
      );
      if (this.elements.starProgress) {
        this.elements.starProgress.classList.add('hidden');
      }
    }

    if (engine.combo > 1) {
      setTextIfChanged(this.elements.comboBadge, t('hud.stats.combo.label', { count: engine.combo }));
      this.elements.comboBadge.classList.remove('hidden');
    } else {
      this.elements.comboBadge.classList.add('hidden');
    }

    if (engine.freezeTurnsRemaining > 0) {
      setTextIfChanged(
        this.elements.frozenBadge,
        t('hud.stats.frozen.label', { turns: engine.freezeTurnsRemaining })
      );
      this.elements.frozenBadge.classList.remove('hidden');
    } else {
      this.elements.frozenBadge.classList.add('hidden');
    }

    // Both banners are polite live regions: rewriting identical text on every
    // engine event would make screen readers repeat them.
    if (this.elements.tutorialBanner) {
      const hintText = engine.activeDiscoveryId
        ? resolveHintText(engine.activeDiscoveryId, this.gameConfig.onboarding, this.ballsConfig, t)
        : '';
      if (hintText && engine.state === GAME_STATES.PLAYING) {
        revealLiveRegion({
          region: this.elements.tutorialBanner,
          textElement: this.elements.tutorialBannerText,
          text: hintText,
          schedule: scheduleNextFrame
        });
      } else {
        this.elements.tutorialBanner.classList.add('hidden');
      }
    }

    if (this.elements.specialEquippedBanner) {
      const equippedType = engine.currentBall?.specialType;
      if (equippedType && engine.state === GAME_STATES.PLAYING) {
        const spec = this.ballsConfig.specialTypes[equippedType];
        setTextIfChanged(
          this.elements.specialEquippedBanner,
          t('hud.launcher.specialEquipped.hint', {
            icon: spec?.icon || '',
            name: t(`hud.powerups.${equippedType}.name`),
            desc: t(`hud.powerups.${equippedType}.tooltip`),
            unequip: t(`hud.launcher.specialEquipped.unequip.${this.inputMode}`)
          })
        );
        this.elements.specialEquippedBanner.classList.remove('hidden');
      } else {
        this.elements.specialEquippedBanner.classList.add('hidden');
      }
    }

    this.updateAimState(engine);

    // A level that hands out no special ball shows no empty slots to a new player.
    const offersSpecialBalls = engine.offersSpecialBalls();
    this.elements.powerupsContainer.classList.toggle('hidden', !offersSpecialBalls);
    this.elements.powerupsHeader?.classList.toggle('hidden', !offersSpecialBalls);

    const buttons = this.elements.powerupsContainer.querySelectorAll('.powerup-btn');
    const canBuyAmmo = this.isRunActive();
    for (const btn of buttons) {
      const type = btn.dataset.specialType;
      const count = engine.specialInventory[type] || 0;
      const isEquipped = Boolean(engine.currentBall && engine.currentBall.specialType === type);
      const isEmpty = count <= 0 && !isEquipped;
      const countEl = document.getElementById(`powerup-count-${type}`);
      setTextIfChanged(countEl, isEmpty && canBuyAmmo ? t('hud.powerups.button.emptyMark') : String(count));
      const label =
        isEmpty && canBuyAmmo
          ? t('hud.powerups.button.buyAria', { name: t(`hud.powerups.${type}.name`) })
          : this.getPowerupAriaLabel(type, count);
      setAttributeIfChanged(btn, 'aria-label', label);
      btn.classList.toggle('equipped', isEquipped);
      btn.classList.toggle(EMPTY_POWERUP_CLASS, isEmpty && canBuyAmmo);
      setAttributeIfChanged(btn, 'aria-pressed', String(isEquipped));
      // Ammo is only sold during a round, so between rounds an empty button stays inert.
      btn.disabled = isEmpty && !canBuyAmmo;
    }

    const transitionedState = this.prevEngineState !== engine.state;
    this.prevEngineState = engine.state;

    if (extra.fluxStageCleared) {
      this.announce(t('hud.announcer.round.fluxStageCleared', { stage: extra.fluxStageCleared }));
    }

    if (unlockedAchievementId) {
      const spec = this.gameConfig.achievements?.[unlockedAchievementId];
      this.announce(
        t('hud.announcer.achievement.unlocked', {
          name: t(`modals.shop.achievements.items.${unlockedAchievementId}.name`),
          coins: formatNumber(spec?.rewardCoins || 0)
        })
      );
    }

    if (engine.state === GAME_STATES.PAUSED && !this.autoPausedByOverlay) {
      if (this.elements.pauseLevelTip) {
        if (engine.levelTutorialKey) {
          setTextIfChanged(
            this.elements.pauseLevelTip,
            t('modals.pause.levelTip', {
              tip: t(engine.levelTutorialKey)
            })
          );
          this.elements.pauseLevelTip.classList.remove('hidden');
        } else {
          this.elements.pauseLevelTip.classList.add('hidden');
        }
      }
      if (transitionedState) {
        this.saveLastFocusedElement();
      }
      this.elements.modalPause.classList.remove('hidden');
      if (transitionedState && this.elements.btnResume) {
        this.elements.btnResume.focus();
      }
    } else {
      this.elements.modalPause.classList.add('hidden');
    }

    // The modal waits for the post-victory celebration, and for any menu opened meanwhile:
    // closing that menu reveals it (see closeOverlayModal).
    const canRevealVictory =
      engine.state === GAME_STATES.VICTORY &&
      !engine.isVictoryCelebrating() &&
      !this.isAnyOverlayModalOpen();
    const isVictoryJustRevealed = canRevealVictory && !this.isVictoryModalRevealed;
    if (engine.state !== GAME_STATES.VICTORY || canRevealVictory) {
      this.isVictoryModalRevealed = canRevealVictory;
    }

    if (engine.state !== GAME_STATES.VICTORY && this.isVictoryPresented) {
      this.isVictoryPresented = false;
      this.stopScoreCountUp();
    }

    if (canRevealVictory) {
      // The run is over: the menu goes away without resuming anything.
      this.closeDrawer({ resume: false });
      const summary = engine.victorySummary || extra;
      const stars = summary.stars || engine.computeStars(engine.score);
      const maxStars = this.gameConfig.scoring.maxStars;
      const scoreText = formatNumber(engine.score);
      // Score roll-up and star pops play once per victory, the first time the window
      // shows; later refreshes only keep the texts current (e.g. after a language switch).
      if (!this.isVictoryPresented) {
        this.isVictoryPresented = true;
        this.buildVictoryStars(stars, maxStars);
        this.startScoreCountUp(engine.score);
      } else {
        if (this.scoreCountUpFrame === null) {
          setTextIfChanged(this.elements.victoryScore, t('modals.victory.stats.score', { score: scoreText }));
        }
        setTextIfChanged(this.victoryStarsLabel, t('modals.victory.stats.stars', { stars, maxStars }));
      }
      setTextIfChanged(
        this.elements.victoryBonus,
        t('modals.victory.stats.shotsBonus', {
          bonus: formatNumber(summary.victoryBonus || 0),
          coins: formatNumber(summary.earnedCoins || 0)
        })
      );
      if (isVictoryJustRevealed) {
        this.saveLastFocusedElement();
        this.announce(t('hud.announcer.round.victory', { score: scoreText, stars, maxStars }));
      }
      this.elements.modalVictory.classList.remove('hidden');
      if (isVictoryJustRevealed && this.elements.btnNextLevel) {
        this.elements.btnNextLevel.focus();
      }
    }

    if (engine.state === GAME_STATES.GAME_OVER) {
      this.closeDrawer({ resume: false });
      const reasonKey = gameOverReasonKey(extra.gameOverReason);
      const scoreText = formatNumber(engine.score);
      setTextIfChanged(this.elements.gameOverReason, t(reasonKey));
      setTextIfChanged(this.elements.gameOverScore, t('modals.gameOver.stats.score', { score: scoreText }));
      setTextIfChanged(
        this.elements.gameOverBest,
        t('modals.gameOver.stats.highScore', {
          highScore: formatNumber(Math.max(bestScore, engine.score))
        })
      );
      if (this.elements.gameOverStage) {
        const isFlux = engine.mode === GAME_MODES.FLUX;
        if (isFlux) {
          setTextIfChanged(
            this.elements.gameOverStage,
            t('modals.gameOver.stats.fluxStage', {
              stage: engine.fluxStage,
              best: Math.max(engine.fluxStage, this.storageManager.getFluxBestStage())
            })
          );
        }
        this.elements.gameOverStage.classList.toggle('hidden', !isFlux);
      }
      this.elements.btnShareGameOver?.classList.toggle('hidden', engine.mode !== GAME_MODES.DAILY);
      if (transitionedState) {
        this.elements.gameOverShareFallback?.classList.add('hidden');
        this.saveLastFocusedElement();
        this.announce(t('hud.announcer.round.gameOver', { reason: t(reasonKey), score: scoreText }));
      }
      this.elements.modalGameOver.classList.remove('hidden');
      if (transitionedState && this.elements.btnRetry) {
        this.elements.btnRetry.focus();
      }
    }

    setTextIfChanged(
      this.elements.compactInfo,
      t('hud.stats.compactLine', {
        mode: this.elements.modeBanner.textContent,
        coins: this.elements.coinsValue.textContent,
        best: this.elements.highScoreValue.textContent
      })
    );
    this.syncDrawerStats();
    this.syncModalInertState();
  }
}

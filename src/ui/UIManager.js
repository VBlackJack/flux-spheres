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
  GAME_STATES,
  INPUT_MODES,
  SPECIAL_TYPES,
  SPECIAL_TYPES_ORDER,
  OBSTACLE_TYPES_ORDER
} from '../core/Constants.js';
import { i18n, t, formatNumber } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';

/** Elements a modal focus trap may cycle through (inactive tabs use tabindex="-1"). */
export const MODAL_FOCUSABLE_SELECTOR =
  'button:not(:disabled):not([tabindex="-1"]), [href]:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

/** Ancestors that remove an element from the interactive tree. */
const NON_INTERACTIVE_ANCESTOR_SELECTOR = '.hidden, [hidden], [inert]';

/** Root class mirroring the in-app reduced motion setting for CSS. */
export const REDUCED_MOTION_CLASS = 'reduced-motion';

/** App shell class that slides the menu in on portrait phones. */
const DRAWER_OPEN_CLASS = 'drawer-open';

/** Pointer types that mean a finger-like input without a keyboard at hand. */
const TOUCH_POINTER_TYPES = new Set(['touch', 'pen']);

/** Root data attribute mirroring the current input mode for CSS. */
const INPUT_MODE_DATASET_KEY = 'input';

/** Pause modal hints that have one wording per input mode. */
const PAUSE_INPUT_HINTS = Object.freeze([
  { elementId: 'pause-instruction-aim', key: 'modals.pause.instructions.aim' },
  { elementId: 'pause-instruction-swap', key: 'modals.pause.instructions.swap' },
  { elementId: 'pause-instruction-cancel', key: 'modals.pause.instructions.cancel' }
]);

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
  constructor({ engine, renderer, storageManager, audioManager, gameConfig, levelsConfig, ballsConfig }) {
    this.engine = engine;
    this.renderer = renderer;
    this.storageManager = storageManager;
    this.audioManager = audioManager;
    this.gameConfig = gameConfig;
    this.levelsConfig = levelsConfig;
    this.ballsConfig = ballsConfig;

    this.elements = {
      appShell: document.querySelector('.app-shell'),
      canvasWrapper: document.querySelector('.canvas-wrapper'),
      scoreValue: document.getElementById('hud-score-value'),
      starProgress: document.getElementById('hud-star-progress'),
      starGlyphs: document.getElementById('hud-star-glyphs'),
      starNext: document.getElementById('hud-star-next'),
      highScoreValue: document.getElementById('hud-best-value'),
      coinsValue: document.getElementById('hud-coins-value'),
      overchargePct: document.getElementById('hud-overcharge-pct'),
      overchargeFill: document.getElementById('hud-overcharge-fill'),
      modeBanner: document.getElementById('hud-mode-banner'),
      shotsLabel: document.getElementById('hud-shots-label'),
      shotsValue: document.getElementById('hud-shots-value'),
      comboBadge: document.getElementById('hud-combo-badge'),
      frozenBadge: document.getElementById('hud-frozen-badge'),
      powerupsContainer: document.getElementById('powerups-bar'),
      btnLevels: document.getElementById('btn-levels'),
      btnEndless: document.getElementById('btn-endless'),
      btnDaily: document.getElementById('btn-daily'),
      btnShop: document.getElementById('btn-shop'),
      btnRestart: document.getElementById('btn-restart'),
      btnPause: document.getElementById('btn-pause'),
      btnSound: document.getElementById('btn-sound'),
      btnContrast: document.getElementById('btn-contrast'),
      btnMotion: document.getElementById('btn-motion'),
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
      levelsGrid: document.getElementById('levels-grid'),
      btnCloseLevels: document.getElementById('btn-close-levels'),
      btnPlayEndlessModal: document.getElementById('btn-play-endless-modal'),
      modalShop: document.getElementById('modal-shop'),
      shopBalance: document.getElementById('shop-balance'),
      tabShopUpgrades: document.getElementById('tab-shop-upgrades'),
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
      btnRetry: document.getElementById('btn-retry'),
      btnLevelsGameOver: document.getElementById('btn-levels-gameover'),
      modalPause: document.getElementById('modal-pause'),
      pauseLevelTip: document.getElementById('pause-level-tip'),
      btnResume: document.getElementById('btn-resume'),
      btnRestartPause: document.getElementById('btn-restart-pause'),
      btnSoundPause: document.getElementById('btn-sound-pause'),
      btnContrastPause: document.getElementById('btn-contrast-pause'),
      btnMotionPause: document.getElementById('btn-motion-pause'),
      btnLangPause: document.getElementById('btn-lang-pause'),
      modalConfirm: document.getElementById('modal-confirm'),
      btnConfirmYes: document.getElementById('btn-confirm-yes'),
      btnConfirmNo: document.getElementById('btn-confirm-no'),
      srAnnouncer: document.getElementById('sr-announcer')
    };

    this.pendingAnnouncements = [];
    this.isAnnouncementScheduled = false;
    this.lastExtra = {};
    this.pendingConfirmCallback = null;
    this.activeShopTab = 'upgrades';
    this.autoPausedByOverlay = false;
    this.lastFocusedElement = null;
    this.prevEngineState = null;
    this.isVictoryModalRevealed = false;
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
  setLauncherButton(button, iconKey, labelKey, shortcutKey) {
    if (!button) {
      return;
    }
    setTextIfChanged(button.querySelector('.launcher-icon'), t(iconKey));
    setTextIfChanged(button.querySelector('.launcher-text'), this.formatLauncherLabel(labelKey, shortcutKey));
  }

  updateInputHints() {
    this.setLauncherButton(
      this.elements.swapBtn,
      'hud.launcher.swap.icon',
      'hud.launcher.swap.label',
      'hud.launcher.swap.shortcut'
    );
    for (const { elementId, key } of PAUSE_INPUT_HINTS) {
      setTextIfChanged(document.getElementById(elementId), t(`${key}.${this.inputMode}`));
    }
  }

  init() {
    this.applyCanvasLayoutVariables();
    this.applyInputMode();
    this.buildPowerupButtons();
    this.bindEvents();
    this.updateSoundButton();
    this.updateContrastButton();
    this.updateMotionButton();
    this.updateLanguageButton();

    i18n.onChange(() => {
      this.updateInputHints();
      this.buildPowerupButtons();
      this.updateSoundButton();
      this.updateContrastButton();
      this.updateMotionButton();
      this.updateLanguageButton();
      this.refresh(this.engine, this.lastExtra);
    });
  }

  /** Exposes canvas geometry to CSS: overlays are placed relative to the danger line. */
  applyCanvasLayoutVariables() {
    const { logicalHeight, dangerLineY } = this.gameConfig.canvas;
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
    if (this.isDrawerOpen || !this.isDrawerLayout() || this.isAnyModalOpen()) {
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

    this.elements.btnShop.addEventListener('click', () => {
      this.openShopModal();
    });

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

    if (this.elements.btnDismissTutorial) {
      this.elements.btnDismissTutorial.addEventListener('click', () => {
        this.engine.dismissTutorial();
      });
    }

    if (this.elements.tabShopUpgrades && this.elements.tabShopAchievements) {
      const shopTabs = [
        { name: 'upgrades', el: this.elements.tabShopUpgrades },
        { name: 'achievements', el: this.elements.tabShopAchievements },
        ...(this.elements.tabShopCodex ? [{ name: 'codex', el: this.elements.tabShopCodex }] : [])
      ];

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

    this.elements.btnPlayEndlessModal.addEventListener('click', () => {
      this.requestDestructiveAction(() => {
        this.hideAllModals();
        this.engine.startEndlessMode();
      });
    });

    this.elements.btnNextLevel.addEventListener('click', () => {
      this.hideAllModals();
      const nextId = this.engine.currentLevelId + 1;
      const exists = this.levelsConfig.levels.some((l) => l.id === nextId);
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
        if (this.engine.state === GAME_STATES.PLAYING || this.engine.state === GAME_STATES.PAUSED) {
          this.engine.togglePause();
        }
        return;
      }

      if (this.isAnyModalOpen()) {
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
          ? this.gameConfig.canvas.keyboardAimFastStepRad
          : this.gameConfig.canvas.keyboardAimStepRad;
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
      this.elements.modalLevels,
      this.elements.modalShop,
      this.elements.modalVictory,
      this.elements.modalGameOver,
      this.elements.modalPause
    ].filter(Boolean);
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
  }

  switchShopTab(tabName) {
    if (tabName === 'achievements' || tabName === 'codex') {
      this.activeShopTab = tabName;
    } else {
      this.activeShopTab = 'upgrades';
    }
    const isUpgrades = this.activeShopTab === 'upgrades';
    const isAchievements = this.activeShopTab === 'achievements';
    const isCodex = this.activeShopTab === 'codex';

    if (this.elements.tabShopUpgrades) {
      this.elements.tabShopUpgrades.classList.toggle('active', isUpgrades);
      this.elements.tabShopUpgrades.setAttribute('aria-selected', String(isUpgrades));
      this.elements.tabShopUpgrades.tabIndex = isUpgrades ? 0 : -1;
    }
    if (this.elements.tabShopAchievements) {
      this.elements.tabShopAchievements.classList.toggle('active', isAchievements);
      this.elements.tabShopAchievements.setAttribute('aria-selected', String(isAchievements));
      this.elements.tabShopAchievements.tabIndex = isAchievements ? 0 : -1;
    }
    if (this.elements.tabShopCodex) {
      this.elements.tabShopCodex.classList.toggle('active', isCodex);
      this.elements.tabShopCodex.setAttribute('aria-selected', String(isCodex));
      this.elements.tabShopCodex.tabIndex = isCodex ? 0 : -1;
    }

    const upgradesContainer = this.elements.shopUpgradesPane || this.elements.shopGrid;
    if (upgradesContainer) {
      upgradesContainer.classList.toggle('hidden', !isUpgrades);
    }
    if (this.elements.achievementsGrid) {
      this.elements.achievementsGrid.classList.toggle('hidden', !isAchievements);
    }
    if (this.elements.codexPane) {
      this.elements.codexPane.classList.toggle('hidden', !isCodex);
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
      !this.elements.modalLevels.classList.contains('hidden') ||
      !this.elements.modalShop.classList.contains('hidden') ||
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
    return (
      !this.elements.modalLevels.classList.contains('hidden') ||
      !this.elements.modalShop.classList.contains('hidden') ||
      !this.elements.modalVictory.classList.contains('hidden') ||
      !this.elements.modalGameOver.classList.contains('hidden') ||
      !this.elements.modalPause.classList.contains('hidden') ||
      Boolean(this.elements.modalConfirm && !this.elements.modalConfirm.classList.contains('hidden'))
    );
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

  hideAllModals() {
    this.autoPausedByOverlay = false;
    this.elements.modalLevels.classList.add('hidden');
    this.elements.modalShop.classList.add('hidden');
    this.elements.modalVictory.classList.add('hidden');
    this.elements.modalGameOver.classList.add('hidden');
    this.elements.modalPause.classList.add('hidden');
    if (this.elements.modalConfirm) {
      this.elements.modalConfirm.classList.add('hidden');
    }
    this.syncModalInertState();
  }

  openShopModal() {
    this.saveLastFocusedElement();
    if (this.engine.state === GAME_STATES.PLAYING) {
      this.autoPausedByOverlay = true;
      this.engine.state = GAME_STATES.PAUSED;
    }
    this.renderShopContents();
    if (this.elements.codexPane) {
      this.buildCodexPane();
    }

    this.switchShopTab(this.activeShopTab);
    this.elements.modalShop.classList.remove('hidden');
    this.syncModalInertState();
    if (this.elements.btnCloseShop) {
      this.elements.btnCloseShop.focus();
    }
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

      const buyBtn = document.createElement('button');
      buyBtn.type = 'button';
      buyBtn.className = 'modal-btn primary';
      buyBtn.dataset.upgradeKey = upgradeKey;
      buyBtn.disabled = isMaxed || coins < cost;
      buyBtn.textContent = isMaxed
        ? t('modals.shop.card.maxed')
        : t('modals.shop.card.buy', { cost: formatNumber(cost) });

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

  openLevelsModal() {
    this.saveLastFocusedElement();
    if (this.engine.state === GAME_STATES.PLAYING) {
      this.autoPausedByOverlay = true;
      this.engine.state = GAME_STATES.PAUSED;
    }
    const unlocked = this.storageManager.getUnlockedLevel();
    const stats = this.storageManager.getLevelStats();
    const grid = this.elements.levelsGrid;
    grid.innerHTML = '';

    if (this.elements.levelsStarsSummary) {
      const totalStars = this.storageManager.getTotalStars();
      const maxCampaignStars = this.levelsConfig.levels.length * this.gameConfig.scoring.maxStars;
      this.elements.levelsStarsSummary.textContent = t('modals.levelSelect.starsTotal', {
        stars: totalStars,
        maxStars: maxCampaignStars
      });
    }

    for (const lvl of this.levelsConfig.levels) {
      const isUnlocked = lvl.id <= unlocked;
      const lvlStat = stats[lvl.id] || { bestScore: 0, stars: 0 };

      const card = document.createElement('div');
      card.className = `level-card ${isUnlocked ? 'unlocked' : 'locked'}`;

      const header = document.createElement('div');
      header.className = 'level-card-header';
      header.textContent = t('modals.levelSelect.card.levelNumber', { id: lvl.id });

      const title = document.createElement('div');
      title.className = 'level-card-title';
      title.textContent = t(lvl.nameKey);

      const desc = document.createElement('div');
      desc.className = 'level-card-desc';
      desc.textContent = t(lvl.descriptionKey);

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

    this.elements.modalLevels.classList.remove('hidden');
    this.syncModalInertState();
    if (this.elements.btnCloseLevels) {
      this.elements.btnCloseLevels.focus();
    }
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

    this.elements.btnLevels.classList.toggle('active-mode', engine.mode === GAME_MODES.CAMPAIGN);
    this.elements.btnEndless.classList.toggle('active-mode', engine.mode === GAME_MODES.ENDLESS);
    if (this.elements.btnDaily) {
      this.elements.btnDaily.classList.toggle('active-mode', engine.mode === GAME_MODES.DAILY);
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
    } else {
      bestScore = this.storageManager.getEndlessHighScore();
    }

    setTextIfChanged(this.elements.highScoreValue, formatNumber(Math.max(bestScore, engine.score)));

    if (this.elements.polarityBtn) {
      const polKey = engine.isPolarityFlipped
        ? 'hud.launcher.polarity.inverted'
        : 'hud.launcher.polarity.normal';
      this.setLauncherButton(this.elements.polarityBtn, 'hud.launcher.polarity.icon', polKey, 'hud.launcher.polarity.shortcut');
      this.elements.polarityBtn.classList.toggle('active', Boolean(engine.isPolarityFlipped));
    }

    const warningShotsThreshold = this.gameConfig.canvas.survivalWaveWarningThreshold;

    if (engine.mode === GAME_MODES.CAMPAIGN) {
      const lvl = this.levelsConfig.levels.find((l) => l.id === engine.currentLevelId);
      setTextIfChanged(
        this.elements.modeBanner,
        t('hud.stats.mode.campaign', {
          level: engine.currentLevelId,
          name: lvl ? t(lvl.nameKey) : ''
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
        const thresholds = lvl?.starThresholds || this.gameConfig.scoring.starThresholds;
        const maxStars = this.gameConfig.scoring.maxStars;
        const currentStars = engine.computeStars(engine.score);
        const starsStr = this.formatStars(currentStars, maxStars);
        const nextThreshold = thresholds.find((th) => th > engine.score);
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
      if (engine.activeTutorialKey && engine.state === GAME_STATES.PLAYING) {
        setTextIfChanged(this.elements.tutorialBannerText, t(engine.activeTutorialKey));
        this.elements.tutorialBanner.classList.remove('hidden');
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

    const buttons = this.elements.powerupsContainer.querySelectorAll('.powerup-btn');
    for (const btn of buttons) {
      const type = btn.dataset.specialType;
      const count = engine.specialInventory[type] || 0;
      const countEl = document.getElementById(`powerup-count-${type}`);
      setTextIfChanged(countEl, String(count));
      setAttributeIfChanged(btn, 'aria-label', this.getPowerupAriaLabel(type, count));
      const isEquipped = Boolean(engine.currentBall && engine.currentBall.specialType === type);
      btn.classList.toggle('equipped', isEquipped);
      setAttributeIfChanged(btn, 'aria-pressed', String(isEquipped));
      btn.disabled = count <= 0 && !isEquipped;
    }

    const transitionedState = this.prevEngineState !== engine.state;
    this.prevEngineState = engine.state;

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
      this.elements.modalLevels.classList.contains('hidden') &&
      this.elements.modalShop.classList.contains('hidden');
    const isVictoryJustRevealed = canRevealVictory && !this.isVictoryModalRevealed;
    if (engine.state !== GAME_STATES.VICTORY || canRevealVictory) {
      this.isVictoryModalRevealed = canRevealVictory;
    }

    if (canRevealVictory) {
      const summary = engine.victorySummary || extra;
      const stars = summary.stars || engine.computeStars(engine.score);
      const maxStars = this.gameConfig.scoring.maxStars;
      const scoreText = formatNumber(engine.score);
      setTextIfChanged(this.elements.victoryScore, t('modals.victory.stats.score', { score: scoreText }));
      setTextIfChanged(
        this.elements.victoryBonus,
        t('modals.victory.stats.shotsBonus', {
          bonus: formatNumber(summary.victoryBonus || 0),
          coins: formatNumber(summary.earnedCoins || 0)
        })
      );
      // Star glyphs are decorative; the sentence next to them carries the count.
      const starsGlyphs = document.createElement('span');
      starsGlyphs.setAttribute('aria-hidden', 'true');
      starsGlyphs.textContent = this.formatStars(stars, maxStars);
      const starsLabel = document.createElement('span');
      starsLabel.className = 'victory-stars-label';
      starsLabel.textContent = t('modals.victory.stats.stars', { stars, maxStars });
      this.elements.victoryStars.replaceChildren(starsGlyphs, starsLabel);
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
      const reasonKey = extra.gameOverReason === 'outOfShots'
        ? 'modals.gameOver.reason.outOfShots'
        : 'modals.gameOver.reason.lineCrossed';
      const scoreText = formatNumber(engine.score);
      setTextIfChanged(this.elements.gameOverReason, t(reasonKey));
      setTextIfChanged(this.elements.gameOverScore, t('modals.gameOver.stats.score', { score: scoreText }));
      setTextIfChanged(
        this.elements.gameOverBest,
        t('modals.gameOver.stats.highScore', {
          highScore: formatNumber(Math.max(bestScore, engine.score))
        })
      );
      if (transitionedState) {
        this.saveLastFocusedElement();
        this.announce(t('hud.announcer.round.gameOver', { reason: t(reasonKey), score: scoreText }));
      }
      this.elements.modalGameOver.classList.remove('hidden');
      if (transitionedState && this.elements.btnRetry) {
        this.elements.btnRetry.focus();
      }
    }

    this.syncDrawerStats();
    this.syncModalInertState();
  }
}

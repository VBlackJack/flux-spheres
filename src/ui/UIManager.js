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

import { GAME_MODES, GAME_STATES, SPECIAL_TYPES } from '../core/Constants.js';
import { i18n, t } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';

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
      scoreValue: document.getElementById('hud-score-value'),
      starProgress: document.getElementById('hud-star-progress'),
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
      modalConfirm: document.getElementById('modal-confirm'),
      btnConfirmYes: document.getElementById('btn-confirm-yes'),
      btnConfirmNo: document.getElementById('btn-confirm-no')
    };

    this.lastExtra = {};
    this.pendingConfirmCallback = null;
    this.activeShopTab = 'upgrades';
  }

  init() {
    this.buildPowerupButtons();
    this.bindEvents();
    this.updateSoundButton();
    this.updateContrastButton();
    this.updateMotionButton();
    this.updateLanguageButton();

    i18n.onChange(() => {
      this.buildPowerupButtons();
      this.updateSoundButton();
      this.updateContrastButton();
      this.updateMotionButton();
      this.updateLanguageButton();
      this.refresh(this.engine, this.lastExtra);
    });
  }

  buildPowerupButtons() {
    const container = this.elements.powerupsContainer;
    container.innerHTML = '';

    const specialOrder = [
      SPECIAL_TYPES.BOMB,
      SPECIAL_TYPES.LIGHTNING,
      SPECIAL_TYPES.RAINBOW,
      SPECIAL_TYPES.ANVIL,
      SPECIAL_TYPES.FREEZE
    ];

    for (const type of specialOrder) {
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

      const labelSpan = document.createElement('span');
      labelSpan.className = 'powerup-name';
      labelSpan.textContent = t(`hud.powerups.${type}.name`);

      const countSpan = document.createElement('span');
      countSpan.className = 'powerup-count';
      countSpan.id = `powerup-count-${type}`;
      countSpan.textContent = String(this.engine.specialInventory[type] || 0);

      btn.append(iconSpan, labelSpan, countSpan);
      btn.addEventListener('click', () => {
        this.engine.equipSpecialBall(type);
      });

      container.appendChild(btn);
    }
  }

  bindEvents() {
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
      this.engine.togglePause();
    });

    this.elements.btnSound.addEventListener('click', () => {
      const nextMuted = !this.audioManager.isMuted();
      this.audioManager.setMuted(nextMuted);
      this.storageManager.setMuted(nextMuted);
      this.updateSoundButton();
    });

    if (this.elements.btnContrast) {
      this.elements.btnContrast.addEventListener('click', () => {
        const nextContrast = !this.storageManager.getHighContrast();
        this.storageManager.setHighContrast(nextContrast);
        if (this.renderer) {
          this.renderer.setHighContrast(nextContrast);
        }
        this.updateContrastButton();
      });
    }

    if (this.elements.btnMotion) {
      this.elements.btnMotion.addEventListener('click', () => {
        const nextReduced = !this.storageManager.getReducedMotion();
        this.storageManager.setReducedMotion(nextReduced);
        if (this.engine && typeof this.engine.setReducedMotion === 'function') {
          this.engine.setReducedMotion(nextReduced);
        }
        this.updateMotionButton();
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.engine.state === GAME_STATES.PLAYING) {
        this.engine.togglePause();
      }
    });

    this.elements.btnLang.addEventListener('click', () => {
      const supported = this.gameConfig.defaults.supportedLanguages;
      const current = i18n.getLocale();
      const nextIdx = (supported.indexOf(current) + 1) % supported.length;
      const nextLang = supported[nextIdx];
      i18n.setLocale(nextLang);
      this.storageManager.setLanguage(nextLang);
    });

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
      this.elements.tabShopUpgrades.addEventListener('click', () => {
        this.switchShopTab('upgrades');
      });
      this.elements.tabShopAchievements.addEventListener('click', () => {
        this.switchShopTab('achievements');
      });
      if (this.elements.tabShopCodex) {
        this.elements.tabShopCodex.addEventListener('click', () => {
          this.switchShopTab('codex');
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
      this.hideAllModals();
      this.engine.startEndlessMode();
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
      this.hideAllModals();
      this.engine.restartCurrent();
    });

    const specialOrder = [
      SPECIAL_TYPES.BOMB,
      SPECIAL_TYPES.LIGHTNING,
      SPECIAL_TYPES.RAINBOW,
      SPECIAL_TYPES.ANVIL,
      SPECIAL_TYPES.FREEZE
    ];

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
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

      if (e.code === 'Space') {
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
        e.preventDefault();
        this.engine.shoot();
        this.updateAimState(this.engine);
      } else if (e.code.startsWith('Digit')) {
        const idx = Number.parseInt(e.code.replace('Digit', ''), 10) - 1;
        if (idx >= 0 && idx < specialOrder.length) {
          e.preventDefault();
          this.engine.equipSpecialBall(specialOrder[idx]);
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
    this.elements.modalConfirm.classList.remove('hidden');
    if (this.elements.btnConfirmNo) {
      this.elements.btnConfirmNo.focus();
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
    }
    if (this.elements.tabShopAchievements) {
      this.elements.tabShopAchievements.classList.toggle('active', isAchievements);
      this.elements.tabShopAchievements.setAttribute('aria-selected', String(isAchievements));
    }
    if (this.elements.tabShopCodex) {
      this.elements.tabShopCodex.classList.toggle('active', isCodex);
      this.elements.tabShopCodex.setAttribute('aria-selected', String(isCodex));
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
    if (this.engine.state === GAME_STATES.VICTORY) {
      this.elements.modalVictory.classList.remove('hidden');
    } else if (this.engine.state === GAME_STATES.GAME_OVER) {
      this.elements.modalGameOver.classList.remove('hidden');
    } else if (this.engine.state === GAME_STATES.PAUSED) {
      this.elements.modalPause.classList.remove('hidden');
    }
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

  updateSoundButton() {
    const isMuted = this.audioManager.isMuted();
    const label = t(isMuted ? 'app.nav.button.soundOff' : 'app.nav.button.soundOn');
    const aria = t(isMuted ? 'app.nav.button.soundOffAria' : 'app.nav.button.soundOnAria');
    this.elements.btnSound.textContent = label;
    this.elements.btnSound.setAttribute('aria-label', aria);
    this.elements.btnSound.title = aria;
  }

  updateContrastButton() {
    if (!this.elements.btnContrast) {
      return;
    }
    const isHigh = this.storageManager.getHighContrast();
    const label = t(isHigh ? 'app.nav.button.contrastOn' : 'app.nav.button.contrastOff');
    const aria = t(isHigh ? 'app.nav.button.contrastOnAria' : 'app.nav.button.contrastOffAria');
    this.elements.btnContrast.textContent = label;
    this.elements.btnContrast.setAttribute('aria-label', aria);
    this.elements.btnContrast.title = aria;
  }

  updateMotionButton() {
    if (!this.elements.btnMotion) {
      return;
    }
    const isReduced = this.storageManager.getReducedMotion();
    const label = t(isReduced ? 'app.nav.button.motionReduced' : 'app.nav.button.motionOn');
    const aria = t(isReduced ? 'app.nav.button.motionReducedAria' : 'app.nav.button.motionOnAria');
    this.elements.btnMotion.textContent = label;
    this.elements.btnMotion.setAttribute('aria-label', aria);
    this.elements.btnMotion.title = aria;
  }

  updateAimState(engine) {
    if (this.elements.cancelAimBanner) {
      this.elements.cancelAimBanner.classList.toggle('hidden', !engine.isAimCancelled);
    }
  }

  updateLanguageButton() {
    const label = t('app.nav.button.language');
    this.elements.btnLang.textContent = label;
    this.elements.btnLang.setAttribute('aria-label', label);
    if (this.elements.btnDismissTutorial) {
      const dismissLabel = t('hud.tutorial.dismiss');
      this.elements.btnDismissTutorial.setAttribute('aria-label', dismissLabel);
      this.elements.btnDismissTutorial.title = dismissLabel;
    }
  }

  hideAllModals() {
    this.elements.modalLevels.classList.add('hidden');
    this.elements.modalShop.classList.add('hidden');
    this.elements.modalVictory.classList.add('hidden');
    this.elements.modalGameOver.classList.add('hidden');
    this.elements.modalPause.classList.add('hidden');
    if (this.elements.modalConfirm) {
      this.elements.modalConfirm.classList.add('hidden');
    }
  }

  openShopModal() {
    const coins = this.storageManager.getCoins();
    this.elements.shopBalance.textContent = t('modals.shop.balance.label', { coins });
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
      buyBtn.disabled = isMaxed || coins < cost;
      buyBtn.textContent = isMaxed
        ? t('modals.shop.card.maxed')
        : t('modals.shop.card.buy', { cost });

      buyBtn.addEventListener('click', () => {
        if (this.storageManager.purchaseUpgrade(upgradeKey)) {
          this.audioManager.playEffect('match', currentLevel + 1);
          this.engine.updateAimFromAngle(this.engine.aimAngle);
          this.openShopModal();
          this.refresh(this.engine, this.lastExtra);
        }
      });

      card.append(header, title, desc, buyBtn);
      grid.appendChild(card);
    }

    if (this.elements.shopAmmoGrid && this.gameConfig.specialShopCosts) {
      const ammoGrid = this.elements.shopAmmoGrid;
      ammoGrid.innerHTML = '';
      const specialOrder = [
        SPECIAL_TYPES.BOMB,
        SPECIAL_TYPES.LIGHTNING,
        SPECIAL_TYPES.RAINBOW,
        SPECIAL_TYPES.ANVIL,
        SPECIAL_TYPES.FREEZE
      ];
      for (const type of specialOrder) {
        const spec = this.ballsConfig.specialTypes[type];
        const cost = this.gameConfig.specialShopCosts[type] || 25;
        const count = this.engine.specialInventory[type] || 0;

        const card = document.createElement('div');
        card.className = 'ammo-card';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'powerup-icon';
        iconSpan.style.background = `radial-gradient(circle at 30% 30%, ${spec.highlight}, ${spec.fill})`;
        iconSpan.textContent = spec.icon;

        const titleEl = document.createElement('div');
        titleEl.className = 'ammo-card-title';
        titleEl.textContent = t(`hud.powerups.${type}.name`);

        const stockEl = document.createElement('div');
        stockEl.className = 'ammo-card-stock';
        stockEl.textContent = t('modals.shop.specialAmmo.stock', { count });

        const buyAmmoBtn = document.createElement('button');
        buyAmmoBtn.type = 'button';
        buyAmmoBtn.className = 'modal-btn primary ammo-buy-btn';
        buyAmmoBtn.disabled = coins < cost;
        buyAmmoBtn.textContent = t('modals.shop.specialAmmo.buy', { cost });

        buyAmmoBtn.addEventListener('click', () => {
          if (this.engine.buySpecialAmmo(type)) {
            this.openShopModal();
          }
        });

        card.append(iconSpan, titleEl, stockEl, buyAmmoBtn);
        ammoGrid.appendChild(card);
      }
    }

    if (this.elements.codexPane) {
      this.buildCodexPane();
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

    this.switchShopTab(this.activeShopTab);
    this.elements.modalShop.classList.remove('hidden');
    if (this.elements.btnCloseShop) {
      this.elements.btnCloseShop.focus();
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
    const obstacleKeys = ['pivot', 'bumper', 'repulsor', 'attractor', 'barrier', 'portal', 'singularity'];
    for (const obsKey of obstacleKeys) {
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
        const starsText = this.formatStars(lvlStat.stars, this.gameConfig.scoring.maxStars);
        const starsEl = document.createElement('span');
        starsEl.className = 'level-stars';
        starsEl.textContent = starsText;

        const scoreEl = document.createElement('span');
        scoreEl.className = 'level-best';
        scoreEl.textContent = t('modals.levelSelect.card.bestScore', { score: lvlStat.bestScore });

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
        lockEl.textContent = t('modals.levelSelect.card.locked');
        footer.appendChild(lockEl);
      }

      card.append(header, title, desc, footer);
      grid.appendChild(card);
    }

    this.elements.modalLevels.classList.remove('hidden');
    if (this.elements.btnCloseLevels) {
      this.elements.btnCloseLevels.focus();
    }
  }

  refresh(engine, extra = {}) {
    this.lastExtra = extra;
    this.elements.scoreValue.textContent = String(engine.score);
    this.elements.coinsValue.textContent = t('hud.stats.coins.value', {
      coins: this.storageManager.getCoins()
    });

    const affordableCount = this.getAffordableUpgradeCount();
    this.elements.btnShop.textContent = affordableCount > 0
      ? t('app.nav.button.shopBadge', { count: affordableCount })
      : t('app.nav.button.shop');
    this.elements.btnShop.classList.toggle('has-affordable', affordableCount > 0);

    this.elements.btnLevels.classList.toggle('active-mode', engine.mode === GAME_MODES.CAMPAIGN);
    this.elements.btnEndless.classList.toggle('active-mode', engine.mode === GAME_MODES.ENDLESS);
    if (this.elements.btnDaily) {
      this.elements.btnDaily.classList.toggle('active-mode', engine.mode === GAME_MODES.DAILY);
      const todayKey = SeededRandom.getTodayDateKey();
      const dailyBonusCoins = this.gameConfig.daily?.firstPlayBonusCoins || 0;
      const canClaimDaily = dailyBonusCoins > 0 && !this.storageManager.hasPlayedDailyToday(todayKey);
      this.elements.btnDaily.textContent = canClaimDaily
        ? t('app.nav.button.dailyBonusBadge', { coins: dailyBonusCoins })
        : t('app.nav.button.daily');
    }

    const overchargePct = Math.min(
      100,
      Math.round((engine.overcharge / this.gameConfig.scoring.overchargeMax) * 100)
    );
    this.elements.overchargePct.textContent = t('hud.stats.overcharge.pct', { pct: overchargePct });
    this.elements.overchargeFill.style.width = `${overchargePct}%`;

    let bestScore = 0;
    if (engine.mode === GAME_MODES.CAMPAIGN) {
      bestScore = this.storageManager.getLevelStats()[engine.currentLevelId]?.bestScore || 0;
    } else if (engine.mode === GAME_MODES.DAILY) {
      bestScore = this.storageManager.getDailyHighScore();
    } else {
      bestScore = this.storageManager.getEndlessHighScore();
    }

    this.elements.highScoreValue.textContent = String(Math.max(bestScore, engine.score));

    if (this.elements.polarityBtn) {
      const polKey = engine.isPolarityFlipped
        ? 'hud.launcher.polarity.inverted'
        : 'hud.launcher.polarity.normal';
      this.elements.polarityBtn.textContent = t(polKey);
      this.elements.polarityBtn.classList.toggle('active', Boolean(engine.isPolarityFlipped));
    }

    if (engine.mode === GAME_MODES.CAMPAIGN) {
      const lvl = this.levelsConfig.levels.find((l) => l.id === engine.currentLevelId);
      this.elements.modeBanner.textContent = t('hud.stats.mode.campaign', {
        level: engine.currentLevelId,
        name: lvl ? t(lvl.nameKey) : ''
      });
      if (this.elements.shotsLabel) {
        this.elements.shotsLabel.textContent = t('hud.stats.shots.label');
      }
      this.elements.shotsValue.textContent = String(engine.shotsRemaining);
      this.elements.shotsValue.classList.toggle(
        'warning',
        engine.shotsRemaining <= (this.gameConfig.canvas.survivalWaveWarningThreshold || 2)
      );

      if (this.elements.starProgress) {
        const thresholds = lvl?.starThresholds || this.gameConfig.scoring.starThresholds;
        const maxStars = this.gameConfig.scoring.maxStars;
        const currentStars = engine.computeStars(engine.score);
        const starsStr = this.formatStars(currentStars, maxStars);
        const nextThreshold = thresholds.find((th) => th > engine.score);
        this.elements.starProgress.textContent = nextThreshold !== undefined
          ? t('hud.stats.score.starProgress', { stars: starsStr, next: nextThreshold })
          : t('hud.stats.score.starMax', { stars: starsStr });
        this.elements.starProgress.classList.remove('hidden');
      }
    } else {
      if (engine.mode === GAME_MODES.DAILY) {
        const mutatorLabel = engine.activeMutatorKey
          ? t(`gameplay.mutators.${engine.activeMutatorKey}`)
          : '';
        this.elements.modeBanner.textContent = t('hud.stats.mode.daily', {
          mutator: mutatorLabel,
          wave: engine.waveCount
        });
      } else {
        this.elements.modeBanner.textContent = t('hud.stats.mode.endless', {
          wave: engine.waveCount
        });
      }
      if (this.elements.shotsLabel) {
        this.elements.shotsLabel.textContent = t('hud.stats.shots.waveLabel');
      }
      this.elements.shotsValue.textContent = String(engine.shotsUntilWave);
      this.elements.shotsValue.classList.toggle(
        'warning',
        engine.shotsUntilWave <= (this.gameConfig.canvas.survivalWaveWarningThreshold || 2)
      );
      if (this.elements.starProgress) {
        this.elements.starProgress.classList.add('hidden');
      }
    }

    if (engine.combo > 1) {
      this.elements.comboBadge.textContent = t('hud.stats.combo.label', { count: engine.combo });
      this.elements.comboBadge.classList.remove('hidden');
    } else {
      this.elements.comboBadge.classList.add('hidden');
    }

    if (engine.freezeTurnsRemaining > 0) {
      this.elements.frozenBadge.textContent = t('hud.stats.frozen.label', { turns: engine.freezeTurnsRemaining });
      this.elements.frozenBadge.classList.remove('hidden');
    } else {
      this.elements.frozenBadge.classList.add('hidden');
    }

    if (this.elements.tutorialBanner) {
      if (engine.activeTutorialKey && engine.state === GAME_STATES.PLAYING) {
        if (this.elements.tutorialBannerText) {
          this.elements.tutorialBannerText.textContent = t(engine.activeTutorialKey);
        }
        this.elements.tutorialBanner.classList.remove('hidden');
      } else {
        this.elements.tutorialBanner.classList.add('hidden');
      }
    }

    if (this.elements.specialEquippedBanner) {
      const equippedType = engine.currentBall?.specialType;
      if (equippedType && engine.state === GAME_STATES.PLAYING) {
        const spec = this.ballsConfig.specialTypes[equippedType];
        this.elements.specialEquippedBanner.textContent = t('hud.launcher.specialEquipped.hint', {
          icon: spec?.icon || '',
          name: t(`hud.powerups.${equippedType}.name`),
          desc: t(`hud.powerups.${equippedType}.tooltip`)
        });
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
      if (countEl) {
        countEl.textContent = String(count);
      }
      const isEquipped = engine.currentBall && engine.currentBall.specialType === type;
      btn.classList.toggle('equipped', Boolean(isEquipped));
      btn.disabled = count <= 0 && !isEquipped;
    }

    if (engine.state === GAME_STATES.PAUSED) {
      if (this.elements.pauseLevelTip) {
        if (engine.levelTutorialKey) {
          this.elements.pauseLevelTip.textContent = t('modals.pause.levelTip', {
            tip: t(engine.levelTutorialKey)
          });
          this.elements.pauseLevelTip.classList.remove('hidden');
        } else {
          this.elements.pauseLevelTip.classList.add('hidden');
        }
      }
      this.elements.modalPause.classList.remove('hidden');
    } else {
      this.elements.modalPause.classList.add('hidden');
    }

    if (engine.state === GAME_STATES.VICTORY) {
      const stars = extra.stars || engine.computeStars(engine.score);
      const maxStars = this.gameConfig.scoring.maxStars;
      this.elements.victoryScore.textContent = t('modals.victory.stats.score', { score: engine.score });
      this.elements.victoryBonus.textContent = t('modals.victory.stats.shotsBonus', {
        bonus: extra.victoryBonus || 0,
        coins: extra.earnedCoins || 0
      });
      this.elements.victoryStars.textContent =
        `${this.formatStars(stars, maxStars)}  ${t('modals.victory.stats.stars', { stars, maxStars })}`;
      this.elements.modalVictory.classList.remove('hidden');
    }

    if (engine.state === GAME_STATES.GAME_OVER) {
      const reasonKey = extra.gameOverReason === 'outOfShots'
        ? 'modals.gameOver.reason.outOfShots'
        : 'modals.gameOver.reason.lineCrossed';
      this.elements.gameOverReason.textContent = t(reasonKey);
      this.elements.gameOverScore.textContent = t('modals.gameOver.stats.score', { score: engine.score });
      this.elements.gameOverBest.textContent = t('modals.gameOver.stats.highScore', {
        highScore: Math.max(bestScore, engine.score)
      });
      this.elements.modalGameOver.classList.remove('hidden');
    }
  }
}

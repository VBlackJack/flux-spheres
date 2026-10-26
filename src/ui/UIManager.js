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
      highScoreValue: document.getElementById('hud-best-value'),
      coinsValue: document.getElementById('hud-coins-value'),
      overchargePct: document.getElementById('hud-overcharge-pct'),
      overchargeFill: document.getElementById('hud-overcharge-fill'),
      modeBanner: document.getElementById('hud-mode-banner'),
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
      btnLang: document.getElementById('btn-lang'),
      swapBtn: document.getElementById('btn-swap-ball'),
      polarityBtn: document.getElementById('btn-polarity'),
      tutorialBanner: document.getElementById('tutorial-banner'),
      cancelAimBanner: document.getElementById('cancel-aim-banner'),
      modalLevels: document.getElementById('modal-levels'),
      levelsStarsSummary: document.getElementById('levels-stars-summary'),
      levelsGrid: document.getElementById('levels-grid'),
      btnCloseLevels: document.getElementById('btn-close-levels'),
      btnPlayEndlessModal: document.getElementById('btn-play-endless-modal'),
      modalShop: document.getElementById('modal-shop'),
      shopBalance: document.getElementById('shop-balance'),
      shopGrid: document.getElementById('shop-grid'),
      achievementsGrid: document.getElementById('achievements-grid'),
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
      btnResume: document.getElementById('btn-resume'),
      btnRestartPause: document.getElementById('btn-restart-pause')
    };

    this.lastExtra = {};
  }

  init() {
    this.buildPowerupButtons();
    this.bindEvents();
    this.updateSoundButton();
    this.updateContrastButton();
    this.updateLanguageButton();

    i18n.onChange(() => {
      this.buildPowerupButtons();
      this.updateSoundButton();
      this.updateContrastButton();
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
      this.hideAllModals();
      this.engine.startEndlessMode();
    });

    if (this.elements.btnDaily) {
      this.elements.btnDaily.addEventListener('click', () => {
        this.hideAllModals();
        this.engine.startDailyChallenge();
      });
    }

    this.elements.btnShop.addEventListener('click', () => {
      this.openShopModal();
    });

    this.elements.btnRestart.addEventListener('click', () => {
      this.hideAllModals();
      this.engine.restartCurrent();
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
      !this.elements.modalPause.classList.contains('hidden')
    );
  }

  formatStars(stars, maxStars) {
    const theme = this.gameConfig.theme;
    const filled = Math.max(0, Math.min(maxStars, stars));
    return theme.starFilledSymbol.repeat(filled) + theme.starEmptySymbol.repeat(maxStars - filled);
  }

  updateSoundButton() {
    const key = this.audioManager.isMuted() ? 'app.nav.button.soundOff' : 'app.nav.button.soundOn';
    const label = t(key);
    this.elements.btnSound.textContent = label;
    this.elements.btnSound.setAttribute('aria-label', label);
  }

  updateContrastButton() {
    if (!this.elements.btnContrast) {
      return;
    }
    const key = this.storageManager.getHighContrast()
      ? 'app.nav.button.contrastOn'
      : 'app.nav.button.contrastOff';
    const label = t(key);
    this.elements.btnContrast.textContent = label;
    this.elements.btnContrast.setAttribute('aria-label', label);
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
  }

  hideAllModals() {
    this.elements.modalLevels.classList.add('hidden');
    this.elements.modalShop.classList.add('hidden');
    this.elements.modalVictory.classList.add('hidden');
    this.elements.modalGameOver.classList.add('hidden');
    this.elements.modalPause.classList.add('hidden');
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

    if (this.elements.achievementsGrid && this.gameConfig.achievements) {
      const achGrid = this.elements.achievementsGrid;
      achGrid.innerHTML = '';
      const unlockedMap = this.storageManager.getUnlockedAchievements();
      for (const [achId, achSpec] of Object.entries(this.gameConfig.achievements)) {
        const isUnlocked = Boolean(unlockedMap[achId]);
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
    }

    this.elements.modalShop.classList.remove('hidden');
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
          this.hideAllModals();
          this.engine.startCampaignLevel(lvl.id);
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
  }

  refresh(engine, extra = {}) {
    this.lastExtra = extra;
    this.elements.scoreValue.textContent = String(engine.score);
    this.elements.coinsValue.textContent = t('hud.stats.coins.value', {
      coins: this.storageManager.getCoins()
    });

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
      this.elements.shotsValue.textContent = String(engine.shotsRemaining);
    } else if (engine.mode === GAME_MODES.DAILY) {
      const mutatorLabel = engine.activeMutatorKey
        ? t(`gameplay.mutators.${engine.activeMutatorKey}`)
        : '';
      this.elements.modeBanner.textContent = t('hud.stats.mode.daily', {
        mutator: mutatorLabel,
        wave: engine.waveCount
      });
      this.elements.shotsValue.textContent = t('hud.stats.shots.infinite');
    } else {
      this.elements.modeBanner.textContent = t('hud.stats.mode.endless', {
        wave: engine.waveCount
      });
      this.elements.shotsValue.textContent = t('hud.stats.shots.infinite');
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
        this.elements.tutorialBanner.textContent = t(engine.activeTutorialKey);
        this.elements.tutorialBanner.classList.remove('hidden');
      } else {
        this.elements.tutorialBanner.classList.add('hidden');
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

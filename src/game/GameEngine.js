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
  OBSTACLE_TYPES,
  SPECIAL_TYPES,
  CLUSTER_MODIFIERS,
  DAILY_MUTATORS,
  GAME_OVER_REASONS,
  MATH_CONSTANTS,
  BOARD_MECHANICS
} from '../core/Constants.js';
import { t } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { Ball } from '../entities/Ball.js';
import { Obstacle } from '../entities/Obstacle.js';
import { ParticleSystem } from '../entities/ParticleSystem.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { SpecialBallController } from './SpecialBallController.js';
import { captureRunSnapshot, isValidRunSnapshot, applyRunSnapshot, isRunSnapshotable } from './RunSnapshot.js';
import { generateLayout, NO_PIVOT_SLOT } from './layouts/LayoutGenerators.js';
import { generateFluxStage } from './layouts/FluxStageGenerator.js';
import { shiftObstacleDefsX, shiftSpecX } from '../core/WorldGeometry.js';
import {
  listBoardMechanics,
  listLevelMechanics,
  listMechanicsSharingHint,
  pickNextDiscovery
} from './Discovery.js';

export class GameEngine {
  constructor({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    fluxConfig = null,
    audioManager,
    storageManager,
    onStateChange
  }) {
    this.gameConfig = gameConfig;
    this.physicsConfig = physicsConfig;
    this.ballsConfig = ballsConfig;
    this.obstaclesConfig = obstaclesConfig;
    this.levelsConfig = levelsConfig;
    this.fluxConfig = fluxConfig;
    this.audioManager = audioManager;
    this.storageManager = storageManager;
    this.onStateChange = onStateChange;

    this.physicsWorld = new PhysicsWorld(physicsConfig, gameConfig, ballsConfig);
    // Daily runs draw avalanche drift from the seeded stream so scores stay reproducible
    this.physicsWorld.setRandomSource(() => this.random());
    this.particleSystem = new ParticleSystem(gameConfig.juice);
    this.isReducedMotion = false;
    if (this.storageManager && typeof this.storageManager.getReducedMotion === 'function') {
      this.setReducedMotion(this.storageManager.getReducedMotion());
    }
    this.specialController = new SpecialBallController(ballsConfig, gameConfig);

    this.mode = GAME_MODES.CAMPAIGN;
    this.state = GAME_STATES.READY;
    this.currentLevelId = 1;
    this.score = 0;
    this.combo = 0;
    this.overcharge = 0;
    this.shotsRemaining = 0;
    this.waveCount = 1;
    this.endlessRowParity = 0;
    this.shotsUntilWave = 0;
    this.freezeTurnsRemaining = 0;
    this.chainCooldown = 0;
    this.pendingRunCoins = 0;
    this.anvilCrushCount = 0;
    this.isCoreFreezeApplied = false;
    this.outOfShotsGraceFrames = 0;
    this.victoryCelebrationFrames = 0;
    this.victorySummary = null;
    this.hitStopFrames = 0;
    this.impactWave = null;
    this.trailFrameCounter = 0;
    this.hasFiredInRound = false;
    this.bossesDestroyedInRun = 0;
    this.activeDiscoveryId = null;
    this.discoveryTurnCount = 0;
    this.levelTutorialKey = null;
    this.isAimCancelled = false;
    this.isAimLocked = false;
    this.aimLockOrigin = null;
    this.isPolarityFlipped = false;
    this.activeMutatorKey = null;
    this.dailySeedKey = null;
    this.seededRng = null;
    this.fluxSeed = null;
    this.fluxStage = 0;
    this.fluxFamily = null;
    this.fluxPreviousFamily = null;
    this.fluxShapeIds = [];
    this.fluxIsBossStage = false;
    this.stageTransitionFrames = 0;
    this.stageIntroFrames = 0;

    this.activePalette = [];
    this.specialInventory = {};
    this.currentBall = null;
    this.stashedRegularColorId = null;
    this.nextBall = null;
    this.aimAngle = -Math.PI * MATH_CONSTANTS.HALF;
    this.aimPoints = [];
    // Colors of the balls queued after nextBall, shown beside the launcher.
    this.upcomingColorIds = [];
    this.levelStartBallCount = 0;
    this.isAimPreviewStale = false;
    this.laserBonuses = { distanceBonus: 0, bouncesBonus: 0 };
    this.stepCallbacks = null;
    this.isRestoringRun = false;
    this.seedDiscoveriesFromProgress();
  }

  random() {
    return this.seededRng ? this.seededRng.next() : Math.random();
  }

  isSurvivalMode() {
    return this.mode === GAME_MODES.ENDLESS || this.mode === GAME_MODES.DAILY;
  }

  /** True for modes where every shot spends a limited reserve (Campaign and Flux). */
  usesShotBudget() {
    return this.mode === GAME_MODES.CAMPAIGN || this.mode === GAME_MODES.FLUX;
  }

  /**
   * True while a cleared Flux shape gives way to the next one: the outgoing balls fall,
   * then the new shape slides in. Shooting waits until the new shape is in place.
   */
  isStageChanging() {
    return this.stageTransitionFrames > 0 || this.stageIntroFrames > 0;
  }

  /**
   * Progress of the incoming Flux shape's entrance, from 0 (just spawned) to 1 (in place).
   */
  getStageIntroProgress() {
    const introFrames = this.fluxConfig?.transition.introFrames || 0;
    if (this.stageIntroFrames <= 0 || introFrames <= 0) {
      return 1;
    }
    return 1 - this.stageIntroFrames / introFrames;
  }

  /**
   * Simulation speed factor read by the game loop. Time slows down while a shot flies
   * close to one of the last few spheres of a shot-limited board, so the deciding hit
   * can be watched; reduced motion keeps normal speed.
   * @returns {number} 1 for normal speed, below 1 for slow motion.
   */
  getTimeScale() {
    const slowMotion = this.gameConfig.juice.slowMotion;
    const projectile = this.physicsWorld.projectile;
    if (this.isReducedMotion || !projectile || !this.usesShotBudget() || this.state !== GAME_STATES.PLAYING) {
      return 1;
    }
    const balls = this.physicsWorld.balls;
    if (balls.length === 0 || balls.length > slowMotion.maxRemainingBalls) {
      return 1;
    }
    const isNearTarget = balls.some(
      (b) => Math.hypot(b.x - projectile.x, b.y - projectile.y) <= slowMotion.triggerDistance
    );
    return isNearTarget ? slowMotion.timeScale : 1;
  }

  /**
   * True only while a run is being played; every score, coin and state transition
   * is gated on it so that a finished run can never be resolved or rewarded twice.
   */
  isRunPlaying() {
    return this.state === GAME_STATES.PLAYING;
  }

  /**
   * True during the short pause after a campaign victory in which the last matches,
   * falling balls and particles keep animating before the victory modal is shown.
   */
  isVictoryCelebrating() {
    return this.state === GAME_STATES.VICTORY && this.victoryCelebrationFrames > 0;
  }

  /**
   * Persists the current survival run score as a high score when it beats the stored one.
   * Called when a run ends or is left, never on every score event.
   */
  persistRunHighScore() {
    if (this.mode === GAME_MODES.ENDLESS) {
      this.storageManager.setEndlessHighScore(this.score);
    } else if (this.mode === GAME_MODES.DAILY) {
      this.storageManager.setDailyHighScore(this.score, this.dailySeedKey);
    } else if (this.mode === GAME_MODES.FLUX) {
      this.storageManager.setFluxRecord(this.score, this.fluxStage);
    }
  }

  /**
   * Stores the run so it survives a reload or the tab being discarded. Only runs with at
   * least one shot are kept, and only between shots (see isRunSnapshotable): a run that
   * cannot be captured right now keeps its last stored snapshot.
   */
  saveRunSnapshot() {
    if (!this.hasFiredInRound) {
      return;
    }
    const snapshot = captureRunSnapshot(this, this.storageManager.getRunSnapshotVersion());
    if (snapshot) {
      this.storageManager.saveRunSnapshot(snapshot);
      this.flushPendingRunCoins();
    }
  }

  /**
   * Pays coins earned in the run. Coins earned while the run cannot be captured (a shot
   * in flight, a Flux shape being replaced) are held until the next snapshot: the stored
   * run still predates them, so a reload at that moment would replay the shot and pay
   * them a second time.
   * @param {number} amount - Coins to pay.
   */
  awardRunCoins(amount) {
    if (amount <= 0) {
      return;
    }
    if (isRunSnapshotable(this)) {
      this.storageManager.addCoins(amount);
    } else {
      this.pendingRunCoins += amount;
    }
  }

  /** Writes the coins held by awardRunCoins once the run they belong to is settled. */
  flushPendingRunCoins() {
    if (this.pendingRunCoins > 0) {
      this.storageManager.addCoins(this.pendingRunCoins);
    }
    this.pendingRunCoins = 0;
  }

  /**
   * Resumes the stored run, paused, in place of the current one.
   * @returns {boolean} True when a stored run was restored; false when there was none or it
   *   was unusable, in which case it is discarded and the caller starts a run normally.
   */
  restoreSavedRun() {
    const snapshot = this.storageManager.loadRunSnapshot();
    if (!snapshot) {
      return false;
    }
    if (!isValidRunSnapshot(snapshot, this.storageManager.getRunSnapshotVersion())) {
      this.storageManager.clearRunSnapshot();
      return false;
    }
    let isRestored = false;
    this.isRestoringRun = true;
    try {
      isRestored = applyRunSnapshot(this, snapshot);
    } catch (err) {
      console.error('Saved run could not be restored:', err);
    } finally {
      this.isRestoringRun = false;
    }
    if (!isRestored) {
      this.storageManager.clearRunSnapshot();
      return false;
    }
    this.refreshDiscovery();
    this.saveRunSnapshot();
    this.notifyUI();
    return true;
  }

  /**
   * Saves the outgoing run's high score, then resets every per-run counter shared by all modes.
   * @param {string} mode - Game mode of the run being started.
   */
  resetRunState(mode) {
    this.persistRunHighScore();
    this.flushPendingRunCoins();
    this.storageManager.clearRunSnapshot();
    this.mode = mode;
    this.score = 0;
    this.combo = 0;
    this.overcharge = 0;
    this.freezeTurnsRemaining = 0;
    this.chainCooldown = 0;
    this.pendingRunCoins = 0;
    this.anvilCrushCount = 0;
    this.isCoreFreezeApplied = false;
    this.outOfShotsGraceFrames = 0;
    this.victoryCelebrationFrames = 0;
    this.victorySummary = null;
    this.hitStopFrames = 0;
    this.impactWave = null;
    this.hasFiredInRound = false;
    this.bossesDestroyedInRun = 0;
    this.activeDiscoveryId = null;
    this.discoveryTurnCount = 0;
    this.levelTutorialKey = null;
    this.isAimCancelled = false;
    this.isAimLocked = false;
    this.aimLockOrigin = null;
    this.isPolarityFlipped = false;
    this.activeMutatorKey = null;
    this.dailySeedKey = null;
    this.seededRng = null;
    this.stashedRegularColorId = null;
    this.fluxSeed = null;
    this.fluxStage = 0;
    this.fluxFamily = null;
    this.fluxPreviousFamily = null;
    this.fluxShapeIds = [];
    this.fluxIsBossStage = false;
    this.stageTransitionFrames = 0;
    this.stageIntroFrames = 0;
  }

  checkAndUnlockAchievement(achievementId) {
    if (this.storageManager.unlockAchievement(achievementId)) {
      const spec = this.gameConfig.achievements?.[achievementId];
      const rewardCoins = spec?.rewardCoins || 0;
      const achName = t(`modals.shop.achievements.items.${achievementId}.name`);
      this.audioManager.playEffect('achievement');
      this.particleSystem.spawnFloatingText(
        this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
        this.gameConfig.canvas.launcherY + this.gameConfig.canvas.anvilPopupOffsetY,
        t('gameplay.feedback.achievement.unlocked', { name: achName, coins: rewardCoins }),
        this.gameConfig.theme.coinPopupColor
      );
      this.notifyUI({ unlockedAchievementId: achievementId });
    }
  }

  getBlastRadiusMultiplier() {
    const lvl = this.storageManager.getUpgradeLevel('blastRadius');
    const spec = this.gameConfig.upgrades.blastRadius;
    return 1 + lvl * spec.radiusMultiplierPerLevel;
  }

  getOverchargeMultiplier() {
    const lvl = this.storageManager.getUpgradeLevel('overchargeRate');
    const spec = this.gameConfig.upgrades.overchargeRate;
    return 1 + lvl * spec.rateMultiplierPerLevel;
  }

  /**
   * Laser Sight reach bonuses. The returned object is reused across calls (the aim preview
   * asks every frame): read it right away, do not keep it.
   */
  getLaserBonuses() {
    const lvl = this.storageManager.getUpgradeLevel('laserSight');
    const spec = this.gameConfig.upgrades.laserSight;
    this.laserBonuses.distanceBonus = lvl * spec.distanceBonusPerLevel;
    this.laserBonuses.bouncesBonus = lvl * spec.bouncesBonusPerLevel;
    return this.laserBonuses;
  }

  getStartingShotsBonus() {
    const lvl = this.storageManager.getUpgradeLevel('startingShots');
    const spec = this.gameConfig.upgrades.startingShots;
    return lvl * spec.shotsPerLevel;
  }

  /** Shield hits a ball starts with for its modifier (0 when it has no armor). */
  getInitialArmor(mod) {
    if (mod === CLUSTER_MODIFIERS.ARMORED) {
      return this.ballsConfig.clusterModifiers.armored.initialArmor;
    }
    if (mod === CLUSTER_MODIFIERS.BOSS_CORE) {
      return this.ballsConfig.clusterModifiers.bossCore.initialArmor;
    }
    return 0;
  }

  createClusterBall(options) {
    const mod = options.clusterModifier || null;
    const initialArmor = this.getInitialArmor(mod);
    const isColorless =
      Boolean(options.specialType) || mod === CLUSTER_MODIFIERS.NEUTRAL_ANCHOR || mod === CLUSTER_MODIFIERS.RUST;
    const safeColorId = isColorless
      ? null
      : this.pickSpawnColorForPosition(options.x, options.y, options.colorId);
    return new Ball({
      ...options,
      colorId: safeColorId,
      clusterModifier: mod,
      armorHits: options.armorHits !== undefined ? options.armorHits : initialArmor
    });
  }

  pickSpawnColorForPosition(x, y, preferredColor = null) {
    if (this.activePalette.length === 0) {
      return preferredColor;
    }
    const r = this.physicsConfig.ball.radius;
    const bondRange = r * this.physicsConfig.simulation.bondCreationDistanceFactor;
    const maxSameNeighbors = this.gameConfig.defaults.matchMinCount - 1;

    const existingBalls = this.physicsWorld.balls;
    const directNeighbors = [];
    for (const b of existingBalls) {
      if (Math.hypot(b.x - x, b.y - y) <= bondRange) {
        directNeighbors.push(b);
      }
    }

    if (directNeighbors.length === 0) {
      return preferredColor || this.pickPaletteColor();
    }

    const candidates = [...this.activePalette];
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }

    const countClusterSizeWithColor = (testColor) => {
      const visited = new Set();
      const queue = [];
      for (const n of directNeighbors) {
        if (n.colorId === testColor && !visited.has(n.id)) {
          visited.add(n.id);
          queue.push(n);
        }
      }
      let head = 0;
      while (head < queue.length) {
        const curr = queue[head++];
        for (const other of existingBalls) {
          if (other.colorId === testColor && !visited.has(other.id)) {
            if (Math.hypot(other.x - curr.x, other.y - curr.y) <= bondRange) {
              visited.add(other.id);
              queue.push(other);
            }
          }
        }
      }
      return visited.size;
    };

    for (const col of candidates) {
      if (countClusterSizeWithColor(col) < maxSameNeighbors) {
        return col;
      }
    }

    return candidates[0];
  }

  startCampaignLevel(levelId) {
    const levels = this.levelsConfig.levels;
    const levelDef = levels.find((l) => l.id === levelId) || levels[0];

    this.resetRunState(GAME_MODES.CAMPAIGN);
    this.currentLevelId = levelDef.id;
    this.shotsRemaining = levelDef.maxShots + this.getStartingShotsBonus();
    this.levelTutorialKey = levelDef.tutorialKey || null;
    this.specialInventory = { ...levelDef.specialInventory };

    this.activePalette = this.ballsConfig.standardColors
      .slice(0, levelDef.paletteCount)
      .map((c) => c.id);

    this.audioManager.stopAll();
    this.physicsWorld.clear();
    this.particleSystem.clear();

    for (const obsDef of shiftObstacleDefsX(levelDef.obstacles, this.gameConfig.canvas.contentOffsetX)) {
      const obs = new Obstacle(obsDef, this.obstaclesConfig);
      this.physicsWorld.obstacles.push(obs);
    }

    this.buildLevelLayout(levelDef.layout, levelDef.modifierWeights || {}, levelDef.minModifierCounts || {});
    this.physicsWorld.rebuildInitialBonds();
    this.levelStartBallCount = this.physicsWorld.balls.length;

    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    this.refreshDiscovery();
    this.notifyUI();
  }

  startEndlessMode() {
    this.initSurvivalRun(GAME_MODES.ENDLESS, null);
    this.notifyUI();
  }

  /**
   * Starts the Daily Challenge for a seed (today's UTC date key by default).
   * @param {string|null} customSeed - Seed key; restarts pass the running seed so the board stays identical.
   * @param {boolean} isRestart - True when replaying the same seed; the first-play bonus is never re-granted.
   */
  startDailyChallenge(customSeed = null, isRestart = false) {
    const seed = customSeed || SeededRandom.getTodayDateKey();
    this.initSurvivalRun(GAME_MODES.DAILY, seed);
    const bonusCoins = this.gameConfig.daily.firstPlayBonusCoins;
    if (!isRestart && bonusCoins > 0 && this.storageManager.claimDailyPlayBonus(seed, bonusCoins)) {
      this.audioManager.playEffect('achievement');
      this.particleSystem.spawnFloatingText(
        this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
        this.gameConfig.canvas.launcherY + this.gameConfig.canvas.launcherPopupOffsetY,
        t('gameplay.feedback.dailyBonus.claimed', { coins: bonusCoins }),
        this.gameConfig.theme.coinPopupColor
      );
    }
    this.notifyUI();
  }

  /**
   * Starts a Flux run: an endless chain of generated shapes sharing one shot reserve.
   * @param {string|null} seed - Run seed; a fresh random seed when omitted.
   */
  startFluxRun(seed = null) {
    this.initFluxRun(seed || this.createFluxSeed());
    this.buildFluxStage({ persist: false });
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    this.notifyUI();
  }

  /**
   * Rebuilds a saved Flux run at its stage: same seed, same shape, same obstacles. The
   * caller (applyRunSnapshot) then puts the saved balls and counters back.
   */
  restoreFluxRun(seed, stage, previousFamily) {
    this.initFluxRun(seed);
    this.fluxStage = stage;
    this.fluxPreviousFamily = previousFamily;
    this.buildFluxStage({ persist: false });
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
  }

  createFluxSeed() {
    const { radix, length } = this.fluxConfig.seed;
    return Math.floor(Math.random() * radix ** length)
      .toString(radix)
      .padStart(length, '0');
  }

  initFluxRun(seed) {
    this.resetRunState(GAME_MODES.FLUX);
    this.fluxSeed = seed;
    this.seededRng = new SeededRandom(seed);
    this.fluxStage = 1;
    this.fluxPreviousFamily = null;
    this.shotsRemaining = this.fluxConfig.shots.starting + this.getStartingShotsBonus();
    this.specialInventory = { ...this.fluxConfig.initialSpecialCounts };
    // The previous run's launcher balls would be recolored by the first stage build and
    // draw from the new seed: a seed must give the same run whatever was played before.
    this.currentBall = null;
    this.nextBall = null;
    this.upcomingColorIds = [];
    this.stashedRegularColorId = null;
    this.audioManager.stopAll();
    this.particleSystem.clear();
  }

  /**
   * Replaces the board with the generated shape of the current Flux stage.
   * @param {{persist: boolean}} options - persist stores the run right away, so a reload
   *   resumes on the new shape; restoring a saved run passes false to keep that save.
   */
  buildFluxStage({ persist }) {
    const stageDef = generateFluxStage({
      seed: this.fluxSeed,
      stage: this.fluxStage,
      previousFamily: this.fluxPreviousFamily,
      fluxConfig: this.fluxConfig,
      obstaclesConfig: this.obstaclesConfig,
      ballRadius: this.physicsConfig.ball.radius
    });

    this.physicsWorld.clear();
    this.activePalette = this.ballsConfig.standardColors
      .slice(0, stageDef.paletteCount)
      .map((c) => c.id);
    const contentOffsetX = this.gameConfig.canvas.contentOffsetX;
    for (const obsDef of shiftObstacleDefsX(stageDef.obstacles, contentOffsetX)) {
      this.physicsWorld.obstacles.push(new Obstacle(obsDef, this.obstaclesConfig));
    }
    const balls = this.materializeLayout(shiftSpecX(stageDef.spec, contentOffsetX), stageDef.modifierWeights);
    if (stageDef.bossBallIndex !== null) {
      const bossBall = balls[stageDef.bossBallIndex];
      bossBall.clusterModifier = CLUSTER_MODIFIERS.BOSS_CORE;
      bossBall.armorHits = this.ballsConfig.clusterModifiers.bossCore.initialArmor;
    }
    this.physicsWorld.rebuildInitialBonds();

    this.fluxFamily = stageDef.family;
    this.fluxShapeIds = stageDef.shapeIds;
    this.fluxIsBossStage = stageDef.isBoss;
    this.hasFiredInRound = false;
    this.combo = 0;
    this.freezeTurnsRemaining = 0;
    this.stageIntroFrames = this.isReducedMotion ? 0 : this.fluxConfig.transition.introFrames;

    for (const launcherBall of [this.currentBall, this.nextBall]) {
      if (launcherBall && !launcherBall.specialType && !this.activePalette.includes(launcherBall.colorId)) {
        launcherBall.colorId = this.pickLauncherColor();
      }
    }
    this.upcomingColorIds = this.upcomingColorIds.map((color) => (this.activePalette.includes(color) ? color : this.pickLauncherColor()));
    if (this.currentBall) {
      this.updateAimFromAngle(this.aimAngle);
    }
    this.refreshDiscovery();
    if (persist) {
      const snapshot = captureRunSnapshot(this, this.storageManager.getRunSnapshotVersion());
      if (snapshot) {
        this.storageManager.saveRunSnapshot(snapshot);
        this.flushPendingRunCoins();
      }
    }
  }

  /** Shots given back when a Flux shape is cleared; the refill shrinks as stages go by. */
  getFluxShotRefill(stage) {
    const shots = this.fluxConfig.shots;
    return Math.max(shots.refillMin, Math.round(shots.refillBase - shots.refillDecayPerStage * (stage - 1)));
  }

  /**
   * Pays a cleared Flux shape (points, coins, refilled shots, specials after a boss) and
   * starts the transition to the next stage.
   */
  completeFluxStage() {
    const rewards = this.fluxConfig.rewards;
    const clearedStage = this.fluxStage;
    const points = rewards.stageClearPointsBase + rewards.stageClearPointsPerStage * clearedStage;
    const refill = this.getFluxShotRefill(clearedStage);
    this.addScore(points);
    this.awardRunCoins(rewards.stageClearCoins);
    this.shotsRemaining += refill;
    if (this.fluxIsBossStage) {
      for (let i = 0; i < rewards.bossClearSpecials; i++) {
        this.grantRandomSpecialBall();
      }
    }
    this.audioManager.playEffect('victory');
    this.particleSystem.spawnFloatingText(
      this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      this.gameConfig.canvas.logicalHeight * MATH_CONSTANTS.HALF,
      t('gameplay.feedback.flux.stageCleared', { stage: clearedStage, points, shots: refill }),
      this.gameConfig.theme.victoryPopupColor
    );
    this.fluxPreviousFamily = this.fluxFamily;
    this.fluxStage = clearedStage + 1;
    this.stageTransitionFrames = this.fluxConfig.transition.clearFrames;
    this.notifyUI({ fluxStageCleared: clearedStage });
  }

  /** Lets the cleared shape's last balls fall, then brings in the next shape. */
  updateStageTransition() {
    this.physicsWorld.stepDroppingBalls(this.getStepCallbacks());
    this.particleSystem.update(this.gameConfig.juice.shakeDecay);
    this.stageTransitionFrames--;
    if (this.stageTransitionFrames === 0) {
      this.buildFluxStage({ persist: true });
      this.notifyUI();
    }
  }

  initSurvivalRun(mode, seed = null) {
    const endlessCfg = this.gameConfig.endless;
    const dailyCfg = this.gameConfig.daily;
    this.resetRunState(mode);
    this.dailySeedKey = mode === GAME_MODES.DAILY ? seed : null;
    this.seededRng = seed ? new SeededRandom(seed) : null;
    this.waveCount = 1;
    this.endlessRowParity = 0;
    this.shotsUntilWave = endlessCfg.shotsBeforeWave;
    this.specialInventory = { ...endlessCfg.initialSpecialCounts };

    this.activePalette = this.ballsConfig.standardColors
      .slice(0, endlessCfg.paletteCount)
      .map((c) => c.id);

    this.audioManager.stopAll();
    this.physicsWorld.clear();
    this.particleSystem.clear();

    let rotorMult = 1.0;
    if (mode === GAME_MODES.DAILY && dailyCfg.mutators) {
      const mutatorKeys = Object.keys(dailyCfg.mutators);
      if (mutatorKeys.length > 0) {
        this.activeMutatorKey = mutatorKeys[Math.floor(this.random() * mutatorKeys.length)];
        const mutSpec = dailyCfg.mutators[this.activeMutatorKey];
        if (mutSpec.clusterGravityMultiplier) {
          this.physicsWorld.gravityMultiplier = mutSpec.clusterGravityMultiplier;
        }
        if (mutSpec.magnetismMultiplier) {
          this.physicsWorld.magnetismMultiplier = mutSpec.magnetismMultiplier;
        }
        if (mutSpec.rotorSpeedMultiplier) {
          rotorMult = mutSpec.rotorSpeedMultiplier;
          this.physicsWorld.rotorSpeedMultiplier = rotorMult;
        }
      }
    }

    const r = this.physicsConfig.ball.radius;
    for (let row = 0; row < endlessCfg.initialRows; row++) {
      const y = endlessCfg.startY + row * endlessCfg.rowSpacingY;
      this.spawnEndlessRow(y, row % 2, row === 0, () => this.rollEndlessModifier());
    }

    if (mode === GAME_MODES.DAILY) {
      const singMargin = r * dailyCfg.singularityMarginRadiusFactor;
      const singOffsetY = r * dailyCfg.singularityOffsetAboveDangerFactor;
      const leftSingularity = new Obstacle(
        { type: OBSTACLE_TYPES.SINGULARITY, x: singMargin, y: this.gameConfig.canvas.dangerLineY - singOffsetY },
        this.obstaclesConfig
      );
      const rightSingularity = new Obstacle(
        {
          type: OBSTACLE_TYPES.SINGULARITY,
          x: this.gameConfig.canvas.logicalWidth - singMargin,
          y: this.gameConfig.canvas.dangerLineY - singOffsetY
        },
        this.obstaclesConfig
      );
      const lastRowY = endlessCfg.startY + (endlessCfg.initialRows - 1) * endlessCfg.rowSpacingY;
      const pivotX = this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF;
      const pivotY = lastRowY + dailyCfg.pivotClearanceY;
      const basePivotSpeed = dailyCfg.pivotBaseAngularSpeed * rotorMult;
      const centralPivot = new Obstacle(
        {
          type: OBSTACLE_TYPES.PIVOT,
          x: pivotX,
          y: pivotY,
          angularSpeed: basePivotSpeed
        },
        this.obstaclesConfig
      );
      this.physicsWorld.obstacles.push(leftSingularity, rightSingularity, centralPivot);

      const ringCount = dailyCfg.pivotRingCount;
      const ringRadius = r * dailyCfg.pivotRingRadiusFactor;
      this.spawnConcentricRings(pivotX, pivotY, [{ radius: ringRadius, count: ringCount }], centralPivot, {});
    }

    this.physicsWorld.rebuildInitialBonds();
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.fillUpcomingColors();
    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    this.refreshDiscovery();
  }

  /**
   * Adds one staggered row of endless-grid balls, shared by the initial grid and incoming waves.
   * @param {number} y - Row center height.
   * @param {number} parity - Row stagger parity (0 or 1) selecting the half-radius offset.
   * @param {boolean} withAnchors - Whether the configured anchor columns become anchors.
   * @param {(col: number) => string|null} pickModifier - Modifier picker for non-anchor columns.
   * @returns {Array<import('../entities/Ball.js').Ball>} The balls created for the row.
   */
  spawnEndlessRow(y, parity, withAnchors, pickModifier) {
    const endlessCfg = this.gameConfig.endless;
    const r = this.physicsConfig.ball.radius;
    const cols = endlessCfg.columns;
    const spacingX = r * this.physicsConfig.simulation.bondRestDistanceFactor;
    const totalW = (cols - 1) * spacingX;
    const startX = (this.gameConfig.canvas.logicalWidth - totalW) * MATH_CONSTANTS.HALF;
    const rowOffset = parity * r * MATH_CONSTANTS.HALF;
    const rowBalls = [];
    for (let col = 0; col < cols; col++) {
      const isAnchor = withAnchors && endlessCfg.anchorColumns.includes(col);
      const ball = this.createClusterBall({
        x: startX + col * spacingX + rowOffset,
        y,
        radius: r,
        colorId: this.pickPaletteColor(),
        clusterModifier: isAnchor ? null : pickModifier(col),
        isAnchor
      });
      this.physicsWorld.addBall(ball);
      rowBalls.push(ball);
    }
    return rowBalls;
  }

  rollModifier(weights) {
    const rand = this.random();
    let cumulative = 0;
    for (const [modKey, weight] of Object.entries(weights)) {
      cumulative += weight;
      if (rand < cumulative) {
        return modKey;
      }
    }
    return null;
  }

  rollEndlessModifier() {
    if (this.activeMutatorKey === DAILY_MUTATORS.VOLATILE_CLUSTER) {
      const extra = this.gameConfig.daily.mutators.volatileCluster.extraBombWeight;
      if (this.random() < extra) {
        return CLUSTER_MODIFIERS.DORMANT_BOMB;
      }
    }
    return this.rollModifier(this.gameConfig.endless.modifierWeights);
  }

  buildLevelLayout(layout, modifierWeights = {}, minModifierCounts = {}) {
    const spec = shiftSpecX(generateLayout(layout), this.gameConfig.canvas.contentOffsetX);
    this.materializeLayout(spec, modifierWeights, minModifierCounts);
  }

  /**
   * Creates the balls and structural bonds of a layout spec (see LayoutGenerators.js).
   * Pivot slots resolve against the board's pivot obstacles in obstacle order; a slot
   * without a pivot leaves the anchor fixed in place.
   * @param {{balls: object[], bonds: number[][]}} spec - Layout spec, in creation order.
   * @param {Object<string, number>} modifierWeights - Cluster modifier roll weights.
   * @param {Object<string, number>} minModifierCounts - Modifiers the board must show at least
   *   this many times; a level that introduces a mechanic cannot roll none of it.
   * @returns {Array<import('../entities/Ball.js').Ball>} The created balls, in spec order.
   */
  materializeLayout(spec, modifierWeights = {}, minModifierCounts = {}) {
    const r = this.physicsConfig.ball.radius;
    const pivots = this.physicsWorld.obstacles.filter((o) => o.type === OBSTACLE_TYPES.PIVOT);
    const created = spec.balls.map((ballSpec) => {
      const ball = this.createClusterBall({
        x: ballSpec.x,
        y: ballSpec.y,
        radius: r,
        colorId: this.pickPaletteColor(),
        clusterModifier: this.pickSpecModifier(ballSpec, modifierWeights),
        isAnchor: ballSpec.isAnchor,
        pivotRef: ballSpec.pivotSlot === NO_PIVOT_SLOT ? null : pivots[ballSpec.pivotSlot] || null,
        pivotRadius: ballSpec.pivotRadius,
        pivotAngle: ballSpec.pivotAngle,
        railMinX: ballSpec.railHalfWidth > 0 ? ballSpec.x - ballSpec.railHalfWidth : null,
        railMaxX: ballSpec.railHalfWidth > 0 ? ballSpec.x + ballSpec.railHalfWidth : null
      });
      this.physicsWorld.addBall(ball);
      return ball;
    });
    for (const [a, b] of spec.bonds) {
      this.physicsWorld.createBond(created[a], created[b], false);
    }
    this.ensureMinimumModifiers(
      created.filter((ball, index) => spec.balls[index].allowModifier),
      minModifierCounts
    );
    return created;
  }

  /** Modifier of a layout ball: neutral anchors are fixed, other free balls roll one. */
  pickSpecModifier(ballSpec, modifierWeights) {
    if (ballSpec.isNeutral) {
      return CLUSTER_MODIFIERS.NEUTRAL_ANCHOR;
    }
    return ballSpec.allowModifier ? this.rollModifier(modifierWeights) : null;
  }

  /**
   * Tops up each modifier to its minimum count by giving it to plain balls picked at
   * random among those allowed to carry one.
   * @param {Array<import('../entities/Ball.js').Ball>} candidates - Balls allowed a modifier.
   * @param {Object<string, number>} minCounts - Minimum count per modifier id.
   */
  ensureMinimumModifiers(candidates, minCounts) {
    for (const [modKey, minCount] of Object.entries(minCounts)) {
      let missing = minCount - candidates.filter((ball) => ball.clusterModifier === modKey).length;
      while (missing > 0) {
        const plain = candidates.filter((ball) => !ball.clusterModifier);
        if (plain.length === 0) {
          return;
        }
        const ball = plain[Math.floor(this.random() * plain.length)];
        ball.clusterModifier = modKey;
        ball.armorHits = this.getInitialArmor(modKey);
        missing--;
      }
    }
  }

  spawnConcentricRings(centerX, centerY, rings, pivotObstacle, modifierWeights = {}) {
    const r = this.physicsConfig.ball.radius;
    rings.forEach((ringDef, ringIndex) => {
      for (let i = 0; i < ringDef.count; i++) {
        const angle = (MATH_CONSTANTS.TWO_PI * i) / ringDef.count;
        const x = centerX + Math.cos(angle) * ringDef.radius;
        const y = centerY + Math.sin(angle) * ringDef.radius;
        const isInnerRing = ringIndex === 0;
        const ball = this.createClusterBall({
          x,
          y,
          radius: r,
          colorId: this.pickPaletteColor(),
          clusterModifier: isInnerRing ? null : this.rollModifier(modifierWeights),
          isAnchor: isInnerRing,
          pivotRef: isInnerRing ? pivotObstacle : null,
          pivotRadius: isInnerRing ? ringDef.radius : 0,
          pivotAngle: angle
        });
        this.physicsWorld.addBall(ball);
      }
    });
  }

  pickPaletteColor() {
    return this.activePalette[Math.floor(this.random() * this.activePalette.length)];
  }

  pickLauncherColor() {
    const existingColors = new Set();
    for (const b of this.physicsWorld.balls) {
      if (b.colorId) {
        existingColors.add(b.colorId);
      }
    }
    const pool = existingColors.size > 0 ? Array.from(existingColors) : this.activePalette;
    return pool[Math.floor(this.random() * pool.length)];
  }

  /**
   * Builds a launcher ball; a regular ball keeps `colorId` when given, otherwise picks a board color.
   * @param {string|null} specialType - Special ball type, or null for a regular colored ball.
   * @param {string|null} colorId - Color to restore on a regular ball.
   */
  createRandomLauncherBall(specialType = null, colorId = null) {
    return new Ball({
      x: this.gameConfig.canvas.launcherX,
      y: this.gameConfig.canvas.launcherY,
      radius: this.physicsConfig.ball.radius,
      colorId: specialType ? null : colorId || this.pickLauncherColor(),
      specialType,
      isProjectile: false
    });
  }

  equipSpecialBall(specialType) {
    if (this.state !== GAME_STATES.PLAYING || this.physicsWorld.projectile) {
      return;
    }
    if (this.currentBall && this.currentBall.specialType === specialType) {
      this.specialInventory[specialType] = (this.specialInventory[specialType] || 0) + 1;
      this.currentBall = this.createRandomLauncherBall(null, this.stashedRegularColorId);
      this.stashedRegularColorId = null;
      this.audioManager.playEffect('snap');
      this.updateAimFromAngle(this.aimAngle);
      this.notifyUI();
      return;
    }
    const count = this.specialInventory[specialType] || 0;
    if (count <= 0) {
      return;
    }
    if (this.currentBall && this.currentBall.specialType) {
      const prevType = this.currentBall.specialType;
      this.specialInventory[prevType] = (this.specialInventory[prevType] || 0) + 1;
    } else if (this.currentBall && this.currentBall.colorId) {
      this.stashedRegularColorId = this.currentBall.colorId;
    }
    this.specialInventory[specialType] = count - 1;
    this.currentBall = this.createRandomLauncherBall(specialType);
    this.audioManager.playEffect('snap');
    this.updateAimFromAngle(this.aimAngle);
    this.notifyUI();
  }

  /**
   * Closes the open discovery hint. The next unknown mechanic on the board, if any, is
   * shown at the end of the following turn rather than at once.
   */
  dismissDiscovery() {
    if (this.activeDiscoveryId) {
      this.activeDiscoveryId = null;
      this.discoveryTurnCount = 0;
      this.notifyUI();
    }
  }

  /** Forgets every discovered mechanic; the board's own hints come back right away. */
  resetDiscoveries() {
    this.storageManager.resetDiscoveries();
    this.activeDiscoveryId = null;
    this.discoveryTurnCount = 0;
    if (this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.PAUSED) {
      this.refreshDiscovery();
    }
    this.notifyUI();
  }

  /** A hint left open counts the turns played under it, so it can give way to the next. */
  countDiscoveryTurn() {
    if (this.activeDiscoveryId) {
      this.discoveryTurnCount++;
    }
  }

  /**
   * Shows the first unknown mechanic on the board, unless a hint is still open within its
   * turn allowance. A mechanic counts as discovered as soon as its hint shows, together
   * with the mechanics explained by the same text. Does nothing while a saved run is being
   * rebuilt: that board is replaced before the player sees it.
   */
  refreshDiscovery() {
    if (this.isRestoringRun) {
      return;
    }
    const onboarding = this.gameConfig.onboarding;
    if (this.activeDiscoveryId && this.discoveryTurnCount < onboarding.hintShotLimit) {
      return;
    }
    const present = listBoardMechanics(this.physicsWorld.balls, this.physicsWorld.obstacles);
    const next = pickNextDiscovery(
      present,
      this.storageManager.getDiscoveries(),
      onboarding.order,
      this.listCurrentLevelMechanics()
    );
    this.activeDiscoveryId = next;
    this.discoveryTurnCount = 0;
    if (next) {
      this.storageManager.markDiscovered(listMechanicsSharingHint(next, onboarding.mechanics));
    }
  }

  /**
   * Mechanics the campaign level being played always shows, explained before the rest so a
   * player who opens a level directly first learns what the level is built around.
   * @returns {Set<string>} Mechanic ids; empty outside the campaign.
   */
  listCurrentLevelMechanics() {
    if (this.mode !== GAME_MODES.CAMPAIGN) {
      return new Set();
    }
    const levelDef = this.levelsConfig.levels.find((l) => l.id === this.currentLevelId);
    return levelDef ? listLevelMechanics(levelDef, { guaranteedOnly: true }) : new Set();
  }

  /**
   * Gives a player who already played before discoveries existed credit for the mechanics
   * of the levels behind them, so they are not shown hints for what they already know.
   * Runs once: a new player gets an empty set and starts from the basics.
   */
  seedDiscoveriesFromProgress() {
    if (this.storageManager.hasDiscoveries()) {
      return;
    }
    const unlockedLevel = this.storageManager.getUnlockedLevel();
    const hasPlayedBefore =
      unlockedLevel > this.gameConfig.defaults.initialUnlockedLevel ||
      this.storageManager.getEndlessHighScore() > 0 ||
      this.storageManager.getFluxHighScore() > 0;
    const known = new Set();
    if (hasPlayedBefore) {
      known.add(BOARD_MECHANICS.BASICS);
      for (const level of this.levelsConfig.levels.filter((lvl) => lvl.id < unlockedLevel)) {
        for (const mechanicId of listLevelMechanics(level)) {
          known.add(mechanicId);
        }
      }
    }
    if (known.size > 0) {
      this.storageManager.markDiscovered([...known]);
    } else {
      this.storageManager.resetDiscoveries();
    }
  }

  /**
   * False on a campaign level that hands out no special ball while the run holds none and
   * none is loaded: the special ball slots stay out of sight until there is one to use.
   * @returns {boolean} True when the special ball slots belong on screen.
   */
  offersSpecialBalls() {
    if (this.mode !== GAME_MODES.CAMPAIGN) {
      return true;
    }
    const levelDef = this.levelsConfig.levels.find((l) => l.id === this.currentLevelId);
    const grants = Object.values(levelDef?.specialInventory || {}).some((count) => count > 0);
    const holds = Object.values(this.specialInventory).some((count) => count > 0);
    return grants || holds || Boolean(this.currentBall?.specialType);
  }

  /**
   * Buys one special ball for the active run.
   * @param {string} specialType - Special ball type to buy.
   * @returns {boolean} True when coins were debited and the ball added; false when no run is
   *   active (only PLAYING or PAUSED runs accept purchases), the item is not for sale, or coins are short.
   */
  buySpecialAmmo(specialType) {
    if (this.state !== GAME_STATES.PLAYING && this.state !== GAME_STATES.PAUSED) {
      return false;
    }
    const cost = this.gameConfig.specialShopCosts?.[specialType];
    if (!Number.isFinite(cost) || cost <= 0) {
      return false;
    }
    const coins = this.storageManager.getCoins();
    if (coins < cost) {
      return false;
    }
    this.storageManager.setCoins(coins - cost);
    this.specialInventory[specialType] = (this.specialInventory[specialType] || 0) + 1;
    this.audioManager.playEffect('overcharge');
    this.notifyUI();
    return true;
  }

  setReducedMotion(enabled) {
    this.isReducedMotion = Boolean(enabled);
    this.particleSystem.setReducedMotion(enabled);
  }

  swapLauncherBalls() {
    if (this.state !== GAME_STATES.PLAYING || this.physicsWorld.projectile || !this.currentBall || !this.nextBall) {
      return;
    }
    const temp = this.currentBall;
    this.currentBall = this.nextBall;
    this.nextBall = temp;
    this.audioManager.playEffect('snap');
    this.updateAimFromAngle(this.aimAngle);
    this.notifyUI();
  }

  togglePolarityFlip() {
    if (this.state !== GAME_STATES.PLAYING) {
      return;
    }
    this.isPolarityFlipped = !this.isPolarityFlipped;
    this.audioManager.playEffect('snap');
    this.updateAimFromAngle(this.aimAngle);
    this.notifyUI();
  }

  /**
   * Turns the aim by a keyboard step and locks it against small mouse movements, so a
   * fine adjustment survives a hand resting on the mouse (see followPointer).
   * @param {number} deltaRad - Signed angle step.
   */
  adjustAimByDelta(deltaRad) {
    if (this.state !== GAME_STATES.PLAYING) {
      return;
    }
    this.isAimCancelled = false;
    this.isAimLocked = true;
    this.aimLockOrigin = null;
    const canvasCfg = this.gameConfig.canvas;
    const clamped = Math.max(-canvasCfg.maxAimAngleRad, Math.min(-canvasCfg.minAimAngleRad, this.aimAngle + deltaRad));
    this.updateAimFromAngle(clamped);
  }

  /**
   * Whether a mouse position should drive the aim. After a keyboard adjustment the aim
   * stays put until the pointer travels farther than canvas.pointerAimUnlockDistance from
   * where it was first seen; the lock then lifts and the pointer drives the aim again.
   * @param {number} x - Pointer position in logical coordinates.
   * @param {number} y - Pointer position in logical coordinates.
   * @returns {boolean} True when the caller should aim at the pointer.
   */
  followPointer(x, y) {
    if (!this.isAimLocked) {
      return true;
    }
    if (!this.aimLockOrigin) {
      this.aimLockOrigin = { x, y };
      return false;
    }
    const travel = Math.hypot(x - this.aimLockOrigin.x, y - this.aimLockOrigin.y);
    if (travel <= this.gameConfig.canvas.pointerAimUnlockDistance) {
      return false;
    }
    this.releaseAimLock();
    return true;
  }

  /** Hands the aim back to the pointer, as a touch or a long mouse movement does. */
  releaseAimLock() {
    this.isAimLocked = false;
    this.aimLockOrigin = null;
  }

  updateAim(targetX, targetY) {
    const canvasCfg = this.gameConfig.canvas;
    const cancelThresholdY = canvasCfg.launcherY + canvasCfg.cancelAimOffsetY;
    if (targetY > cancelThresholdY) {
      this.isAimCancelled = true;
      return;
    }
    this.isAimCancelled = false;
    const dx = targetX - canvasCfg.launcherX;
    const dy = targetY - canvasCfg.launcherY;
    let angle = Math.atan2(dy, dx);
    if (angle > -canvasCfg.minAimAngleRad) {
      angle = dx >= 0 ? -canvasCfg.minAimAngleRad : -canvasCfg.maxAimAngleRad;
    }
    angle = Math.max(-canvasCfg.maxAimAngleRad, Math.min(-canvasCfg.minAimAngleRad, angle));
    this.updateAimFromAngle(angle);
  }

  updateAimFromAngle(angle) {
    this.aimAngle = angle;
    this.isAimPreviewStale = false;
    const canvasCfg = this.gameConfig.canvas;
    const bonuses = this.getLaserBonuses();
    this.aimPoints = this.physicsWorld.computeAimTrajectory(
      canvasCfg.launcherX,
      canvasCfg.launcherY,
      this.aimAngle,
      this.currentBall,
      bonuses.distanceBonus,
      bonuses.bouncesBonus,
      this.isPolarityFlipped
    );
  }

  /**
   * Physics callbacks of the fixed step, built once: creating these closures on every
   * update allocated eight functions per step for the garbage collector.
   */
  getStepCallbacks() {
    if (this.stepCallbacks) {
      return this.stepCallbacks;
    }
    const theme = this.gameConfig.theme;
    const juice = this.gameConfig.juice;
    this.stepCallbacks = {
      onBounce: (x, y) => {
        this.audioManager.playEffect('bounce');
        this.particleSystem.spawnBurst(
          x,
          y,
          theme.bounceParticleColor,
          juice.bounceBurstCount,
          juice.bounceBurstSpeed
        );
        this.crackWallAt(x, y);
      },
      onBallDroppedOut: (ball) => {
        this.particleSystem.splashLiquid(ball.x / this.gameConfig.canvas.logicalWidth, ball.vy);
      },
      onPortalWarp: (entryPortal, exitPortal) => {
        const portalCfg = this.obstaclesConfig.types.portal;
        this.audioManager.playEffect('portal');
        this.particleSystem.spawnBurst(
          entryPortal.x,
          entryPortal.y,
          portalCfg.ringColor,
          portalCfg.burstCount,
          portalCfg.burstSpeed
        );
        this.particleSystem.spawnBurst(
          exitPortal.x,
          exitPortal.y,
          portalCfg.ringColor,
          portalCfg.burstCount,
          portalCfg.burstSpeed
        );
        this.particleSystem.spawnFloatingText(
          exitPortal.x,
          exitPortal.y + this.gameConfig.canvas.floatingTextOffsetY,
          t('gameplay.feedback.portal.warp'),
          theme.portalPopupColor
        );
      },
      onAnvilCrush: (target) => {
        const anvilSpecs = this.ballsConfig.specialTypes.anvil;
        if (this.destroyClusterBall(target, anvilSpecs.highlight, true)) {
          this.anvilCrushCount++;
          this.addScore(anvilSpecs.pointsPerBall);
          this.addOvercharge(this.gameConfig.scoring.overchargePerMatchedBall);
          this.audioManager.playEffect('snap');
        }
      },
      onAnvilComplete: () => {
        const anvilSpecs = this.ballsConfig.specialTypes.anvil;
        const canvasCfg = this.gameConfig.canvas;
        this.particleSystem.spawnFloatingText(
          canvasCfg.launcherX,
          canvasCfg.launcherY + canvasCfg.anvilPopupOffsetY,
          t('gameplay.feedback.special.anvil'),
          anvilSpecs.highlight
        );
        this.particleSystem.addScreenShake(juice.anvilShake, juice.maxShakeOffset);
        this.hitStopFrames = juice.hitStopFramesSpecial;
        // An anvil that crushed nothing is a miss: it breaks the combo and counts toward the next wave.
        const madeMatch = this.anvilCrushCount > 0;
        if (!madeMatch) {
          this.combo = 0;
        }
        this.handlePostTurnCleanup(madeMatch);
      },
      onProjectileSnapped: (snappedBall, hitTarget) => {
        this.handleProjectileSnapped(snappedBall, hitTarget);
      },
      onProjectileMissed: () => {
        this.combo = 0;
        this.handlePostTurnCleanup(false);
      },
      onSingularityCapture: (capturedBall, singularityObs) => {
        if (!this.isRunPlaying()) {
          return;
        }
        const singCfg = this.obstaclesConfig.types.singularity;
        const baseDropPts = this.gameConfig.scoring.droppedBallPoints;
        const bonusPts = Math.round(baseDropPts * singularityObs.scoreMultiplier * Math.max(1, this.combo));
        this.addScore(bonusPts);
        this.addOvercharge(singularityObs.bonusOvercharge);
        this.audioManager.playEffect('portal');
        this.particleSystem.spawnBurst(
          singularityObs.x,
          singularityObs.y,
          singCfg.ringColor,
          singCfg.burstCount,
          singCfg.burstSpeed
        );
        this.particleSystem.spawnFloatingText(
          singularityObs.x,
          singularityObs.y + this.gameConfig.canvas.floatingTextOffsetY,
          t('gameplay.feedback.singularity.absorbed', { points: bonusPts }),
          this.gameConfig.theme.singularityPopupColor
        );
        this.notifyUI();
      }
    };
    return this.stepCallbacks;
  }

  /** A bounce against a side wall cracks it; ceiling and obstacle bounces do not. */
  crackWallAt(x, y) {
    const canvasCfg = this.gameConfig.canvas;
    const wallReach = canvasCfg.wallMargin + this.physicsConfig.ball.radius;
    if (x <= wallReach) {
      this.particleSystem.addWallCrack(canvasCfg.wallMargin, y, 1);
    } else if (x >= canvasCfg.logicalWidth - wallReach) {
      this.particleSystem.addWallCrack(canvasCfg.logicalWidth - canvasCfg.wallMargin, y, -1);
    }
  }

  /**
   * Tilts gravity sideways from the device orientation: a share of the cluster gravity,
   * clamped to tilt.maxGravityShare, pushes the hanging spheres left or right.
   * @param {number} share - Signed share of gravity, positive to the right.
   */
  setTilt(share) {
    const maxShare = this.gameConfig.tilt.maxGravityShare;
    this.physicsWorld.tiltFactor = Math.max(-maxShare, Math.min(maxShare, Number(share) || 0));
  }

  /**
   * Recomputes the aim preview if the board moved since it was last traced. Called once
   * per rendered frame, however many fixed steps the frame ran.
   */
  refreshAimPreview() {
    if (!this.isAimPreviewStale) {
      return;
    }
    this.isAimPreviewStale = false;
    if (this.state === GAME_STATES.PLAYING && !this.physicsWorld.projectile && !this.isAimCancelled) {
      this.updateAimFromAngle(this.aimAngle);
    }
  }

  shoot() {
    if (this.state !== GAME_STATES.PLAYING || this.physicsWorld.projectile || !this.currentBall) {
      return;
    }
    if (this.isAimCancelled) {
      this.isAimCancelled = false;
      return;
    }
    if (this.isStageChanging() || (this.usesShotBudget() && this.shotsRemaining <= 0)) {
      return;
    }
    const ballCfg = this.physicsConfig.ball;
    const projectile = this.currentBall;
    projectile.isProjectile = true;
    projectile.isPolarityFlipped = this.isPolarityFlipped;
    projectile.x = this.gameConfig.canvas.launcherX;
    projectile.y = this.gameConfig.canvas.launcherY;
    projectile.savePreviousPosition();

    const speed = projectile.specialType === SPECIAL_TYPES.ANVIL
      ? ballCfg.anvilSpeed
      : ballCfg.projectileSpeed;

    projectile.vx = Math.cos(this.aimAngle) * speed;
    projectile.vy = Math.sin(this.aimAngle) * speed;

    this.physicsWorld.projectile = projectile;
    this.anvilCrushCount = 0;
    this.stashedRegularColorId = null;
    this.currentBall = this.nextBall;
    this.nextBall = this.createRandomLauncherBall(null, this.takeUpcomingColor());

    if (this.usesShotBudget()) {
      this.shotsRemaining = Math.max(0, this.shotsRemaining - 1);
    }

    this.hasFiredInRound = true;
    this.physicsWorld.allowTensionBreak = true;
    this.audioManager.playEffect('shoot');
    this.updateAimFromAngle(this.aimAngle);
    this.notifyUI();
  }

  update() {
    if (this.isVictoryCelebrating()) {
      this.updateVictoryCelebration();
      return;
    }
    if (this.state !== GAME_STATES.PLAYING) {
      return;
    }
    if (this.stageTransitionFrames > 0) {
      this.updateStageTransition();
      return;
    }
    if (this.stageIntroFrames > 0) {
      this.stageIntroFrames--;
    }

    const theme = this.gameConfig.theme;
    const juice = this.gameConfig.juice;

    this.updateImpactWave();

    if (this.hitStopFrames > 0) {
      this.hitStopFrames--;
      this.particleSystem.update(juice.shakeDecay);
      return;
    }

    if (this.physicsWorld.projectile) {
      this.trailFrameCounter++;
      if (this.trailFrameCounter >= juice.trailSpawnInterval) {
        this.trailFrameCounter = 0;
        const p = this.physicsWorld.projectile;
        const palette = p.specialType
          ? this.ballsConfig.specialTypes[p.specialType]
          : this.ballsConfig.standardColors.find((c) => c.id === p.colorId);
        this.particleSystem.spawnTrail(
          p.x,
          p.y,
          p.radius,
          palette ? palette.highlight : theme.defaultTrailColor
        );
      }
    }

    this.physicsWorld.step(this.getStepCallbacks());

    if (this.physicsWorld.hasBrokenBondThisStep) {
      this.physicsWorld.hasBrokenBondThisStep = false;
      this.detachAndRewardAvalanche();
      this.evaluateRoundEnd();
      this.notifyUI();
    }

    if (!this.isRunPlaying()) {
      this.particleSystem.update(juice.shakeDecay);
      return;
    }

    if (!this.physicsWorld.projectile) {
      // The board moved, but the preview is only drawn once per frame: the game loop
      // recomputes it through refreshAimPreview instead of once per fixed step.
      this.isAimPreviewStale = true;
      if (!this.hasFiredInRound) {
        this.physicsWorld.pendingChainCandidateIds.clear();
      } else {
        this.chainCooldown++;
        if (this.chainCooldown >= this.physicsConfig.simulation.chainCheckCooldownFrames) {
          this.chainCooldown = 0;
          this.evaluateAutomaticChainReactions();
        }
      }

      if (this.outOfShotsGraceFrames > 0) {
        this.outOfShotsGraceFrames--;
        if (this.physicsWorld.balls.length === 0) {
          this.outOfShotsGraceFrames = 0;
          this.evaluateRoundEnd();
        } else if (this.outOfShotsGraceFrames === 0) {
          this.triggerGameOver(GAME_OVER_REASONS.OUT_OF_SHOTS);
        }
      }
    }

    this.particleSystem.update(juice.shakeDecay);
    this.checkDangerLineBreach();
  }

  /**
   * Advances the post-victory scene only: falling balls and particles. Nothing is scored
   * because the run has ended; the victory modal is revealed when the countdown expires.
   */
  updateVictoryCelebration() {
    this.physicsWorld.stepDroppingBalls(this.getStepCallbacks());
    this.particleSystem.update(this.gameConfig.juice.shakeDecay);
    this.victoryCelebrationFrames--;
    if (this.victoryCelebrationFrames === 0) {
      this.notifyUI(this.victorySummary);
    }
  }

  /**
   * Resolves a matched color cluster of 3+ balls, incrementing combo, awarding score
   * and overcharge, triggering screen shake, hit-stop, and combo achievements.
   * @param {Array<import('../entities/Ball.js').Ball>} cluster - Connected same-color balls.
   * @param {import('../entities/Ball.js').Ball} originBall - Ball where popup text should spawn.
   * @param {boolean} isChainReaction - True if triggered automatically by post-settle bonding.
   * @returns {number} Number of balls actually destroyed; 0 means the match only cracked armor
   *   and awarded nothing.
   */
  resolveColorMatchCluster(cluster, originBall, isChainReaction = false) {
    const minMatch = this.gameConfig.defaults.matchMinCount;
    const scoring = this.gameConfig.scoring;
    const juice = this.gameConfig.juice;
    const theme = this.gameConfig.theme;
    const canvasCfg = this.gameConfig.canvas;

    const palette = this.ballsConfig.standardColors.find((c) => c.id === originBall.colorId);
    const burstColor = palette ? palette.highlight : theme.anchorCoreColor;

    let destroyedCount = 0;
    for (const member of cluster) {
      if (this.destroyClusterBall(member, burstColor, false)) {
        destroyedCount++;
      }
    }
    if (destroyedCount === 0) {
      return 0;
    }

    this.combo = Math.min(
      this.combo + scoring.comboIncrement,
      scoring.maxComboMultiplier
    );

    const basePoints = scoring.baseMatchPoints + (cluster.length - minMatch) * scoring.extraBallMultiplier;
    const points = basePoints * destroyedCount * this.combo;
    this.addScore(points);
    this.addOvercharge(destroyedCount * scoring.overchargePerMatchedBall);

    if (isChainReaction) {
      this.particleSystem.spawnFloatingText(
        originBall.x,
        originBall.y + canvasCfg.floatingTextOffsetY,
        t('gameplay.feedback.chain.popup', { points }),
        theme.chainPopupColor
      );
    } else if (this.combo > 1) {
      this.particleSystem.spawnFloatingText(
        originBall.x,
        originBall.y + canvasCfg.floatingTextOffsetY,
        t('gameplay.feedback.combo.popup', { combo: this.combo, points }),
        burstColor
      );
    }

    this.particleSystem.addScreenShake(juice.matchShake, juice.maxShakeOffset);
    this.audioManager.playEffect('match', this.combo);
    if (this.combo >= juice.hitStopMinCombo) {
      this.hitStopFrames = juice.hitStopFramesCombo;
    }
    if (this.combo >= this.gameConfig.achievements.comboMaster.threshold) {
      this.checkAndUnlockAchievement('comboMaster');
    }
    return destroyedCount;
  }

  /**
   * Resolves at most one chain-reaction cluster per check. The candidates left over are
   * queued again so the next cluster goes off one cooldown later: a cascade plays out step
   * by step instead of in a single frame.
   */
  evaluateAutomaticChainReactions() {
    const candidates = this.physicsWorld.consumeChainCandidates();
    if (candidates.length === 0) {
      return;
    }

    const minMatch = this.gameConfig.defaults.matchMinCount;
    let anyChainMatched = false;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (!this.physicsWorld.ballMap.has(candidate.id)) {
        continue;
      }
      const cluster = this.physicsWorld.findColorCluster(candidate);
      if (cluster.length >= minMatch && this.resolveColorMatchCluster(cluster, candidate, true) > 0) {
        anyChainMatched = true;
        for (let j = i + 1; j < candidates.length; j++) {
          if (this.physicsWorld.ballMap.has(candidates[j].id)) {
            this.physicsWorld.pendingChainCandidateIds.add(candidates[j].id);
          }
        }
        break;
      }
    }

    if (anyChainMatched) {
      this.detachAndRewardAvalanche();
      if (this.outOfShotsGraceFrames > 0 && this.physicsWorld.balls.length > 0) {
        this.outOfShotsGraceFrames = this.physicsConfig.simulation.outOfShotsGraceFrames;
      }
      this.evaluateRoundEnd();
      this.notifyUI();
    }
  }

  destroyClusterBall(
    ball,
    burstColor,
    ignoreArmor = false,
    burstCount = this.gameConfig.juice.matchBurstCount,
    burstSpeed = this.gameConfig.juice.matchBurstSpeed
  ) {
    if (!this.isRunPlaying() || !this.physicsWorld.ballMap.has(ball.id)) {
      return false;
    }

    const canvasCfg = this.gameConfig.canvas;

    if (!ignoreArmor && ball.clusterModifier === CLUSTER_MODIFIERS.ARMORED && ball.armorHits > 1) {
      ball.armorHits--;
      const armoredSpec = this.ballsConfig.clusterModifiers.armored;
      this.audioManager.playEffect('armorCrack');
      this.particleSystem.spawnBurst(
        ball.x,
        ball.y,
        armoredSpec.ringColor,
        armoredSpec.crackBurstCount,
        armoredSpec.crackBurstSpeed
      );
      this.particleSystem.spawnFloatingText(
        ball.x,
        ball.y + canvasCfg.floatingTextOffsetY,
        t('gameplay.feedback.armor.cracked'),
        armoredSpec.ringColor
      );
      return false;
    }

    if (ball.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE && ball.armorHits > 1) {
      ball.armorHits--;
      const bossSpec = this.ballsConfig.clusterModifiers.bossCore;
      this.audioManager.playEffect('armorCrack');
      this.particleSystem.spawnBurst(
        ball.x,
        ball.y,
        bossSpec.ringColor,
        bossSpec.crackBurstCount,
        bossSpec.crackBurstSpeed
      );
      this.particleSystem.spawnShockwave(ball.x, ball.y, bossSpec.ringColor, bossSpec.shockwaveRadius * MATH_CONSTANTS.HALF);
      this.particleSystem.spawnFloatingText(
        ball.x,
        ball.y + canvasCfg.floatingTextOffsetY,
        t('gameplay.feedback.boss.shield'),
        bossSpec.ringColor
      );
      return false;
    }

    this.particleSystem.spawnBurst(ball.x, ball.y, burstColor, burstCount, burstSpeed);
    this.popBubblesAround(ball);
    this.physicsWorld.removeBall(ball);

    if (ball.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE) {
      this.rewardBossCore(ball);
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.COIN_CORE) {
      const reward = this.ballsConfig.clusterModifiers.coinCore.coinReward;
      this.awardRunCoins(reward);
      this.particleSystem.spawnFloatingText(
        ball.x,
        ball.y + canvasCfg.floatingTextOffsetY,
        t('gameplay.feedback.coins.gain', { coins: reward }),
        this.gameConfig.theme.coinPopupColor
      );
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.DORMANT_BOMB) {
      const dormantSpecs = this.ballsConfig.clusterModifiers.dormantBomb;
      const bombResult = this.specialController.triggerBomb(
        ball,
        dormantSpecs,
        this.physicsWorld,
        this.particleSystem,
        this.audioManager,
        this.getBlastRadiusMultiplier(),
        (target, color, ignArmor, count, speed) => this.destroyClusterBall(target, color, ignArmor, count, speed)
      );
      if (bombResult.scoreDelta > 0) {
        this.addScore(bombResult.scoreDelta);
      }
      if (bombResult.destroyed.length > 0) {
        this.addOvercharge(bombResult.destroyed.length * this.gameConfig.scoring.overchargePerMatchedBall);
      }
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.LASER_LOCK) {
      const lockSpec = this.ballsConfig.clusterModifiers.laserLock;
      this.addScore(lockSpec.pointsBonus);
      this.particleSystem.spawnShockwave(ball.x, ball.y, lockSpec.ringColor, lockSpec.shockwaveRadius);
      this.releaseBarriersWhenLocksCleared();
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.FREEZE_CORE) {
      this.triggerFreezeCore(ball);
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.LIGHTNING_CORE) {
      this.triggerLightningCore(ball);
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.PAINT_CORE) {
      const paintSpec = this.ballsConfig.clusterModifiers.paintCore;
      const paintResult = this.specialController.triggerPaint(ball, paintSpec, this.physicsWorld, this.particleSystem, this.audioManager);
      this.addScore(paintResult.scoreDelta);
    }

    return true;
  }

  /**
   * Frees every bubbled ball bonded to a ball that is about to leave the board: a group
   * going off next to a bubble bursts it, and the ball inside can then join groups.
   * @param {Ball} ball - The ball being destroyed, still bonded to its neighbors.
   */
  popBubblesAround(ball) {
    for (const neighborId of ball.bonds) {
      const neighbor = this.physicsWorld.ballMap.get(neighborId);
      if (neighbor && neighbor.clusterModifier === CLUSTER_MODIFIERS.BUBBLE) {
        this.popBubble(neighbor);
      }
    }
  }

  /** Bursts a bubble; the freed ball is queued for the delayed chain check. */
  popBubble(ball) {
    const bubbleSpec = this.ballsConfig.clusterModifiers.bubble;
    ball.clusterModifier = null;
    this.addScore(bubbleSpec.pointsBonus);
    this.particleSystem.spawnBurst(ball.x, ball.y, bubbleSpec.ringColor, bubbleSpec.popBurstCount, bubbleSpec.popBurstSpeed);
    this.physicsWorld.pendingChainCandidateIds.add(ball.id);
  }

  /**
   * A Freeze Core freezes the balls around it for a few turns. The turn it goes off does
   * not count down the freeze, like a Freeze shot.
   */
  triggerFreezeCore(ball) {
    const freezeSpec = this.ballsConfig.clusterModifiers.freezeCore;
    const result = this.specialController.triggerFreeze(
      ball,
      freezeSpec,
      this.physicsWorld,
      this.particleSystem,
      this.audioManager,
      this.getBlastRadiusMultiplier()
    );
    this.addScore(result.scoreDelta);
    this.freezeTurnsRemaining = Math.max(this.freezeTurnsRemaining, result.freezeTurns);
    this.isCoreFreezeApplied = true;
  }

  /** A Lightning Core strikes the horizontal band it sits in, like a Lightning shot. */
  triggerLightningCore(ball) {
    const lightningSpec = this.ballsConfig.clusterModifiers.lightningCore;
    const result = this.specialController.triggerLightning(
      ball,
      lightningSpec,
      this.physicsWorld,
      this.particleSystem,
      this.audioManager,
      this.getBlastRadiusMultiplier(),
      (target, color, ignArmor, count, speed) => this.destroyClusterBall(target, color, ignArmor, count, speed)
    );
    this.addScore(result.scoreDelta);
    if (result.destroyed.length > 0) {
      this.addOvercharge(result.destroyed.length * this.gameConfig.scoring.overchargePerMatchedBall);
    }
  }

  /**
   * Pays a Boss Core that left the board, destroyed or fallen in an avalanche: coins,
   * points and progress toward the bossSlayer achievement.
   * @param {Ball} ball - The Boss Core, at the position where it was lost.
   */
  rewardBossCore(ball) {
    const bossSpec = this.ballsConfig.clusterModifiers.bossCore;
    this.awardRunCoins(bossSpec.coinReward);
    this.addScore(bossSpec.pointsBonus);
    this.particleSystem.spawnShockwave(ball.x, ball.y, bossSpec.ringColor, bossSpec.shockwaveRadius);
    this.particleSystem.spawnFloatingText(
      ball.x,
      ball.y + this.gameConfig.canvas.floatingTextOffsetY,
      t('gameplay.feedback.boss.destroyed', { coins: bossSpec.coinReward }),
      this.gameConfig.theme.bossPopupColor
    );
    this.bossesDestroyedInRun++;
    if (this.bossesDestroyedInRun >= this.gameConfig.achievements.bossSlayer.threshold) {
      this.checkAndUnlockAchievement('bossSlayer');
    }
  }

  /**
   * Turns the energy barriers off once no Lock Core is left on the board, whether the
   * last one was destroyed or fell in an avalanche. Boards that never had a Lock Core
   * keep their barriers: callers only invoke this after a Lock Core left the board.
   */
  releaseBarriersWhenLocksCleared() {
    const anyLockRemaining = this.physicsWorld.balls.some(
      (b) => b.clusterModifier === CLUSTER_MODIFIERS.LASER_LOCK
    );
    if (anyLockRemaining) {
      return;
    }
    const lockSpec = this.ballsConfig.clusterModifiers.laserLock;
    const canvasCfg = this.gameConfig.canvas;
    for (const obs of this.physicsWorld.obstacles) {
      if (obs.type === OBSTACLE_TYPES.BARRIER && !obs.disabled) {
        obs.disabled = true;
        this.particleSystem.spawnShockwave(obs.x, obs.y, lockSpec.ringColor, obs.width);
        this.particleSystem.spawnFloatingText(
          obs.x,
          obs.y + canvasCfg.floatingTextOffsetY,
          t('gameplay.feedback.lock.released'),
          this.gameConfig.theme.lockPopupColor
        );
      }
    }
  }

  handleProjectileSnapped(snappedBall, hitTarget = null) {
    this.audioManager.playEffect('snap');
    this.startImpactWave(snappedBall);
    this.particleSystem.addScreenShake(this.gameConfig.juice.snapShake, this.gameConfig.juice.maxShakeOffset);
    // A shot that lands on a bubble bursts it before the match is checked.
    if (
      !snappedBall.specialType &&
      hitTarget?.clusterModifier === CLUSTER_MODIFIERS.BUBBLE &&
      this.physicsWorld.ballMap.has(hitTarget.id)
    ) {
      this.popBubble(hitTarget);
    }

    if (snappedBall.specialType) {
      const result = this.specialController.resolveSpecialImpact(
        snappedBall,
        this.physicsWorld,
        this.particleSystem,
        this.audioManager,
        this.getBlastRadiusMultiplier(),
        (target, color, ignoreArmor, count, speed) => this.destroyClusterBall(target, color, ignoreArmor, count, speed)
      );
      if (result.scoreDelta > 0) {
        this.addScore(result.scoreDelta);
      }
      if (result.destroyed.length > 0) {
        this.addOvercharge(result.destroyed.length * this.gameConfig.scoring.overchargePerMatchedBall);
        this.hitStopFrames = this.gameConfig.juice.hitStopFramesSpecial;
      }
      if (result.freezeTurns > 0) {
        this.freezeTurnsRemaining = result.freezeTurns;
      }
      this.handlePostTurnCleanup(result.destroyed.length > 0, result.freezeTurns > 0);
      return;
    }

    const cluster = this.physicsWorld.findColorCluster(snappedBall);
    const minMatch = this.gameConfig.defaults.matchMinCount;

    if (cluster.length >= minMatch) {
      const destroyedCount = this.resolveColorMatchCluster(cluster, snappedBall, false);
      this.handlePostTurnCleanup(destroyedCount > 0);
    } else {
      this.combo = 0;
      this.handlePostTurnCleanup(false);
    }
  }

  /**
   * Sends a swelling wave through the cluster from the sphere that just landed, one bond
   * hop at a time and weaker at each hop. The wave only scales how spheres are drawn: their
   * positions, and so the game, are untouched. Reduced motion skips it.
   * @param {import('../entities/Ball.js').Ball} origin - The sphere that just landed.
   */
  startImpactWave(origin) {
    this.clearImpactWave();
    if (this.isReducedMotion) {
      return;
    }
    const maxHops = this.gameConfig.juice.impactWave.maxHops;
    const hops = new Map([[origin.id, 0]]);
    let frontier = [origin];
    for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
      const next = [];
      for (const ball of frontier) {
        for (const neighborId of ball.bonds) {
          const neighbor = this.physicsWorld.ballMap.get(neighborId);
          if (neighbor && !hops.has(neighborId)) {
            hops.set(neighborId, hop);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
    this.impactWave = { frame: 0, hops };
  }

  /** Advances the impact wave by one frame and sets each reached sphere's drawing scale. */
  updateImpactWave() {
    if (!this.impactWave) {
      return;
    }
    const waveCfg = this.gameConfig.juice.impactWave;
    const wave = this.impactWave;
    wave.frame++;
    if (wave.frame > waveCfg.maxHops * waveCfg.hopDelayFrames + waveCfg.durationFrames) {
      this.clearImpactWave();
      return;
    }
    for (const [ballId, hop] of wave.hops) {
      const ball = this.physicsWorld.ballMap.get(ballId);
      if (!ball) {
        continue;
      }
      const localFrame = wave.frame - hop * waveCfg.hopDelayFrames;
      const isSwelling = localFrame > 0 && localFrame < waveCfg.durationFrames;
      const envelope = isSwelling ? Math.sin((Math.PI * localFrame) / waveCfg.durationFrames) : 0;
      ball.impactScale = 1 + waveCfg.amplitude * Math.pow(waveCfg.hopFalloff, hop) * envelope;
    }
  }

  clearImpactWave() {
    if (!this.impactWave) {
      return;
    }
    for (const ballId of this.impactWave.hops.keys()) {
      const ball = this.physicsWorld.ballMap.get(ballId);
      if (ball) {
        ball.impactScale = 1;
      }
    }
    this.impactWave = null;
  }

  detachAndRewardAvalanche() {
    if (!this.isRunPlaying()) {
      return;
    }
    const detached = this.physicsWorld.detachUnanchoredBalls();
    if (detached.length > 0) {
      const scoring = this.gameConfig.scoring;
      const juice = this.gameConfig.juice;
      const dropPoints = detached.length * scoring.droppedBallPoints * Math.max(1, this.combo);
      this.addScore(dropPoints);
      this.addOvercharge(detached.length * scoring.overchargePerDroppedBall);

      let bonusCoins = detached.length * scoring.coinsPerAvalancheBall;
      for (const d of detached) {
        if (d.clusterModifier === CLUSTER_MODIFIERS.COIN_CORE) {
          bonusCoins += this.ballsConfig.clusterModifiers.coinCore.coinReward;
        }
      }
      this.awardRunCoins(bonusCoins);
      for (const d of detached) {
        if (d.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE) {
          this.rewardBossCore(d);
        }
      }
      if (detached.some((d) => d.clusterModifier === CLUSTER_MODIFIERS.LASER_LOCK)) {
        this.releaseBarriersWhenLocksCleared();
      }

      const sample = detached[0];
      this.particleSystem.spawnFloatingText(
        sample.x,
        sample.y,
        t('gameplay.feedback.drop.popup', { points: dropPoints }),
        this.gameConfig.theme.avalanchePopupColor
      );
      this.particleSystem.addScreenShake(juice.avalancheShake, juice.maxShakeOffset);

      if (detached.length >= this.gameConfig.achievements.firstAvalanche.threshold) {
        this.checkAndUnlockAchievement('firstAvalanche');
      }

      if (this.isSurvivalMode() && this.random() < scoring.specialDropChanceEndless) {
        this.grantRandomSpecialBall();
      }
    }
    this.crumbleLooseNeutralAnchors();
  }

  /**
   * A neutral anchor that no longer holds any ball crumbles away. Matches cannot break
   * it, so without this a board could never be cleared without a bomb or the anvil.
   */
  crumbleLooseNeutralAnchors() {
    const world = this.physicsWorld;
    const neutralSpec = this.ballsConfig.clusterModifiers.neutralAnchor;
    const loose = world.balls.filter(
      (ball) =>
        ball.clusterModifier === CLUSTER_MODIFIERS.NEUTRAL_ANCHOR &&
        ![...ball.bonds].some((id) => {
          // Rust holds nothing up for this rule: a neutral anchor holding only rust lets it fall.
          const neighbor = world.ballMap.get(id);
          return neighbor && !neighbor.isAnchor && neighbor.clusterModifier !== CLUSTER_MODIFIERS.RUST;
        })
    );
    for (const ball of loose) {
      this.particleSystem.spawnBurst(ball.x, ball.y, neutralSpec.ringColor, neutralSpec.crumbleBurstCount, neutralSpec.crumbleBurstSpeed);
      world.removeBall(ball);
    }
  }

  grantRandomSpecialBall() {
    const canvasCfg = this.gameConfig.canvas;
    const types = Object.values(SPECIAL_TYPES);
    const granted = types[Math.floor(this.random() * types.length)];
    const amount = this.gameConfig.scoring.specialChargePerMatch;
    this.specialInventory[granted] = (this.specialInventory[granted] || 0) + amount;
    this.audioManager.playEffect('overcharge');
    const specialName = t(`hud.powerups.${granted}.name`);
    this.particleSystem.spawnFloatingText(
      canvasCfg.launcherX,
      canvasCfg.launcherY + canvasCfg.launcherPopupOffsetY,
      t('gameplay.feedback.overcharge.ready', { name: specialName }),
      this.gameConfig.theme.overchargePopupColor
    );
  }

  shiftChameleonBalls() {
    if (this.activePalette.length < this.ballsConfig.clusterModifiers.chameleon.minPaletteSize) {
      return;
    }
    for (const ball of this.physicsWorld.balls) {
      if (ball.clusterModifier === CLUSTER_MODIFIERS.CHAMELEON) {
        const idx = this.activePalette.indexOf(ball.colorId);
        const nextIdx = (idx + 1) % this.activePalette.length;
        ball.colorId = this.activePalette[nextIdx];
      }
    }
  }

  addOvercharge(rawAmount) {
    if (!this.isRunPlaying()) {
      return;
    }
    const max = this.gameConfig.scoring.overchargeMax;
    this.overcharge += rawAmount * this.getOverchargeMultiplier();
    while (this.overcharge >= max) {
      this.overcharge -= max;
      this.grantRandomSpecialBall();
    }
  }

  /**
   * Fills the queue of upcoming launcher colors up to its configured length. Called when
   * a run starts, never while drawing, so seeded runs draw the same colors every time.
   */
  fillUpcomingColors() {
    const length = this.gameConfig.canvas.launcherPreviewCount;
    this.upcomingColorIds.length = Math.min(this.upcomingColorIds.length, length);
    while (this.upcomingColorIds.length < length) {
      this.upcomingColorIds.push(this.pickLauncherColor());
    }
  }

  /** Color of the next ball to load from the queue; the queue is topped up behind it. */
  takeUpcomingColor() {
    const color = this.upcomingColorIds.shift() || this.pickLauncherColor();
    this.fillUpcomingColors();
    return color;
  }

  /**
   * Recolors every regular launcher color that no longer exists on the board: the
   * current ball, the next ball, the queued colors and the color stashed behind an
   * equipped special, so neither a swap nor un-equipping a special can bring back a
   * cleared color.
   */
  refreshStaleLauncherColors() {
    const activeColors = new Set(this.physicsWorld.balls.map((b) => b.colorId).filter(Boolean));
    if (activeColors.size === 0) {
      return;
    }
    for (const launcherBall of [this.currentBall, this.nextBall]) {
      if (launcherBall && !launcherBall.specialType && !activeColors.has(launcherBall.colorId)) {
        launcherBall.colorId = this.pickLauncherColor();
      }
    }
    if (this.stashedRegularColorId && !activeColors.has(this.stashedRegularColorId)) {
      this.stashedRegularColorId = this.pickLauncherColor();
    }
    this.upcomingColorIds = this.upcomingColorIds.map((color) => (activeColors.has(color) ? color : this.pickLauncherColor()));
  }

  handlePostTurnCleanup(madeMatch, appliedFreeze = false) {
    // A Freeze Core that went off during this turn counts as a freeze applied this turn.
    const freezeAppliedThisTurn = appliedFreeze || this.isCoreFreezeApplied;
    this.isCoreFreezeApplied = false;
    this.detachAndRewardAvalanche();
    this.shiftChameleonBalls();

    this.refreshStaleLauncherColors();

    const wasFrozen = this.freezeTurnsRemaining > 0 || freezeAppliedThisTurn;
    if (!freezeAppliedThisTurn && this.freezeTurnsRemaining > 0) {
      this.freezeTurnsRemaining--;
      if (this.freezeTurnsRemaining === 0) {
        for (const b of this.physicsWorld.balls) {
          b.isFrozen = false;
        }
      }
    }

    if (this.isSurvivalMode() && !wasFrozen && !madeMatch) {
      this.shotsUntilWave--;
      if (this.shotsUntilWave <= 0) {
        this.spawnEndlessWave();
        this.shotsUntilWave = this.gameConfig.endless.shotsBeforeWave;
      }
    }

    this.evaluateRoundEnd();
    this.updateAimFromAngle(this.aimAngle);
    this.countDiscoveryTurn();
    this.refreshDiscovery();
    this.saveRunSnapshot();
    this.notifyUI();
  }

  findClosestBall(sourceBall, candidates) {
    if (!candidates || candidates.length === 0) {
      return null;
    }
    let closest = candidates[0];
    let minDist = Math.hypot(sourceBall.x - closest.x, sourceBall.y - closest.y);
    for (let i = 1; i < candidates.length; i++) {
      const d = Math.hypot(sourceBall.x - candidates[i].x, sourceBall.y - candidates[i].y);
      if (d < minDist) {
        minDist = d;
        closest = candidates[i];
      }
    }
    return closest;
  }

  spawnEndlessWave() {
    const endlessCfg = this.gameConfig.endless;
    this.waveCount++;
    this.endlessRowParity = (this.endlessRowParity + 1) % 2;

    const previousAnchors = [];
    for (const obs of this.physicsWorld.obstacles) {
      if (obs.type === OBSTACLE_TYPES.PIVOT) {
        obs.baseY += endlessCfg.descentStepY;
        obs.y += endlessCfg.descentStepY;
        obs.prevY += endlessCfg.descentStepY;
      }
    }
    for (const b of this.physicsWorld.balls) {
      if (b.pivotRef) {
        b.y += endlessCfg.descentStepY;
        b.prevY += endlessCfg.descentStepY;
        b.anchorY += endlessCfg.descentStepY;
        continue;
      }
      if (b.isAnchor) {
        previousAnchors.push(b);
      }
      b.isAnchor = false;
      b.y += endlessCfg.descentStepY;
      b.anchorY += endlessCfg.descentStepY;
    }

    const cols = endlessCfg.columns;
    const isBossWave = endlessCfg.bossWaveInterval > 0 && this.waveCount % endlessCfg.bossWaveInterval === 0;
    const isGoldRushWave = !isBossWave && endlessCfg.goldRushWaveInterval > 0 && this.waveCount % endlessCfg.goldRushWaveInterval === 0;
    let remainingGoldCores = isGoldRushWave ? endlessCfg.goldRushCoinCoreCount : 0;
    let bossCorePlaced = false;

    const newRowBalls = this.spawnEndlessRow(endlessCfg.startY, this.endlessRowParity, true, (col) => {
      if (isBossWave && !bossCorePlaced && col >= Math.floor(cols * MATH_CONSTANTS.HALF)) {
        bossCorePlaced = true;
        return CLUSTER_MODIFIERS.BOSS_CORE;
      }
      if (remainingGoldCores > 0) {
        remainingGoldCores--;
        return CLUSTER_MODIFIERS.COIN_CORE;
      }
      return this.rollEndlessModifier();
    });
    const newRowIds = new Set(newRowBalls.map((b) => b.id));

    this.physicsWorld.rebuildInitialBonds();

    if (newRowBalls.length > 0) {
      for (const oldAnchor of previousAnchors) {
        let linkedToNewRow = false;
        for (const neighborId of oldAnchor.bonds) {
          if (newRowIds.has(neighborId)) {
            linkedToNewRow = true;
            break;
          }
        }
        if (!linkedToNewRow) {
          const closest = this.findClosestBall(oldAnchor, newRowBalls);
          if (closest) {
            this.physicsWorld.createBond(oldAnchor, closest, false);
          }
        }
      }

      let anchoredSet = this.physicsWorld.getAnchoredBallIds();
      for (const ball of this.physicsWorld.balls) {
        if (!anchoredSet.has(ball.id)) {
          const closest = this.findClosestBall(ball, newRowBalls);
          if (closest) {
            this.physicsWorld.createBond(ball, closest, false);
            anchoredSet = this.physicsWorld.getAnchoredBallIds();
          }
        }
      }
    }

    if (this.waveCount >= this.gameConfig.achievements.survivorWave10.threshold) {
      this.checkAndUnlockAchievement('survivorWave10');
    }

    let waveBannerKey = 'gameplay.feedback.wave.incoming';
    let waveBannerColor = this.gameConfig.theme.wavePopupColor;
    if (isBossWave) {
      waveBannerKey = 'gameplay.feedback.wave.bossWave';
      waveBannerColor = this.gameConfig.theme.bossPopupColor;
    } else if (isGoldRushWave) {
      waveBannerKey = 'gameplay.feedback.wave.goldRush';
      waveBannerColor = this.gameConfig.theme.coinPopupColor;
    }

    this.particleSystem.spawnFloatingText(
      this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
      endlessCfg.startY + this.gameConfig.canvas.wavePopupOffsetY,
      t(waveBannerKey),
      waveBannerColor
    );
  }

  checkDangerLineBreach() {
    if (!this.isRunPlaying()) {
      return;
    }
    const dangerY = this.gameConfig.canvas.dangerLineY;
    for (const b of this.physicsWorld.balls) {
      if (!b.isDropping && b.y + b.radius >= dangerY) {
        const anchoredSet = this.physicsWorld.getAnchoredBallIds();
        if (!anchoredSet.has(b.id)) {
          this.detachAndRewardAvalanche();
          this.evaluateRoundEnd();
          this.notifyUI();
          return;
        }
        this.triggerGameOver(GAME_OVER_REASONS.LINE_CROSSED);
        return;
      }
    }
  }

  evaluateRoundEnd() {
    // A cleared Flux shape is paid once: later checks in the same frame see the empty
    // board of the transition, not a second clear.
    if (!this.isRunPlaying() || this.stageTransitionFrames > 0) {
      return;
    }
    if (this.mode === GAME_MODES.CAMPAIGN) {
      if (this.physicsWorld.balls.length === 0) {
        this.outOfShotsGraceFrames = 0;
        if (this.shotsRemaining >= this.gameConfig.achievements.sharpshooter.threshold) {
          this.checkAndUnlockAchievement('sharpshooter');
        }
        const bonus = this.shotsRemaining * this.gameConfig.scoring.remainingShotBonus;
        this.addScore(bonus);
        const stars = this.computeStars(this.score);
        const { newlyEarnedStars } = this.storageManager.saveLevelResult(this.currentLevelId, this.score, stars);
        const firstStarBonus = newlyEarnedStars * this.gameConfig.scoring.firstTimeStarCoinBonus;
        const earnedCoins = stars * this.gameConfig.scoring.coinsPerVictoryStar + firstStarBonus;
        this.storageManager.addCoins(earnedCoins);
        this.flushPendingRunCoins();
        const maxCampaignLevel = this.levelsConfig.levels.length;
        this.storageManager.unlockLevel(Math.min(this.currentLevelId + 1, maxCampaignLevel));
        if (this.storageManager.getTotalStars() >= this.gameConfig.achievements.starCollector.threshold) {
          this.checkAndUnlockAchievement('starCollector');
        }
        this.state = GAME_STATES.VICTORY;
        this.persistRunHighScore();
        this.storageManager.clearRunSnapshot();
        this.audioManager.playEffect('victory');
        this.victorySummary = { victoryBonus: bonus, stars, earnedCoins };
        this.victoryCelebrationFrames = this.gameConfig.victory.celebrationFrames;
        this.particleSystem.spawnFloatingText(
          this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
          this.gameConfig.canvas.logicalHeight * MATH_CONSTANTS.HALF,
          t('gameplay.feedback.victory.cleared'),
          this.gameConfig.theme.victoryPopupColor
        );
        this.notifyUI(this.victorySummary);
        return;
      }

      this.startOutOfShotsGraceIfNeeded();
    } else if (this.mode === GAME_MODES.FLUX) {
      if (this.physicsWorld.balls.length === 0) {
        this.outOfShotsGraceFrames = 0;
        this.completeFluxStage();
        return;
      }
      this.startOutOfShotsGraceIfNeeded();
    } else if (this.isSurvivalMode() && this.physicsWorld.balls.length === 0) {
      this.spawnEndlessWave();
    }
  }

  /**
   * With the reserve empty and nothing in flight, waits a short grace period for chain
   * reactions to clear the board before the run is lost (see update()).
   */
  startOutOfShotsGraceIfNeeded() {
    if (this.shotsRemaining <= 0 && !this.physicsWorld.projectile && this.outOfShotsGraceFrames === 0) {
      this.outOfShotsGraceFrames = this.physicsConfig.simulation.outOfShotsGraceFrames;
    }
  }

  triggerGameOver(reasonKey) {
    if (this.state === GAME_STATES.GAME_OVER || this.state === GAME_STATES.VICTORY) {
      return;
    }
    this.state = GAME_STATES.GAME_OVER;
    this.persistRunHighScore();
    this.flushPendingRunCoins();
    this.storageManager.clearRunSnapshot();
    this.audioManager.playEffect('gameOver');
    this.notifyUI({ gameOverReason: reasonKey });
  }

  /**
   * Star thresholds of the current level. A level that declares none gets them from its
   * starting sphere count (scoring.autoStarPointsPerBall), so a new level is playable
   * before its thresholds are tuned.
   */
  getStarThresholds() {
    const levelDef = this.levelsConfig.levels.find((l) => l.id === this.currentLevelId);
    if (levelDef?.starThresholds) {
      return levelDef.starThresholds;
    }
    const perBall = this.gameConfig.scoring.autoStarPointsPerBall;
    if (levelDef && perBall && this.levelStartBallCount > 0) {
      return perBall.map((points) => Math.round(points * this.levelStartBallCount));
    }
    return this.gameConfig.scoring.starThresholds;
  }

  computeStars(score) {
    const thresholds = this.getStarThresholds();
    let stars = this.gameConfig.scoring.minVictoryStars;
    for (let i = 0; i < thresholds.length; i++) {
      if (score >= thresholds[i]) {
        stars = i + 1;
      }
    }
    return Math.min(stars, this.gameConfig.scoring.maxStars);
  }

  /**
   * Adds mutator-scaled points to the running score. A no-op once the run has ended.
   * High scores are only persisted when the run ends or is left (see persistRunHighScore);
   * the HUD shows the larger of the stored best and the live score.
   */
  addScore(points) {
    if (!this.isRunPlaying()) {
      return;
    }
    let mult = 1.0;
    if (this.activeMutatorKey && this.gameConfig.daily?.mutators?.[this.activeMutatorKey]?.scoreMultiplier) {
      mult = this.gameConfig.daily.mutators[this.activeMutatorKey].scoreMultiplier;
    }
    this.score += Math.round(points * mult);
  }

  togglePause() {
    if (this.state === GAME_STATES.PLAYING) {
      this.state = GAME_STATES.PAUSED;
      this.notifyUI();
    } else if (this.state === GAME_STATES.PAUSED) {
      this.state = GAME_STATES.PLAYING;
      this.notifyUI();
    }
  }

  restartCurrent() {
    if (this.mode === GAME_MODES.CAMPAIGN) {
      this.startCampaignLevel(this.currentLevelId);
    } else if (this.mode === GAME_MODES.DAILY) {
      this.startDailyChallenge(this.dailySeedKey, true);
    } else if (this.mode === GAME_MODES.FLUX) {
      this.startFluxRun();
    } else {
      this.startEndlessMode();
    }
  }

  notifyUI(extra = {}) {
    if (this.onStateChange) {
      this.onStateChange(this, extra);
    }
  }
}

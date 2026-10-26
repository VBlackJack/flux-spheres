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
  LAYOUT_TYPES,
  DAILY_MUTATORS,
  MATH_CONSTANTS
} from '../core/Constants.js';
import { t } from '../core/I18n.js';
import { SeededRandom } from '../core/SeededRandom.js';
import { Ball } from '../entities/Ball.js';
import { Obstacle } from '../entities/Obstacle.js';
import { ParticleSystem } from '../entities/ParticleSystem.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { SpecialBallController } from './SpecialBallController.js';

export class GameEngine {
  constructor({ gameConfig, physicsConfig, ballsConfig, obstaclesConfig, levelsConfig, audioManager, storageManager, onStateChange }) {
    this.gameConfig = gameConfig;
    this.physicsConfig = physicsConfig;
    this.ballsConfig = ballsConfig;
    this.obstaclesConfig = obstaclesConfig;
    this.levelsConfig = levelsConfig;
    this.audioManager = audioManager;
    this.storageManager = storageManager;
    this.onStateChange = onStateChange;

    this.physicsWorld = new PhysicsWorld(physicsConfig, gameConfig, ballsConfig);
    this.particleSystem = new ParticleSystem(gameConfig.juice);
    if (this.storageManager && typeof this.storageManager.getReducedMotion === 'function') {
      this.particleSystem.setReducedMotion(this.storageManager.getReducedMotion());
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
    this.outOfShotsGraceFrames = 0;
    this.hitStopFrames = 0;
    this.trailFrameCounter = 0;
    this.hasFiredInRound = false;
    this.shotsFiredInLevel = 0;
    this.activeTutorialKey = null;
    this.levelTutorialKey = null;
    this.isAimCancelled = false;
    this.isPolarityFlipped = false;
    this.activeMutatorKey = null;
    this.seededRng = null;

    this.activePalette = [];
    this.specialInventory = {};
    this.currentBall = null;
    this.stashedRegularColorId = null;
    this.nextBall = null;
    this.aimAngle = -Math.PI * MATH_CONSTANTS.HALF;
    this.aimPoints = [];
  }

  random() {
    return this.seededRng ? this.seededRng.next() : Math.random();
  }

  isSurvivalMode() {
    return this.mode === GAME_MODES.ENDLESS || this.mode === GAME_MODES.DAILY;
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

  getLaserBonuses() {
    const lvl = this.storageManager.getUpgradeLevel('laserSight');
    const spec = this.gameConfig.upgrades.laserSight;
    return {
      distanceBonus: lvl * spec.distanceBonusPerLevel,
      bouncesBonus: lvl * spec.bouncesBonusPerLevel
    };
  }

  getStartingShotsBonus() {
    const lvl = this.storageManager.getUpgradeLevel('startingShots');
    const spec = this.gameConfig.upgrades.startingShots;
    return lvl * spec.shotsPerLevel;
  }

  createClusterBall(options) {
    const mod = options.clusterModifier || null;
    let initialArmor = 0;
    if (mod === CLUSTER_MODIFIERS.ARMORED) {
      initialArmor = this.ballsConfig.clusterModifiers.armored.initialArmor;
    } else if (mod === CLUSTER_MODIFIERS.BOSS_CORE) {
      initialArmor = this.ballsConfig.clusterModifiers.bossCore.initialArmor;
    }
    const safeColorId = options.specialType
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

    this.mode = GAME_MODES.CAMPAIGN;
    this.currentLevelId = levelDef.id;
    this.score = 0;
    this.combo = 0;
    this.overcharge = 0;
    this.shotsRemaining = levelDef.maxShots + this.getStartingShotsBonus();
    this.freezeTurnsRemaining = 0;
    this.chainCooldown = 0;
    this.outOfShotsGraceFrames = 0;
    this.hitStopFrames = 0;
    this.hasFiredInRound = false;
    this.shotsFiredInLevel = 0;
    this.activeTutorialKey = levelDef.tutorialKey || null;
    this.levelTutorialKey = levelDef.tutorialKey || null;
    this.isAimCancelled = false;
    this.isPolarityFlipped = false;
    this.activeMutatorKey = null;
    this.seededRng = null;
    this.specialInventory = { ...levelDef.specialInventory };
    this.stashedRegularColorId = null;

    this.activePalette = this.ballsConfig.standardColors
      .slice(0, levelDef.paletteCount)
      .map((c) => c.id);

    this.audioManager.stopAll();
    this.physicsWorld.clear();
    this.particleSystem.clear();

    for (const obsDef of levelDef.obstacles) {
      const obs = new Obstacle(obsDef, this.obstaclesConfig);
      this.physicsWorld.obstacles.push(obs);
    }

    this.buildLevelLayout(levelDef.layout, levelDef.modifierWeights || {});
    this.physicsWorld.rebuildInitialBonds();

    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    this.notifyUI();
  }

  startEndlessMode() {
    this.initSurvivalRun(GAME_MODES.ENDLESS, null);
  }

  startDailyChallenge(customSeed = null) {
    const seed = customSeed || SeededRandom.getTodayDateKey();
    this.initSurvivalRun(GAME_MODES.DAILY, seed);
    const bonusCoins = this.gameConfig.daily?.firstPlayBonusCoins || 0;
    if (bonusCoins > 0 && this.storageManager.claimDailyPlayBonus(seed, bonusCoins)) {
      this.audioManager.playEffect('achievement');
      this.particleSystem.spawnFloatingText(
        this.gameConfig.canvas.logicalWidth * MATH_CONSTANTS.HALF,
        this.gameConfig.canvas.launcherY + this.gameConfig.canvas.launcherPopupOffsetY,
        t('gameplay.feedback.dailyBonus.claimed', { coins: bonusCoins }),
        this.gameConfig.theme.coinPopupColor
      );
      this.notifyUI();
    }
  }

  initSurvivalRun(mode, seed = null) {
    const endlessCfg = this.gameConfig.endless;
    this.mode = mode;
    this.seededRng = seed ? new SeededRandom(seed) : null;
    this.score = 0;
    this.combo = 0;
    this.overcharge = 0;
    this.waveCount = 1;
    this.endlessRowParity = 0;
    this.shotsUntilWave = endlessCfg.shotsBeforeWave;
    this.freezeTurnsRemaining = 0;
    this.chainCooldown = 0;
    this.outOfShotsGraceFrames = 0;
    this.hitStopFrames = 0;
    this.hasFiredInRound = false;
    this.shotsFiredInLevel = 0;
    this.activeTutorialKey = null;
    this.levelTutorialKey = null;
    this.isAimCancelled = false;
    this.isPolarityFlipped = false;
    this.specialInventory = { ...endlessCfg.initialSpecialCounts };
    this.stashedRegularColorId = null;

    this.activePalette = this.ballsConfig.standardColors
      .slice(0, endlessCfg.paletteCount)
      .map((c) => c.id);

    this.audioManager.stopAll();
    this.physicsWorld.clear();
    this.particleSystem.clear();

    this.activeMutatorKey = null;
    if (mode === GAME_MODES.DAILY && this.gameConfig.daily?.mutators) {
      const mutatorKeys = Object.keys(this.gameConfig.daily.mutators);
      if (mutatorKeys.length > 0) {
        this.activeMutatorKey = mutatorKeys[Math.floor(this.random() * mutatorKeys.length)];
        const mutSpec = this.gameConfig.daily.mutators[this.activeMutatorKey];
        if (mutSpec.clusterGravityMultiplier) {
          this.physicsWorld.gravityMultiplier = mutSpec.clusterGravityMultiplier;
        }
        if (mutSpec.magnetismMultiplier) {
          this.physicsWorld.magnetismMultiplier = mutSpec.magnetismMultiplier;
        }
      }
    }

    const r = this.physicsConfig.ball.radius;
    const cols = endlessCfg.columns;
    const spacingX = r * this.physicsConfig.simulation.bondRestDistanceFactor;
    const totalW = (cols - 1) * spacingX;
    const startX = (this.gameConfig.canvas.logicalWidth - totalW) * MATH_CONSTANTS.HALF;

    for (let row = 0; row < endlessCfg.initialRows; row++) {
      const rowOffset = (row % 2) * r * MATH_CONSTANTS.HALF;
      const y = endlessCfg.startY + row * endlessCfg.rowSpacingY;
      for (let col = 0; col < cols; col++) {
        const isAnchor = row === 0 && endlessCfg.anchorColumns.includes(col);
        const ball = this.createClusterBall({
          x: startX + col * spacingX + rowOffset,
          y,
          radius: r,
          colorId: this.pickPaletteColor(),
          clusterModifier: isAnchor ? null : this.rollEndlessModifier(),
          isAnchor
        });
        this.physicsWorld.addBall(ball);
      }
    }

    if (mode === GAME_MODES.DAILY) {
      const leftSingularity = new Obstacle(
        { type: OBSTACLE_TYPES.SINGULARITY, x: r * 4, y: this.gameConfig.canvas.dangerLineY - r * 5 },
        this.obstaclesConfig
      );
      const rightSingularity = new Obstacle(
        {
          type: OBSTACLE_TYPES.SINGULARITY,
          x: this.gameConfig.canvas.logicalWidth - r * 4,
          y: this.gameConfig.canvas.dangerLineY - r * 5
        },
        this.obstaclesConfig
      );
      this.physicsWorld.obstacles.push(leftSingularity, rightSingularity);
    }

    this.physicsWorld.rebuildInitialBonds();
    this.currentBall = this.createRandomLauncherBall();
    this.nextBall = this.createRandomLauncherBall();
    this.state = GAME_STATES.PLAYING;
    const canvasCfg = this.gameConfig.canvas;
    this.updateAim(canvasCfg.launcherX, canvasCfg.launcherY + canvasCfg.initialAimOffsetY);
    this.notifyUI();
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
    let spawnChance = this.gameConfig.endless.modifierSpawnChance;
    if (this.activeMutatorKey === DAILY_MUTATORS.VOLATILE_CLUSTER) {
      const extra = this.gameConfig.daily?.mutators?.volatileCluster?.extraBombWeight || 0;
      if (this.random() < extra) {
        return CLUSTER_MODIFIERS.DORMANT_BOMB;
      }
    }
    if (this.random() > spawnChance) {
      return null;
    }
    const mods = [
      CLUSTER_MODIFIERS.ARMORED,
      CLUSTER_MODIFIERS.DORMANT_BOMB,
      CLUSTER_MODIFIERS.CHAMELEON,
      CLUSTER_MODIFIERS.COIN_CORE
    ];
    return mods[Math.floor(this.random() * mods.length)];
  }

  buildLevelLayout(layout, modifierWeights = {}) {
    const r = this.physicsConfig.ball.radius;
    const pivots = this.physicsWorld.obstacles.filter((o) => o.type === OBSTACLE_TYPES.PIVOT);
    const primaryPivot = pivots[0] || null;

    if (layout.type === LAYOUT_TYPES.PENDULUM) {
      for (const anchorPos of layout.anchors) {
        const anchorBall = this.createClusterBall({
          x: anchorPos.x,
          y: anchorPos.y,
          radius: r,
          colorId: this.pickPaletteColor(),
          isAnchor: true
        });
        this.physicsWorld.addBall(anchorBall);
      }

      for (let row = 0; row < layout.rows; row++) {
        const offset = (row % 2) * (layout.spacingX * MATH_CONSTANTS.HALF);
        for (let col = 0; col < layout.cols; col++) {
          const x = layout.startX + col * layout.spacingX + offset;
          const y = layout.startY + row * layout.spacingY;
          const ball = this.createClusterBall({
            x,
            y,
            radius: r,
            colorId: this.pickPaletteColor(),
            clusterModifier: this.rollModifier(modifierWeights),
            isAnchor: false
          });
          this.physicsWorld.addBall(ball);
        }
      }
    } else if (layout.type === LAYOUT_TYPES.RING) {
      this.spawnConcentricRings(layout.centerX, layout.centerY, layout.rings, primaryPivot, modifierWeights);
    } else if (layout.type === LAYOUT_TYPES.DUAL_RING) {
      layout.clusters.forEach((cluster, index) => {
        this.spawnConcentricRings(
          cluster.centerX,
          cluster.centerY,
          cluster.rings,
          pivots[index] || null,
          modifierWeights
        );
      });
    } else if (layout.type === LAYOUT_TYPES.HEXAGON) {
      const layers = layout.layers;
      const spacing = layout.spacing;
      for (let q = -layers; q <= layers; q++) {
        const r1 = Math.max(-layers, -q - layers);
        const r2 = Math.min(layers, -q + layers);
        for (let s = r1; s <= r2; s++) {
          if (q === 0 && s === 0) {
            continue;
          }
          const x = layout.centerX + spacing * (q + s * MATH_CONSTANTS.HALF);
          const y = layout.centerY + spacing * (Math.sqrt(3) * MATH_CONSTANTS.HALF * s);
          const dist = Math.hypot(x - layout.centerX, y - layout.centerY);
          const angle = Math.atan2(y - layout.centerY, x - layout.centerX);
          const isInner = Math.abs(q) <= 1 && Math.abs(s) <= 1 && Math.abs(q + s) <= 1;

          const ball = this.createClusterBall({
            x,
            y,
            radius: r,
            colorId: this.pickPaletteColor(),
            clusterModifier: isInner ? null : this.rollModifier(modifierWeights),
            isAnchor: isInner,
            pivotRef: isInner ? primaryPivot : null,
            pivotRadius: isInner ? dist : 0,
            pivotAngle: angle
          });
          this.physicsWorld.addBall(ball);
        }
      }
    } else if (layout.type === LAYOUT_TYPES.SPIRAL) {
      const arms = layout.arms;
      const ballsPerArm = layout.ballsPerArm;
      for (let arm = 0; arm < arms; arm++) {
        const baseAngle = (MATH_CONSTANTS.TWO_PI * arm) / arms;
        for (let step = 0; step < ballsPerArm; step++) {
          const dist = layout.startRadius + step * layout.radiusStep;
          const angle = baseAngle + step * layout.angleStep;
          const x = layout.centerX + Math.cos(angle) * dist;
          const y = layout.centerY + Math.sin(angle) * dist;
          const isInner = step === 0;

          const ball = this.createClusterBall({
            x,
            y,
            radius: r,
            colorId: this.pickPaletteColor(),
            clusterModifier: isInner ? null : this.rollModifier(modifierWeights),
            isAnchor: isInner,
            pivotRef: isInner ? primaryPivot : null,
            pivotRadius: isInner ? dist : 0,
            pivotAngle: angle
          });
          this.physicsWorld.addBall(ball);
        }
      }
    } else if (layout.type === LAYOUT_TYPES.CROSS) {
      const armLength = layout.armLength;
      const spacing = layout.spacing;
      const perpFactor = layout.perpSpacingFactor;
      const directions = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
      ];
      for (const dir of directions) {
        for (let step = 1; step <= armLength; step++) {
          for (let perp = -1; perp <= 1; perp++) {
            if (step === 1 && perp !== 0) {
              continue;
            }
            const x = layout.centerX + (dir.dx * step - dir.dy * perp * perpFactor) * spacing;
            const y = layout.centerY + (dir.dy * step + dir.dx * perp * perpFactor) * spacing;
            const dist = Math.hypot(x - layout.centerX, y - layout.centerY);
            const angle = Math.atan2(y - layout.centerY, x - layout.centerX);
            const isInner = step === 1;

            const ball = this.createClusterBall({
              x,
              y,
              radius: r,
              colorId: this.pickPaletteColor(),
              clusterModifier: isInner ? null : this.rollModifier(modifierWeights),
              isAnchor: isInner,
              pivotRef: isInner ? primaryPivot : null,
              pivotRadius: isInner ? dist : 0,
              pivotAngle: angle
            });
            this.physicsWorld.addBall(ball);
          }
        }
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

  createRandomLauncherBall(specialType = null) {
    return new Ball({
      x: this.gameConfig.canvas.launcherX,
      y: this.gameConfig.canvas.launcherY,
      radius: this.physicsConfig.ball.radius,
      colorId: specialType ? null : this.pickLauncherColor(),
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
      const restoredColor = this.stashedRegularColorId || this.pickLauncherColor();
      this.stashedRegularColorId = null;
      this.currentBall = new Ball({
        x: this.gameConfig.canvas.launcherX,
        y: this.gameConfig.canvas.launcherY,
        radius: this.physicsConfig.ball.radius,
        colorId: restoredColor,
        specialType: null,
        isProjectile: false
      });
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

  dismissTutorial() {
    if (this.activeTutorialKey) {
      this.activeTutorialKey = null;
      this.notifyUI();
    }
  }

  buySpecialAmmo(specialType) {
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

  adjustAimByDelta(deltaRad) {
    if (this.state !== GAME_STATES.PLAYING) {
      return;
    }
    this.isAimCancelled = false;
    const canvasCfg = this.gameConfig.canvas;
    const clamped = Math.max(-canvasCfg.maxAimAngleRad, Math.min(-canvasCfg.minAimAngleRad, this.aimAngle + deltaRad));
    this.updateAimFromAngle(clamped);
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

  shoot() {
    if (this.state !== GAME_STATES.PLAYING || this.physicsWorld.projectile || !this.currentBall) {
      return;
    }
    if (this.isAimCancelled) {
      this.isAimCancelled = false;
      return;
    }
    if (this.mode === GAME_MODES.CAMPAIGN && this.shotsRemaining <= 0) {
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
    this.stashedRegularColorId = null;
    this.currentBall = this.nextBall;
    this.nextBall = this.createRandomLauncherBall();

    if (this.mode === GAME_MODES.CAMPAIGN) {
      this.shotsRemaining = Math.max(0, this.shotsRemaining - 1);
    }

    this.hasFiredInRound = true;
    this.shotsFiredInLevel++;
    this.audioManager.playEffect('shoot');
    this.updateAimFromAngle(this.aimAngle);
    this.notifyUI();
  }

  update() {
    if (this.state !== GAME_STATES.PLAYING) {
      return;
    }

    const theme = this.gameConfig.theme;
    const juice = this.gameConfig.juice;

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

    this.physicsWorld.step({
      onBounce: (x, y) => {
        this.audioManager.playEffect('bounce');
        this.particleSystem.spawnBurst(
          x,
          y,
          theme.bounceParticleColor,
          juice.bounceBurstCount,
          juice.bounceBurstSpeed
        );
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
        this.handlePostTurnCleanup(true);
      },
      onProjectileSnapped: (snappedBall) => {
        this.handleProjectileSnapped(snappedBall);
      },
      onProjectileMissed: () => {
        this.combo = 0;
        this.handlePostTurnCleanup(false);
      },
      onSingularityCapture: (capturedBall, singularityObs) => {
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
    });

    if (!this.physicsWorld.projectile) {
      if (!this.isAimCancelled) {
        this.updateAimFromAngle(this.aimAngle);
      }
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
          this.triggerGameOver('outOfShots');
        }
      }
    }

    this.particleSystem.update(juice.shakeDecay);
    this.checkDangerLineBreach();
  }

  evaluateAutomaticChainReactions() {
    const candidates = this.physicsWorld.consumeChainCandidates();
    if (candidates.length === 0) {
      return;
    }

    const minMatch = this.gameConfig.defaults.matchMinCount;
    const scoring = this.gameConfig.scoring;
    const juice = this.gameConfig.juice;
    const theme = this.gameConfig.theme;
    const canvasCfg = this.gameConfig.canvas;
    let anyChainMatched = false;

    for (const candidate of candidates) {
      if (!this.physicsWorld.ballMap.has(candidate.id)) {
        continue;
      }
      const cluster = this.physicsWorld.findColorCluster(candidate);
      if (cluster.length >= minMatch) {
        anyChainMatched = true;
        this.combo = Math.min(
          this.combo + scoring.comboIncrement,
          scoring.maxComboMultiplier
        );
        const palette = this.ballsConfig.standardColors.find((c) => c.id === candidate.colorId);
        const burstColor = palette ? palette.highlight : theme.anchorCoreColor;

        let destroyedCount = 0;
        for (const member of cluster) {
          if (this.destroyClusterBall(member, burstColor, false)) {
            destroyedCount++;
          }
        }

        const basePoints = scoring.baseMatchPoints + (cluster.length - minMatch) * scoring.extraBallMultiplier;
        const points = basePoints * Math.max(1, destroyedCount) * this.combo;
        this.addScore(points);
        this.addOvercharge(destroyedCount * scoring.overchargePerMatchedBall);

        this.particleSystem.spawnFloatingText(
          candidate.x,
          candidate.y + canvasCfg.floatingTextOffsetY,
          t('gameplay.feedback.chain.popup', { points }),
          theme.chainPopupColor
        );
        this.particleSystem.addScreenShake(juice.matchShake, juice.maxShakeOffset);
        this.audioManager.playEffect('match', this.combo);
        if (this.combo >= juice.hitStopMinCombo) {
          this.hitStopFrames = juice.hitStopFramesCombo;
        }
        if (this.combo >= this.gameConfig.achievements.comboMaster.threshold) {
          this.checkAndUnlockAchievement('comboMaster');
        }
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
    if (!this.physicsWorld.ballMap.has(ball.id)) {
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
    this.physicsWorld.removeBall(ball);

    if (ball.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE) {
      const bossSpec = this.ballsConfig.clusterModifiers.bossCore;
      this.storageManager.addCoins(bossSpec.coinReward);
      this.addScore(bossSpec.pointsBonus);
      this.particleSystem.spawnShockwave(ball.x, ball.y, bossSpec.ringColor, bossSpec.shockwaveRadius);
      this.particleSystem.spawnFloatingText(
        ball.x,
        ball.y + canvasCfg.floatingTextOffsetY,
        t('gameplay.feedback.boss.destroyed', { coins: bossSpec.coinReward }),
        this.gameConfig.theme.bossPopupColor
      );
      this.checkAndUnlockAchievement('bossSlayer');
    } else if (ball.clusterModifier === CLUSTER_MODIFIERS.COIN_CORE) {
      const reward = this.ballsConfig.clusterModifiers.coinCore.coinReward;
      this.storageManager.addCoins(reward);
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
      const anyLockRemaining = this.physicsWorld.balls.some(
        (b) => b.clusterModifier === CLUSTER_MODIFIERS.LASER_LOCK
      );
      if (!anyLockRemaining) {
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
    }

    return true;
  }

  handleProjectileSnapped(snappedBall) {
    this.audioManager.playEffect('snap');

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
    const scoring = this.gameConfig.scoring;
    const juice = this.gameConfig.juice;

    if (cluster.length >= minMatch) {
      this.combo = Math.min(
        this.combo + scoring.comboIncrement,
        scoring.maxComboMultiplier
      );

      const palette = this.ballsConfig.standardColors.find((c) => c.id === snappedBall.colorId);
      const burstColor = palette ? palette.highlight : this.gameConfig.theme.anchorCoreColor;

      let destroyedCount = 0;
      for (const member of cluster) {
        if (this.destroyClusterBall(member, burstColor, false)) {
          destroyedCount++;
        }
      }

      const basePoints = scoring.baseMatchPoints + (cluster.length - minMatch) * scoring.extraBallMultiplier;
      const points = basePoints * Math.max(1, destroyedCount) * this.combo;
      this.addScore(points);
      this.addOvercharge(destroyedCount * scoring.overchargePerMatchedBall);
      this.particleSystem.addScreenShake(juice.matchShake, juice.maxShakeOffset);

      if (this.combo > 1) {
        this.particleSystem.spawnFloatingText(
          snappedBall.x,
          snappedBall.y + this.gameConfig.canvas.floatingTextOffsetY,
          t('gameplay.feedback.combo.popup', { combo: this.combo, points }),
          burstColor
        );
      }

      if (this.combo >= juice.hitStopMinCombo) {
        this.hitStopFrames = juice.hitStopFramesCombo;
      }
      if (this.combo >= this.gameConfig.achievements.comboMaster.threshold) {
        this.checkAndUnlockAchievement('comboMaster');
      }

      this.audioManager.playEffect('match', this.combo);
      this.handlePostTurnCleanup(true);
    } else {
      this.combo = 0;
      this.handlePostTurnCleanup(false);
    }
  }

  detachAndRewardAvalanche() {
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
      if (bonusCoins > 0) {
        this.storageManager.addCoins(bonusCoins);
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
    if (this.activePalette.length < 2) {
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
    const max = this.gameConfig.scoring.overchargeMax;
    this.overcharge += rawAmount * this.getOverchargeMultiplier();
    while (this.overcharge >= max) {
      this.overcharge -= max;
      this.grantRandomSpecialBall();
    }
  }

  handlePostTurnCleanup(madeMatch, appliedFreeze = false) {
    this.detachAndRewardAvalanche();
    this.shiftChameleonBalls();

    if (this.currentBall && !this.currentBall.specialType && this.physicsWorld.balls.length > 0) {
      const activeColors = new Set(this.physicsWorld.balls.map((b) => b.colorId).filter(Boolean));
      if (activeColors.size > 0 && !activeColors.has(this.currentBall.colorId)) {
        this.currentBall.colorId = this.pickLauncherColor();
      }
    }

    const wasFrozen = this.freezeTurnsRemaining > 0 || appliedFreeze;
    if (!appliedFreeze && this.freezeTurnsRemaining > 0) {
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
    const r = this.physicsConfig.ball.radius;
    this.waveCount++;
    this.endlessRowParity = (this.endlessRowParity + 1) % 2;

    const previousAnchors = [];
    for (const b of this.physicsWorld.balls) {
      if (b.isAnchor) {
        previousAnchors.push(b);
      }
      b.isAnchor = false;
      b.y += endlessCfg.descentStepY;
      b.anchorY += endlessCfg.descentStepY;
    }

    const cols = endlessCfg.columns;
    const spacingX = r * this.physicsConfig.simulation.bondRestDistanceFactor;
    const totalW = (cols - 1) * spacingX;
    const startX = (this.gameConfig.canvas.logicalWidth - totalW) * MATH_CONSTANTS.HALF;
    const rowOffset = this.endlessRowParity * r * MATH_CONSTANTS.HALF;

    const isBossWave = endlessCfg.bossWaveInterval > 0 && this.waveCount % endlessCfg.bossWaveInterval === 0;
    const isGoldRushWave = !isBossWave && endlessCfg.goldRushWaveInterval > 0 && this.waveCount % endlessCfg.goldRushWaveInterval === 0;
    let remainingGoldCores = isGoldRushWave ? endlessCfg.goldRushCoinCoreCount : 0;
    let bossCorePlaced = false;

    const newRowBalls = [];
    const newRowIds = new Set();
    for (let col = 0; col < cols; col++) {
      const isAnchor = endlessCfg.anchorColumns.includes(col);
      let modifier = null;
      if (!isAnchor) {
        if (isBossWave && !bossCorePlaced && col >= Math.floor(cols * MATH_CONSTANTS.HALF)) {
          modifier = CLUSTER_MODIFIERS.BOSS_CORE;
          bossCorePlaced = true;
        } else if (remainingGoldCores > 0) {
          modifier = CLUSTER_MODIFIERS.COIN_CORE;
          remainingGoldCores--;
        } else {
          modifier = this.rollEndlessModifier();
        }
      }
      const newBall = this.createClusterBall({
        x: startX + col * spacingX + rowOffset,
        y: endlessCfg.startY,
        radius: r,
        colorId: this.pickPaletteColor(),
        clusterModifier: modifier,
        isAnchor
      });
      this.physicsWorld.addBall(newBall);
      newRowBalls.push(newBall);
      newRowIds.add(newBall.id);
    }

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
    const dangerY = this.gameConfig.canvas.dangerLineY;
    for (const b of this.physicsWorld.balls) {
      if (!b.isDropping && b.y + b.radius >= dangerY) {
        this.triggerGameOver('lineCrossed');
        return;
      }
    }
  }

  evaluateRoundEnd() {
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
        this.storageManager.unlockLevel(this.currentLevelId + 1);
        if (this.storageManager.getTotalStars() >= this.gameConfig.achievements.starCollector.threshold) {
          this.checkAndUnlockAchievement('starCollector');
        }
        this.state = GAME_STATES.VICTORY;
        this.audioManager.playEffect('victory');
        this.notifyUI({ victoryBonus: bonus, stars, earnedCoins });
        return;
      }

      if (this.shotsRemaining <= 0 && !this.physicsWorld.projectile && this.outOfShotsGraceFrames === 0) {
        this.outOfShotsGraceFrames = this.physicsConfig.simulation.outOfShotsGraceFrames;
      }
    } else if (this.isSurvivalMode() && this.physicsWorld.balls.length === 0) {
      this.spawnEndlessWave();
    }
  }

  triggerGameOver(reasonKey) {
    if (this.state === GAME_STATES.GAME_OVER) {
      return;
    }
    this.state = GAME_STATES.GAME_OVER;
    this.audioManager.playEffect('gameOver');
    this.notifyUI({ gameOverReason: reasonKey });
  }

  computeStars(score) {
    const levelDef = this.levelsConfig.levels.find((l) => l.id === this.currentLevelId);
    const thresholds = levelDef?.starThresholds || this.gameConfig.scoring.starThresholds;
    let stars = 1;
    for (let i = 0; i < thresholds.length; i++) {
      if (score >= thresholds[i]) {
        stars = i + 1;
      }
    }
    return Math.min(stars, this.gameConfig.scoring.maxStars);
  }

  addScore(points) {
    let mult = 1.0;
    if (this.activeMutatorKey && this.gameConfig.daily?.mutators?.[this.activeMutatorKey]?.scoreMultiplier) {
      mult = this.gameConfig.daily.mutators[this.activeMutatorKey].scoreMultiplier;
    }
    this.score += Math.round(points * mult);
    if (this.mode === GAME_MODES.ENDLESS) {
      this.storageManager.setEndlessHighScore(this.score);
    } else if (this.mode === GAME_MODES.DAILY) {
      this.storageManager.setDailyHighScore(this.score);
    }
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
      this.startDailyChallenge();
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

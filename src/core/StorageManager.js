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

import { configRegistry } from './ConfigRegistry.js';

export class StorageManager {
  constructor() {
    this.storageConfig = null;
    this.defaultsConfig = null;
    this.upgradesConfig = null;
  }

  init() {
    const gameConfig = configRegistry.get('game');
    this.storageConfig = gameConfig.storage;
    this.defaultsConfig = gameConfig.defaults;
    this.upgradesConfig = gameConfig.upgrades;
    this.achievementsConfig = gameConfig.achievements || {};
  }

  buildKey(shortKey) {
    return `${this.storageConfig.prefix}${shortKey}`;
  }

  getLanguage() {
    const raw = localStorage.getItem(this.buildKey(this.storageConfig.keys.language));
    return raw || this.defaultsConfig.language;
  }

  setLanguage(lang) {
    localStorage.setItem(this.buildKey(this.storageConfig.keys.language), lang);
  }

  getMuted() {
    const raw = localStorage.getItem(this.buildKey(this.storageConfig.keys.muted));
    return raw === 'true';
  }

  setMuted(muted) {
    localStorage.setItem(this.buildKey(this.storageConfig.keys.muted), String(Boolean(muted)));
  }

  getHighContrast() {
    const raw = localStorage.getItem(this.buildKey(this.storageConfig.keys.highContrast));
    return raw === 'true';
  }

  setHighContrast(enabled) {
    localStorage.setItem(this.buildKey(this.storageConfig.keys.highContrast), String(Boolean(enabled)));
  }

  getUnlockedLevel() {
    const raw = localStorage.getItem(this.buildKey(this.storageConfig.keys.unlockedLevel));
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : this.defaultsConfig.initialUnlockedLevel;
  }

  unlockLevel(levelId) {
    const current = this.getUnlockedLevel();
    if (levelId > current) {
      localStorage.setItem(this.buildKey(this.storageConfig.keys.unlockedLevel), String(levelId));
    }
  }

  getLevelStats() {
    const raw = localStorage.getItem(this.buildKey(this.storageConfig.keys.levelStats));
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  saveLevelResult(levelId, score, stars) {
    const stats = this.getLevelStats();
    const existing = stats[levelId] || { bestScore: 0, stars: 0 };
    const newlyEarnedStars = Math.max(0, stars - existing.stars);
    stats[levelId] = {
      bestScore: Math.max(existing.bestScore, score),
      stars: Math.max(existing.stars, stars)
    };
    localStorage.setItem(this.buildKey(this.storageConfig.keys.levelStats), JSON.stringify(stats));
    return { newlyEarnedStars };
  }

  getTotalStars() {
    const stats = this.getLevelStats();
    let total = 0;
    for (const entry of Object.values(stats)) {
      total += entry.stars || 0;
    }
    return total;
  }

  getUnlockedAchievements() {
    const raw = localStorage.getItem(this.buildKey(this.storageConfig.keys.achievements));
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  unlockAchievement(achievementId) {
    const spec = this.achievementsConfig[achievementId];
    if (!spec) {
      return false;
    }
    const unlocked = this.getUnlockedAchievements();
    if (unlocked[achievementId]) {
      return false;
    }
    unlocked[achievementId] = true;
    localStorage.setItem(this.buildKey(this.storageConfig.keys.achievements), JSON.stringify(unlocked));
    if (spec.rewardCoins > 0) {
      this.addCoins(spec.rewardCoins);
    }
    return true;
  }

  getEndlessHighScore() {
    const raw = localStorage.getItem(this.buildKey(this.storageConfig.keys.endlessHighScore));
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  setEndlessHighScore(score) {
    const current = this.getEndlessHighScore();
    if (score > current) {
      localStorage.setItem(this.buildKey(this.storageConfig.keys.endlessHighScore), String(score));
    }
  }

  getCoins() {
    const raw = localStorage.getItem(this.buildKey(this.storageConfig.keys.coins));
    if (raw === null) {
      return this.defaultsConfig.initialCoins;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : this.defaultsConfig.initialCoins;
  }

  setCoins(amount) {
    localStorage.setItem(this.buildKey(this.storageConfig.keys.coins), String(Math.max(0, Math.floor(amount))));
  }

  addCoins(delta) {
    const updated = this.getCoins() + delta;
    this.setCoins(updated);
    return updated;
  }

  getUpgrades() {
    const raw = localStorage.getItem(this.buildKey(this.storageConfig.keys.upgrades));
    let parsed = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {};
      }
    }
    const result = {};
    for (const key of Object.keys(this.upgradesConfig)) {
      result[key] = Number.isFinite(parsed[key]) ? parsed[key] : 0;
    }
    return result;
  }

  getUpgradeLevel(upgradeKey) {
    return this.getUpgrades()[upgradeKey] || 0;
  }

  getUpgradeCost(upgradeKey) {
    const spec = this.upgradesConfig[upgradeKey];
    if (!spec) {
      return Infinity;
    }
    const lvl = this.getUpgradeLevel(upgradeKey);
    return spec.baseCost + lvl * spec.costStep;
  }

  purchaseUpgrade(upgradeKey) {
    const spec = this.upgradesConfig[upgradeKey];
    if (!spec) {
      return false;
    }
    const currentLevel = this.getUpgradeLevel(upgradeKey);
    if (currentLevel >= spec.maxLevel) {
      return false;
    }
    const cost = this.getUpgradeCost(upgradeKey);
    const coins = this.getCoins();
    if (coins < cost) {
      return false;
    }
    this.setCoins(coins - cost);
    const upgrades = this.getUpgrades();
    upgrades[upgradeKey] = currentLevel + 1;
    localStorage.setItem(this.buildKey(this.storageConfig.keys.upgrades), JSON.stringify(upgrades));
    return true;
  }
}

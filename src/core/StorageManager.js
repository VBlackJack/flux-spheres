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
import { SeededRandom } from './SeededRandom.js';

/**
 * Manages persistent player progress, settings, currency, and upgrades
 * with an automatic in-memory fallback when localStorage is unavailable.
 */
export class StorageManager {
  constructor() {
    this.storageConfig = null;
    this.defaultsConfig = null;
    this.upgradesConfig = null;
    this.achievementsConfig = null;
    this.maxCampaignLevel = null;
    this.memoryFallback = new Map();
    this.upgradesCache = null;
  }

  init() {
    const gameConfig = configRegistry.get('game');
    const levelsConfig = configRegistry.get('levels');
    this.storageConfig = gameConfig.storage;
    this.defaultsConfig = gameConfig.defaults;
    this.upgradesConfig = gameConfig.upgrades;
    this.achievementsConfig = gameConfig.achievements || {};
    this.maxCampaignLevel = levelsConfig.levels.length;
    this.upgradesCache = null;
  }

  buildKey(shortKey) {
    return `${this.storageConfig.prefix}${shortKey}`;
  }

  safeGetItem(shortKey) {
    const fullKey = this.buildKey(shortKey);
    try {
      const val = localStorage.getItem(fullKey);
      if (val !== null) {
        return val;
      }
    } catch {
      // Fallback to in-memory storage when localStorage is restricted
    }
    return this.memoryFallback.has(fullKey) ? this.memoryFallback.get(fullKey) : null;
  }

  safeSetItem(shortKey, value) {
    const fullKey = this.buildKey(shortKey);
    const strValue = String(value);
    this.memoryFallback.set(fullKey, strValue);
    try {
      localStorage.setItem(fullKey, strValue);
    } catch {
      // Ignore storage quota or security restrictions; kept in memoryFallback
    }
  }

  getLanguage() {
    const raw = this.safeGetItem(this.storageConfig.keys.language);
    return raw || this.defaultsConfig.language;
  }

  setLanguage(lang) {
    this.safeSetItem(this.storageConfig.keys.language, lang);
  }

  getMuted() {
    const raw = this.safeGetItem(this.storageConfig.keys.muted);
    return raw === 'true';
  }

  setMuted(muted) {
    this.safeSetItem(this.storageConfig.keys.muted, Boolean(muted));
  }

  getHighContrast() {
    const raw = this.safeGetItem(this.storageConfig.keys.highContrast);
    return raw === 'true';
  }

  setHighContrast(enabled) {
    this.safeSetItem(this.storageConfig.keys.highContrast, Boolean(enabled));
  }

  getReducedMotion() {
    const raw = this.safeGetItem(this.storageConfig.keys.reducedMotion);
    if (raw !== null) {
      return raw === 'true';
    }
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    return false;
  }

  setReducedMotion(enabled) {
    this.safeSetItem(this.storageConfig.keys.reducedMotion, Boolean(enabled));
  }

  hasPlayedDailyToday(dateKey) {
    const lastDate = this.safeGetItem(this.storageConfig.keys.dailyLastPlayedDate);
    return lastDate === dateKey;
  }

  claimDailyPlayBonus(dateKey, bonusCoins) {
    if (this.hasPlayedDailyToday(dateKey)) {
      return false;
    }
    this.safeSetItem(this.storageConfig.keys.dailyLastPlayedDate, dateKey);
    if (bonusCoins > 0) {
      this.addCoins(bonusCoins);
    }
    return true;
  }

  getUnlockedLevel() {
    const raw = this.safeGetItem(this.storageConfig.keys.unlockedLevel);
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return this.defaultsConfig.initialUnlockedLevel;
    }
    return Math.min(parsed, this.maxCampaignLevel);
  }

  unlockLevel(levelId) {
    const clamped = Math.min(levelId, this.maxCampaignLevel);
    const current = this.getUnlockedLevel();
    if (clamped > current) {
      this.safeSetItem(this.storageConfig.keys.unlockedLevel, clamped);
    }
  }

  getLevelStats() {
    const raw = this.safeGetItem(this.storageConfig.keys.levelStats);
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
    this.safeSetItem(this.storageConfig.keys.levelStats, JSON.stringify(stats));
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
    const raw = this.safeGetItem(this.storageConfig.keys.achievements);
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
    this.safeSetItem(this.storageConfig.keys.achievements, JSON.stringify(unlocked));
    if (spec.rewardCoins > 0) {
      this.addCoins(spec.rewardCoins);
    }
    return true;
  }

  getEndlessHighScore() {
    const raw = this.safeGetItem(this.storageConfig.keys.endlessHighScore);
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  setEndlessHighScore(score) {
    const current = this.getEndlessHighScore();
    if (score > current) {
      this.safeSetItem(this.storageConfig.keys.endlessHighScore, score);
    }
  }

  getDailyHighScore(dateKey = SeededRandom.getTodayDateKey()) {
    const savedDate = this.safeGetItem(this.storageConfig.keys.dailyBestDate);
    if (savedDate !== dateKey) {
      return 0;
    }
    const raw = this.safeGetItem(this.storageConfig.keys.dailyBest);
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  setDailyHighScore(score, dateKey = SeededRandom.getTodayDateKey()) {
    const current = this.getDailyHighScore(dateKey);
    const savedDate = this.safeGetItem(this.storageConfig.keys.dailyBestDate);
    if (savedDate !== dateKey || score > current) {
      this.safeSetItem(this.storageConfig.keys.dailyBestDate, dateKey);
      this.safeSetItem(this.storageConfig.keys.dailyBest, Math.max(0, Math.floor(score)));
    }
  }

  getCoins() {
    const raw = this.safeGetItem(this.storageConfig.keys.coins);
    if (raw === null) {
      return this.defaultsConfig.initialCoins;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : this.defaultsConfig.initialCoins;
  }

  setCoins(amount) {
    this.safeSetItem(this.storageConfig.keys.coins, Math.max(0, Math.floor(amount)));
  }

  addCoins(delta) {
    const updated = this.getCoins() + delta;
    this.setCoins(updated);
    return updated;
  }

  getUpgrades() {
    if (this.upgradesCache) {
      return { ...this.upgradesCache };
    }
    const raw = this.safeGetItem(this.storageConfig.keys.upgrades);
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
      result[key] = Number.isFinite(parsed[key]) && parsed[key] >= 0 ? parsed[key] : 0;
    }
    this.upgradesCache = result;
    return { ...this.upgradesCache };
  }

  getUpgradeLevel(upgradeKey) {
    if (!this.upgradesCache) {
      this.getUpgrades();
    }
    return this.upgradesCache[upgradeKey] || 0;
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
    this.upgradesCache = upgrades;
    this.safeSetItem(this.storageConfig.keys.upgrades, JSON.stringify(upgrades));
    return true;
  }
}

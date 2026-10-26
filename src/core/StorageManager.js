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
    this.isCrossTabSyncBound = false;
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
    this.bindCrossTabSync();
  }

  /**
   * Keeps the in-memory copy in step with other tabs of the game. The browser fires a
   * `storage` event in every other tab on each write; without it each tab kept the values
   * it first read and wrote them back over progress made elsewhere (coins, upgrades...).
   */
  bindCrossTabSync() {
    if (this.isCrossTabSyncBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return;
    }
    window.addEventListener('storage', (event) => this.handleExternalStorageChange(event));
    this.isCrossTabSyncBound = true;
  }

  /**
   * Applies a write made by another tab. A cleared storage (key null) drops every cached value.
   * @param {{key: string|null, newValue: string|null}} event - The `storage` event.
   */
  handleExternalStorageChange(event) {
    if (event.key === null) {
      this.memoryFallback.clear();
      this.upgradesCache = null;
      return;
    }
    if (!event.key.startsWith(this.storageConfig.prefix)) {
      return;
    }
    if (event.newValue === null) {
      this.memoryFallback.delete(event.key);
    } else {
      this.memoryFallback.set(event.key, event.newValue);
    }
    if (event.key === this.buildKey(this.storageConfig.keys.upgrades)) {
      this.upgradesCache = null;
    }
  }

  buildKey(shortKey) {
    return `${this.storageConfig.prefix}${shortKey}`;
  }

  /**
   * Reads a value with the in-memory copy as the source of truth, so a write that
   * localStorage rejected (quota, security) is never shadowed by an older persisted value.
   * The memory copy is seeded from localStorage on the first read of each key.
   */
  safeGetItem(shortKey) {
    const fullKey = this.buildKey(shortKey);
    if (this.memoryFallback.has(fullKey)) {
      return this.memoryFallback.get(fullKey);
    }
    let val = null;
    try {
      val = localStorage.getItem(fullKey);
    } catch {
      // localStorage is restricted; only the in-memory copy is available
    }
    if (val !== null) {
      this.memoryFallback.set(fullKey, val);
    }
    return val;
  }

  /**
   * Parses a stored JSON value and only accepts a plain object; any other shape
   * (null, array, number, string, corrupted text) yields an empty object.
   */
  readJsonObject(shortKey) {
    const raw = this.safeGetItem(shortKey);
    if (!raw) {
      return {};
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    return StorageManager.isPlainObject(parsed) ? parsed : {};
  }

  static isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  static toNonNegativeNumber(value) {
    return Number.isFinite(value) && value >= 0 ? value : 0;
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

  getStoredLanguage() {
    return this.safeGetItem(this.storageConfig.keys.language);
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
      return Boolean(window.matchMedia(this.defaultsConfig.reducedMotionMediaQuery).matches);
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
    const parsed = this.readJsonObject(this.storageConfig.keys.levelStats);
    const stats = {};
    for (const [levelId, entry] of Object.entries(parsed)) {
      if (!StorageManager.isPlainObject(entry)) {
        continue;
      }
      stats[levelId] = {
        bestScore: StorageManager.toNonNegativeNumber(entry.bestScore),
        stars: StorageManager.toNonNegativeNumber(entry.stars)
      };
    }
    return stats;
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
      total += entry.stars;
    }
    return total;
  }

  getUnlockedAchievements() {
    const parsed = this.readJsonObject(this.storageConfig.keys.achievements);
    const unlocked = {};
    for (const [achievementId, value] of Object.entries(parsed)) {
      if (value === true) {
        unlocked[achievementId] = true;
      }
    }
    return unlocked;
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

  readNonNegativeInt(shortKey) {
    const parsed = Number.parseInt(this.safeGetItem(shortKey), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  getFluxHighScore() {
    return this.readNonNegativeInt(this.storageConfig.keys.fluxHighScore);
  }

  getFluxBestStage() {
    return this.readNonNegativeInt(this.storageConfig.keys.fluxBestStage);
  }

  /**
   * Keeps the best Flux score and the furthest Flux stage, each on its own: the deepest
   * run is not always the highest-scoring one.
   */
  setFluxRecord(score, stage) {
    if (score > this.getFluxHighScore()) {
      this.safeSetItem(this.storageConfig.keys.fluxHighScore, Math.floor(score));
    }
    if (stage > this.getFluxBestStage()) {
      this.safeSetItem(this.storageConfig.keys.fluxBestStage, Math.floor(stage));
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
    const parsed = this.readJsonObject(this.storageConfig.keys.upgrades);
    const result = {};
    for (const key of Object.keys(this.upgradesConfig)) {
      result[key] = StorageManager.toNonNegativeNumber(parsed[key]);
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

  getRunSnapshotVersion() {
    return this.storageConfig.runSnapshotVersion;
  }

  /** Returns the saved run as a plain object, or null when none is stored or it is unreadable. */
  loadRunSnapshot() {
    const parsed = this.readJsonObject(this.storageConfig.keys.runSnapshot);
    return Object.keys(parsed).length > 0 ? parsed : null;
  }

  saveRunSnapshot(snapshot) {
    this.safeSetItem(this.storageConfig.keys.runSnapshot, JSON.stringify(snapshot));
  }

  clearRunSnapshot() {
    const fullKey = this.buildKey(this.storageConfig.keys.runSnapshot);
    this.memoryFallback.delete(fullKey);
    try {
      localStorage.removeItem(fullKey);
    } catch {
      // localStorage is restricted; the in-memory copy is already gone
    }
  }
}

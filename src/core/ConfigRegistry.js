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

import { CONFIG_PATHS, DATA_FETCH_OPTIONS } from './Constants.js';
import { applyWorldGeometry } from './WorldGeometry.js';

/**
 * Settings that must be strictly positive numbers: zero or a negative value would loop
 * forever (overcharge payout, fixed-step accumulator) or freeze the simulation.
 */
const POSITIVE_SETTINGS = Object.freeze([
  ['game', 'scoring.overchargeMax'],
  ['game', 'juice.slowMotion.timeScale'],
  ['physics', 'simulation.fixedStepMs'],
  ['physics', 'simulation.maxAccumulatedMs']
]);

/**
 * Throws when a setting listed in POSITIVE_SETTINGS is missing or not a positive number,
 * so a broken config stops at startup with the loading error instead of hanging the game.
 * @param {Map<string, object>} configs - Loaded configs by namespace.
 */
export function validateConfigs(configs) {
  for (const [namespace, path] of POSITIVE_SETTINGS) {
    const value = path.split('.').reduce((node, key) => node?.[key], configs.get(namespace));
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid config ${namespace}.${path}: expected a positive number, got ${value}`);
    }
  }
}

class ConfigRegistry {
  constructor() {
    this.configs = new Map();
    this.loaded = false;
  }

  async loadAll() {
    const entries = Object.entries(CONFIG_PATHS);
    const results = await Promise.all(
      entries.map(async ([key, path]) => {
        const response = await fetch(path, DATA_FETCH_OPTIONS);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${path}`);
        }
        const data = await response.json();
        return [key.toLowerCase(), data];
      })
    );

    for (const [key, data] of results) {
      this.configs.set(key, data);
    }
    validateConfigs(this.configs);
    applyWorldGeometry(this.configs.get('game'));
    this.loaded = true;
  }

  get(namespace) {
    return this.configs.get(namespace.toLowerCase());
  }
}

export const configRegistry = new ConfigRegistry();

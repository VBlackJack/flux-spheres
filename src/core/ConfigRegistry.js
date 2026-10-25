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

import { CONFIG_PATHS } from './Constants.js';

class ConfigRegistry {
  constructor() {
    this.configs = new Map();
    this.loaded = false;
  }

  async loadAll() {
    const entries = Object.entries(CONFIG_PATHS);
    const results = await Promise.all(
      entries.map(async ([key, path]) => {
        const response = await fetch(path);
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
    this.loaded = true;
  }

  get(namespace) {
    return this.configs.get(namespace.toLowerCase());
  }
}

export const configRegistry = new ConfigRegistry();

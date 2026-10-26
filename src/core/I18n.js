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

import { LOCALE_PATHS } from './Constants.js';

class I18nService {
  constructor() {
    this.dictionaries = new Map();
    this.currentLocale = 'fr';
    this.listeners = new Set();
  }

  async init(initialLocale) {
    const entries = Object.entries(LOCALE_PATHS);
    await Promise.all(
      entries.map(async ([locale, path]) => {
        const response = await fetch(path);
        if (response.ok) {
          const json = await response.json();
          this.dictionaries.set(locale, json);
        }
      })
    );
    if (this.dictionaries.has(initialLocale)) {
      this.currentLocale = initialLocale;
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = this.currentLocale;
    }
    this.translateDOM();
  }

  setLocale(locale) {
    if (!this.dictionaries.has(locale)) {
      return;
    }
    this.currentLocale = locale;
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = locale;
    }
    this.translateDOM();
    for (const callback of this.listeners) {
      callback(locale);
    }
  }

  getLocale() {
    return this.currentLocale;
  }

  onChange(callback) {
    this.listeners.add(callback);
  }

  t(key, params = {}) {
    const dict = this.dictionaries.get(this.currentLocale);
    if (!dict) {
      return key;
    }
    const segments = key.split('.');
    let current = dict;
    for (const seg of segments) {
      if (current && Object.prototype.hasOwnProperty.call(current, seg)) {
        current = current[seg];
      } else {
        return key;
      }
    }
    if (typeof current !== 'string') {
      return key;
    }
    return current.replace(/\{\{(\w+)\}\}/g, (_, token) =>
      Object.prototype.hasOwnProperty.call(params, token) ? String(params[token]) : `{{${token}}}`
    );
  }

  translateDOM(root = document) {
    const elements = root.querySelectorAll('[data-i18n]');
    for (const el of elements) {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = this.t(key);
      }
    }
    const titleElements = root.querySelectorAll('[data-i18n-title]');
    for (const el of titleElements) {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.setAttribute('title', this.t(key));
      }
    }
    const contentElements = root.querySelectorAll('[data-i18n-content]');
    for (const el of contentElements) {
      const key = el.getAttribute('data-i18n-content');
      if (key) {
        el.setAttribute('content', this.t(key));
      }
    }
    const ariaElements = root.querySelectorAll('[data-i18n-aria-label]');
    for (const el of ariaElements) {
      const key = el.getAttribute('data-i18n-aria-label');
      if (key) {
        el.setAttribute('aria-label', this.t(key));
      }
    }
  }
}

export const i18n = new I18nService();
export const t = (key, params) => i18n.t(key, params);

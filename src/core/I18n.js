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

const LANGUAGE_SUBTAG_SEPARATOR = /[-_]/;

/**
 * Reads the browser's preferred languages, most preferred first.
 * Returns an empty list outside a browser.
 */
export function readPreferredLanguages() {
  if (typeof navigator === 'undefined' || !navigator) {
    return [];
  }
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return [...navigator.languages];
  }
  return navigator.language ? [navigator.language] : [];
}

/**
 * Picks the locale to start with: a supported stored choice wins, then the
 * first supported primary language among the browser preferences, then the
 * configured fallback.
 *
 * @param {string|null|undefined} stored Raw stored language (null when never chosen).
 * @param {string[]} supported Supported locale codes.
 * @param {string} fallback Configured default locale.
 * @param {string[]} [preferred] Browser language tags, most preferred first.
 * @returns {string}
 */
export function resolveInitialLocale(stored, supported, fallback, preferred = readPreferredLanguages()) {
  const supportedList = Array.isArray(supported) ? supported : [];
  if (stored && supportedList.includes(stored)) {
    return stored;
  }
  for (const tag of preferred || []) {
    if (typeof tag !== 'string' || tag.length === 0) {
      continue;
    }
    const primary = tag.split(LANGUAGE_SUBTAG_SEPARATOR)[0].toLowerCase();
    if (supportedList.includes(primary)) {
      return primary;
    }
  }
  return fallback;
}

class I18nService {
  constructor() {
    this.dictionaries = new Map();
    this.currentLocale = 'fr';
    this.listeners = new Set();
    this.numberFormatters = new Map();
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

  /**
   * Formats a number with the grouping rules of the current locale.
   * One Intl.NumberFormat instance is cached per locale.
   */
  formatNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return String(value);
    }
    let formatter = this.numberFormatters.get(this.currentLocale);
    if (!formatter) {
      formatter = new Intl.NumberFormat(this.currentLocale);
      this.numberFormatters.set(this.currentLocale, formatter);
    }
    return formatter.format(numeric);
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
export const formatNumber = (value) => i18n.formatNumber(value);

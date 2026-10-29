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

/*
 * Lint rules for `npm run lint`: the recommended set, with the globals of where each file
 * runs. The game and its service worker run in the browser; the tests and the calibration
 * scripts run in Node, and the browser tests also hand functions to the page.
 */

import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'local/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' }
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser }
  },
  {
    // A classic service worker script, registered without `type: 'module'`.
    files: ['sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...globals.serviceworker } }
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['tests/browser/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  }
];

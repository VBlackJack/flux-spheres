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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Directories whose every file must be available offline
const OFFLINE_DIRECTORIES = ['src', 'configs', 'locales', 'icons'];

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(directory, entry.name)) : [join(directory, entry.name)]
  );
}

function readPrecacheList() {
  const source = readFileSync(join(REPO_ROOT, 'sw.js'), 'utf8');
  return [...source.matchAll(/'\.\/([^']*)'/g)].map((match) => match[1]).filter(Boolean);
}

test('Service worker precaches every runtime asset and nothing missing', () => {
  const precached = readPrecacheList();
  const runtimeFiles = OFFLINE_DIRECTORIES.flatMap((dir) => listFiles(join(REPO_ROOT, dir))).map((file) =>
    relative(REPO_ROOT, file).split('\\').join('/')
  );
  assert.deepEqual(runtimeFiles.filter((file) => !precached.includes(file)), []);
  assert.deepEqual(precached.filter((file) => !existsSync(join(REPO_ROOT, file))), []);
});

test('Service worker and data loaders revalidate instead of trusting the HTTP cache', () => {
  const sw = readFileSync(join(REPO_ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /NETWORK_FETCH_OPTIONS = Object\.freeze\(\{ cache: 'no-cache' \}\)/);
  assert.match(sw, /fetch\(request, NETWORK_FETCH_OPTIONS\)/);
  assert.match(sw, /new Request\(url, PRECACHE_FETCH_OPTIONS\)/);
  for (const file of ['src/core/ConfigRegistry.js', 'src/core/I18n.js']) {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8');
    assert.match(source, /fetch\(path, DATA_FETCH_OPTIONS\)/, file);
  }
});

test('Service worker cache version matches package.json version', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  const source = readFileSync(join(REPO_ROOT, 'sw.js'), 'utf8');
  assert.ok(source.includes(`APP_VERSION = '${pkg.version}'`));
});

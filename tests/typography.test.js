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
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKIPPED_DIRECTORIES = new Set(['.git', '.claude', 'node_modules', 'local']);

const SCANNED_EXTENSIONS = new Set([
  '.md', '.js', '.mjs', '.json', '.html', '.css', '.webmanifest', '.yml', '.yaml', '.svg'
]);

// Typographic look-alikes of plain ASCII characters. Each one says nothing an ASCII
// character does not, and each one breaks in terminals, diffs and CI logs.
const BANNED_CHARACTERS = new Map([
  [0x2010, 'hyphen'],
  [0x2011, 'non-breaking hyphen'],
  [0x2012, 'figure dash'],
  [0x2013, 'en dash'],
  [0x2014, 'em dash'],
  [0x2015, 'horizontal bar'],
  [0x2212, 'minus sign'],
  [0x2018, 'left single quote'],
  [0x2019, 'right single quote'],
  [0x201A, 'low single quote'],
  [0x201C, 'left double quote'],
  [0x201D, 'right double quote'],
  [0x201E, 'low double quote'],
  [0x00AB, 'left guillemet'],
  [0x00BB, 'right guillemet'],
  [0x2026, 'ellipsis'],
  [0x00A0, 'no-break space'],
  [0x202F, 'narrow no-break space'],
  [0x2009, 'thin space'],
  [0x200B, 'zero-width space'],
  [0xFEFF, 'byte order mark'],
  [0x0152, 'OE ligature'],
  [0x0153, 'oe ligature'],
  [0x00C6, 'AE ligature'],
  [0x00E6, 'ae ligature']
]);

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...collectFiles(join(directory, entry.name)));
      }
    } else if (SCANNED_EXTENSIONS.has(extname(entry.name))) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

test('Typography guard scans nested directories recursively', () => {
  const scanned = collectFiles(REPO_ROOT).map((file) => relative(REPO_ROOT, file).split('\\').join('/'));
  assert.ok(scanned.includes('src/core/I18n.js'), 'guard must reach files two levels deep');
  assert.ok(scanned.includes('locales/fr.json'), 'guard must reach locale files');
  assert.ok(scanned.includes('.github/workflows/ci.yml'), 'guard must reach dot directories');
});

test('No typographic look-alike characters in tracked text files', () => {
  const violations = [];
  for (const file of collectFiles(REPO_ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const char of line) {
        const name = BANNED_CHARACTERS.get(char.codePointAt(0));
        if (name) {
          violations.push(`${relative(REPO_ROOT, file)}:${index + 1} ${name}`);
        }
      }
    });
  }
  assert.deepEqual(violations, []);
});

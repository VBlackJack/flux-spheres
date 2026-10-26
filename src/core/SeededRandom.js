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

const HASH_PRIME_A = 1779033703;
const HASH_PRIME_B = 3144134277;
const HASH_MULT_A = 3432918353;
const HASH_MULT_B = 461845907;
const MULBERRY_ADD = 0x6d2b79f5;
const SHIFT_15 = 15;
const SHIFT_13 = 13;
const SHIFT_7 = 7;
const SHIFT_14 = 14;
const UINT32_MAX_PLUS_ONE = 4294967296;

export class SeededRandom {
  constructor(seedString) {
    this.state = SeededRandom.hashString(String(seedString));
  }

  static hashString(str) {
    let h = HASH_PRIME_A ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), HASH_MULT_A);
      h = (h << SHIFT_13) | (h >>> (32 - SHIFT_13));
    }
    h = Math.imul(h ^ (h >>> 16), HASH_PRIME_B);
    h = Math.imul(h ^ (h >>> SHIFT_13), HASH_MULT_B);
    return (h ^= h >>> 16) >>> 0;
  }

  static getTodayDateKey() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  next() {
    let t = (this.state += MULBERRY_ADD);
    t = Math.imul(t ^ (t >>> SHIFT_15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> SHIFT_7), t | 61);
    return ((t ^ (t >>> SHIFT_14)) >>> 0) / UINT32_MAX_PLUS_ONE;
  }

  nextInt(maxExclusive) {
    return Math.floor(this.next() * maxExclusive);
  }
}

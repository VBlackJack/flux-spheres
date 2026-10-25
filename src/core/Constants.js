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

export const CONFIG_PATHS = Object.freeze({
  GAME: './configs/game.json',
  PHYSICS: './configs/physics.json',
  BALLS: './configs/balls.json',
  OBSTACLES: './configs/obstacles.json',
  LEVELS: './configs/levels.json',
  AUDIO: './configs/audio.json'
});

export const LOCALE_PATHS = Object.freeze({
  fr: './locales/fr.json',
  en: './locales/en.json'
});

export const GAME_MODES = Object.freeze({
  CAMPAIGN: 'campaign',
  ENDLESS: 'endless'
});

export const GAME_STATES = Object.freeze({
  READY: 'ready',
  PLAYING: 'playing',
  PAUSED: 'paused',
  VICTORY: 'victory',
  GAME_OVER: 'game_over'
});

export const SPECIAL_TYPES = Object.freeze({
  BOMB: 'bomb',
  LIGHTNING: 'lightning',
  RAINBOW: 'rainbow',
  ANVIL: 'anvil',
  FREEZE: 'freeze'
});

export const CLUSTER_MODIFIERS = Object.freeze({
  ARMORED: 'armored',
  DORMANT_BOMB: 'dormantBomb',
  CHAMELEON: 'chameleon',
  COIN_CORE: 'coinCore',
  BOSS_CORE: 'bossCore'
});

export const OBSTACLE_TYPES = Object.freeze({
  PIVOT: 'pivot',
  BUMPER: 'bumper',
  REPULSOR: 'repulsor',
  ATTRACTOR: 'attractor',
  BARRIER: 'barrier',
  PORTAL: 'portal'
});

export const MATH_CONSTANTS = Object.freeze({
  HALF: 0.5,
  TWO_PI: Math.PI * 2,
  DEG_TO_RAD: Math.PI / 180,
  EPSILON: 0.0001
});

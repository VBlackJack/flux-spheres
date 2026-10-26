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
  ENDLESS: 'endless',
  DAILY: 'daily'
});

export const DAILY_MUTATORS = Object.freeze({
  HYPER_GRAVITY: 'hyperGravity',
  TURBO_ROTORS: 'turboRotors',
  SUPER_MAGNETISM: 'superMagnetism',
  VOLATILE_CLUSTER: 'volatileCluster'
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

export const SPECIAL_TYPES_ORDER = Object.freeze([
  SPECIAL_TYPES.BOMB,
  SPECIAL_TYPES.LIGHTNING,
  SPECIAL_TYPES.RAINBOW,
  SPECIAL_TYPES.ANVIL,
  SPECIAL_TYPES.FREEZE
]);

export const CLUSTER_MODIFIERS = Object.freeze({
  ARMORED: 'armored',
  DORMANT_BOMB: 'dormantBomb',
  CHAMELEON: 'chameleon',
  COIN_CORE: 'coinCore',
  BOSS_CORE: 'bossCore',
  LASER_LOCK: 'laserLock'
});

export const OBSTACLE_TYPES = Object.freeze({
  PIVOT: 'pivot',
  BUMPER: 'bumper',
  REPULSOR: 'repulsor',
  ATTRACTOR: 'attractor',
  BARRIER: 'barrier',
  PORTAL: 'portal',
  SINGULARITY: 'singularity'
});

export const OBSTACLE_TYPES_ORDER = Object.freeze([
  OBSTACLE_TYPES.PIVOT,
  OBSTACLE_TYPES.BUMPER,
  OBSTACLE_TYPES.REPULSOR,
  OBSTACLE_TYPES.ATTRACTOR,
  OBSTACLE_TYPES.BARRIER,
  OBSTACLE_TYPES.PORTAL,
  OBSTACLE_TYPES.SINGULARITY
]);

export const LAYOUT_TYPES = Object.freeze({
  PENDULUM: 'pendulum',
  RING: 'ring',
  DUAL_RING: 'dualRing',
  HEXAGON: 'hexagon',
  SPIRAL: 'spiral',
  CROSS: 'cross'
});

export const MATH_CONSTANTS = Object.freeze({
  HALF: 0.5,
  QUARTER_PI: Math.PI / 4,
  TWO_PI: Math.PI * 2,
  DEG_TO_RAD: Math.PI / 180,
  EPSILON: 0.0001
});

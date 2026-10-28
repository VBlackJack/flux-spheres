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
  CAMPAIGN: './configs/campaign.json',
  CAMPAIGN_TUNING: './configs/campaignTuning.json',
  AUDIO: './configs/audio.json',
  FLUX: './configs/flux.json'
});

/**
 * Configs and texts are always revalidated with the server (a cheap 304 when unchanged),
 * so a page from a new deploy never runs with the previous deploy's data.
 */
export const DATA_FETCH_OPTIONS = Object.freeze({ cache: 'no-cache' });

export const LOCALE_PATHS = Object.freeze({
  fr: './locales/fr.json',
  en: './locales/en.json'
});

export const GAME_MODES = Object.freeze({
  CAMPAIGN: 'campaign',
  ENDLESS: 'endless',
  DAILY: 'daily',
  FLUX: 'flux'
});

export const DAILY_MUTATORS = Object.freeze({
  HYPER_GRAVITY: 'hyperGravity',
  TURBO_ROTORS: 'turboRotors',
  SUPER_MAGNETISM: 'superMagnetism',
  VOLATILE_CLUSTER: 'volatileCluster'
});

/** Kind of each row a survival run spawns, as recorded in the engine's wave log. */
export const WAVE_TYPES = Object.freeze({
  NORMAL: 'normal',
  GOLD_RUSH: 'goldRush',
  BOSS: 'boss'
});

export const GAME_STATES = Object.freeze({
  READY: 'ready',
  PLAYING: 'playing',
  PAUSED: 'paused',
  VICTORY: 'victory',
  GAME_OVER: 'game_over'
});

/** Why a run ended in defeat; also the suffix of its `modals.gameOver.reason.*` text. */
export const GAME_OVER_REASONS = Object.freeze({
  OUT_OF_SHOTS: 'outOfShots',
  LINE_CROSSED: 'lineCrossed'
});

/** How the player is currently driving the game; selects touch or mouse/keyboard hints. */
export const INPUT_MODES = Object.freeze({
  POINTER: 'pointer',
  TOUCH: 'touch'
});

export const SPECIAL_TYPES = Object.freeze({
  BOMB: 'bomb',
  LIGHTNING: 'lightning',
  RAINBOW: 'rainbow',
  ANVIL: 'anvil',
  FREEZE: 'freeze',
  ROCKET: 'rocket'
});

export const SPECIAL_TYPES_ORDER = Object.freeze([
  SPECIAL_TYPES.BOMB,
  SPECIAL_TYPES.LIGHTNING,
  SPECIAL_TYPES.RAINBOW,
  SPECIAL_TYPES.ANVIL,
  SPECIAL_TYPES.FREEZE,
  SPECIAL_TYPES.ROCKET
]);

export const CLUSTER_MODIFIERS = Object.freeze({
  ARMORED: 'armored',
  DORMANT_BOMB: 'dormantBomb',
  CHAMELEON: 'chameleon',
  COIN_CORE: 'coinCore',
  BOSS_CORE: 'bossCore',
  LASER_LOCK: 'laserLock',
  NEUTRAL_ANCHOR: 'neutralAnchor',
  CHAINED: 'chained',
  BUBBLE: 'bubble',
  FREEZE_CORE: 'freezeCore',
  LIGHTNING_CORE: 'lightningCore',
  PAINT_CORE: 'paintCore',
  THRUSTER: 'thruster',
  TETHER: 'tether',
  RUST: 'rust'
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

/**
 * Discoverable mechanics that are neither a cluster modifier nor an obstacle type: the
 * basic rules every board shows, and anchors sliding on a rail.
 */
export const BOARD_MECHANICS = Object.freeze({
  BASICS: 'basics',
  RAIL: 'rail'
});

export const LAYOUT_TYPES = Object.freeze({
  PENDULUM: 'pendulum',
  RING: 'ring',
  DUAL_RING: 'dualRing',
  HEXAGON: 'hexagon',
  SPIRAL: 'spiral',
  CROSS: 'cross',
  MASK: 'mask'
});

export const MATH_CONSTANTS = Object.freeze({
  HALF: 0.5,
  QUARTER_PI: Math.PI / 4,
  TWO_PI: Math.PI * 2,
  DEG_TO_RAD: Math.PI / 180,
  EPSILON: 0.0001
});

/**
 * Deterministic unit axis used to separate two bodies whose centers coincide,
 * when no velocity direction is available to derive a separation normal.
 */
export const SEPARATION_FALLBACK_AXIS = Object.freeze({
  X: 1,
  Y: 0
});

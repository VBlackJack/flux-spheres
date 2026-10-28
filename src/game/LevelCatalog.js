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

import { generateFluxStage } from './layouts/FluxStageGenerator.js';

/** Separator between the seed prefix and the level number in a generated level's seed. */
const LEVEL_SEED_SEPARATOR = '-';

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const lerp = ([min, max], ratio) => min + (max - min) * ratio;

/**
 * Number of campaign levels: the authored ones, then the generated ones.
 * @param {object} levelsConfig - configs/levels.json.
 * @param {object} campaignConfig - configs/campaign.json.
 * @returns {number}
 */
export function countCampaignLevels(levelsConfig, campaignConfig) {
  return levelsConfig.levels.length + campaignConfig.generated.count;
}

/**
 * Where a generated level sits in the campaign, and how hard it is. Difficulty climbs over
 * the whole run and again inside each chapter; a new chapter starts a little lower than the
 * end of the previous one, so the player gets a breather.
 * @param {number} index - 0-based position among the generated levels.
 * @param {object} generated - campaignConfig.generated.
 * @returns {{chapter: number, chapterLevel: number, difficulty: number}} 1-based chapter and
 *   position in it, difficulty from 0 to 1.
 */
export function placeGeneratedLevel(index, generated) {
  const { chapterSize, chapterSwing, count } = generated;
  const chapterCount = Math.ceil(count / chapterSize);
  const chapter = Math.floor(index / chapterSize) + 1;
  const chapterLevel = (index % chapterSize) + 1;
  const overall = chapterCount > 1 ? (chapter - 1) / (chapterCount - 1) : 0;
  const within = chapterSize > 1 ? (chapterLevel - 1) / (chapterSize - 1) : 0;
  return { chapter, chapterLevel, difficulty: clamp01(overall * (1 - chapterSwing) + within * chapterSwing) };
}

/** Last entry of a table sorted by fromDifficulty that `difficulty` has reached. */
function pickDifficultyEntry(table, difficulty) {
  let entry = table[0];
  for (const candidate of table) {
    if (difficulty >= candidate.fromDifficulty) {
      entry = candidate;
    }
  }
  return entry;
}

const roundTo = (value, step) => Math.round(value / step) * step;

/**
 * The campaign's levels by number: the authored levels first, then the generated ones,
 * each rebuilt from its number alone. The same number always gives the same board, so a
 * level needs no storage and a saved run rebuilds its level on reload.
 */
export class LevelCatalog {
  /**
   * @param {object} options
   * @param {object} options.levelsConfig - configs/levels.json.
   * @param {object} options.campaignConfig - configs/campaign.json.
   * @param {object} options.fluxConfig - configs/flux.json (the shapes and obstacles).
   * @param {object} options.obstaclesConfig - configs/obstacles.json.
   * @param {number} options.ballRadius - Cluster ball radius.
   */
  constructor({ levelsConfig, campaignConfig, fluxConfig, obstaclesConfig, ballRadius }) {
    this.authored = levelsConfig.levels;
    this.generated = campaignConfig.generated;
    this.fluxConfig = fluxConfig;
    this.obstaclesConfig = obstaclesConfig;
    this.ballRadius = ballRadius;
    this.count = countCampaignLevels(levelsConfig, campaignConfig);
    this.built = new Map();
  }

  /** Number of the first campaign level. */
  get firstId() {
    return this.authored[0].id;
  }

  /** Number of the last campaign level. */
  get lastId() {
    return this.firstId + this.count - 1;
  }

  has(levelId) {
    return Number.isInteger(levelId) && levelId >= this.firstId && levelId <= this.lastId;
  }

  isGenerated(levelId) {
    return this.has(levelId) && levelId > this.authored[this.authored.length - 1].id;
  }

  /**
   * What the level select needs to show a level, without building its board.
   * @returns {{id: number, isGenerated: boolean, nameKey?: string, descriptionKey?: string,
   *   chapter?: number, chapterLevel?: number, chapterSize?: number, featuredMechanic?: string,
 *   isLandmark?: boolean}|null}
   */
  summarize(levelId) {
    if (!this.has(levelId)) {
      return null;
    }
    if (!this.isGenerated(levelId)) {
      const { id, nameKey, descriptionKey } = this.authored.find((level) => level.id === levelId);
      return { id, isGenerated: false, nameKey, descriptionKey };
    }
    const { chapter, chapterLevel } = placeGeneratedLevel(this.generatedIndex(levelId), this.generated);
    return {
      id: levelId,
      isGenerated: true,
      chapter,
      chapterLevel,
      chapterSize: this.generated.chapterSize,
      featuredMechanic: this.featuredMechanicOf(chapter),
      isLandmark: this.isLandmark(levelId)
    };
  }

  /**
   * The campaign's chapters, in order: the authored levels as one teaching chapter
   * (index 0), then the chapters of generated levels.
   * @returns {Array<{index: number, isTutorial: boolean, firstId: number, lastId: number,
   *   featuredMechanic?: string}>}
   */
  listChapters() {
    const lastAuthoredId = this.authored[this.authored.length - 1].id;
    const chapters = [{ index: 0, isTutorial: true, firstId: this.firstId, lastId: lastAuthoredId }];
    const size = this.generated.chapterSize;
    for (let firstId = lastAuthoredId + 1, index = 1; firstId <= this.lastId; firstId += size, index++) {
      chapters.push({
        index,
        isTutorial: false,
        firstId,
        lastId: Math.min(firstId + size - 1, this.lastId),
        featuredMechanic: this.featuredMechanicOf(index)
      });
    }
    return chapters;
  }

  /** Index in listChapters() of the chapter holding a level; the first one when out of range. */
  chapterIndexOf(levelId) {
    const chapter = this.listChapters().find((entry) => levelId >= entry.firstId && levelId <= entry.lastId);
    return chapter ? chapter.index : 0;
  }

  /** Summaries of every level, in order. */
  list() {
    return Array.from({ length: this.count }, (_, offset) => this.summarize(this.firstId + offset));
  }

  /**
   * The full definition of a level, in the shape of configs/levels.json. A generated level
   * carries a ready layout spec (`spec`) instead of a `layout` description.
   * @returns {object|null} Null for a number outside the campaign.
   */
  get(levelId) {
    if (!this.has(levelId)) {
      return null;
    }
    if (!this.isGenerated(levelId)) {
      return this.authored.find((level) => level.id === levelId);
    }
    if (!this.built.has(levelId)) {
      this.built.set(levelId, this.buildGenerated(levelId));
    }
    return this.built.get(levelId);
  }

  generatedIndex(levelId) {
    return levelId - this.authored[this.authored.length - 1].id - 1;
  }

  featuredMechanicOf(chapter) {
    const featured = this.generated.featuredMechanics;
    return featured[(chapter - 1) % featured.length];
  }

  isLandmark(levelId) {
    const interval = this.generated.landmarkInterval;
    return interval > 0 && levelId % interval === 0;
  }

  buildGenerated(levelId) {
    const generated = this.generated;
    const summary = this.summarize(levelId);
    const { difficulty } = placeGeneratedLevel(this.generatedIndex(levelId), generated);
    const isLandmark = summary.isLandmark;
    const landmarkFamilies = generated.landmarkFamilies;

    const stageDef = generateFluxStage({
      seed: `${generated.seedPrefix}${LEVEL_SEED_SEPARATOR}${levelId}`,
      stage: Math.round(lerp(generated.fluxStageRange, difficulty)),
      previousFamily: null,
      fluxConfig: this.fluxConfig,
      obstaclesConfig: this.obstaclesConfig,
      ballRadius: this.ballRadius,
      family: isLandmark ? landmarkFamilies[(levelId / generated.landmarkInterval) % landmarkFamilies.length] : null,
      isBoss: isLandmark
    });

    const sphereCount = stageDef.spec.balls.length;
    const featured = summary.featuredMechanic;
    const modifierCfg = generated.modifiers;
    const modifierWeights = {};
    for (const [modKey, range] of Object.entries(modifierCfg.pool)) {
      modifierWeights[modKey] = lerp(range, difficulty);
    }
    modifierWeights[featured] = (modifierWeights[featured] || 0) + lerp(modifierCfg.featuredWeight, difficulty);
    // A shape made mostly of anchors has few spheres that can carry a modifier.
    const freeSphereCount = stageDef.spec.balls.filter((ball) => ball.allowModifier).length;
    const featuredCount = Math.min(
      Math.round(lerp(modifierCfg.featuredMinCount, difficulty)),
      Math.floor(freeSphereCount * modifierCfg.featuredMaxShare)
    );

    const shotsCfg = generated.shots;
    const shots = Math.ceil(sphereCount * lerp(shotsCfg.perSphere, difficulty)) + shotsCfg.base;
    const maxShots = Math.min(shotsCfg.max, Math.max(shotsCfg.min, shots + (isLandmark ? shotsCfg.landmarkBonus : 0)));

    const starsCfg = generated.stars;
    const threeStars = roundTo(sphereCount * lerp(starsCfg.pointsPerSphere, difficulty), starsCfg.roundTo);
    const twoStars = roundTo(threeStars * starsCfg.twoStarShare, starsCfg.roundTo);

    const inventoryCfg = generated.specialInventory;
    const specialInventory = { ...inventoryCfg.base };
    if (isLandmark) {
      for (const [special, extra] of Object.entries(inventoryCfg.landmarkBonus)) {
        specialInventory[special] = (specialInventory[special] || 0) + extra;
      }
    }

    return {
      ...summary,
      difficulty,
      family: stageDef.family,
      shapeIds: stageDef.shapeIds,
      tutorialKey: null,
      starThresholds: [0, twoStars, threeStars],
      maxShots,
      paletteCount: pickDifficultyEntry(generated.palette, difficulty).count,
      specialInventory,
      modifierWeights,
      minModifierCounts: { [featured]: featuredCount },
      obstacles: stageDef.obstacles,
      spec: stageDef.spec,
      bossBallIndex: stageDef.bossBallIndex
    };
  }
}

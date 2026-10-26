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

import { LAYOUT_TYPES, OBSTACLE_TYPES, MATH_CONSTANTS } from '../../core/Constants.js';
import { SeededRandom } from '../../core/SeededRandom.js';
import { generateLayout, mergeLayoutSpecs } from './LayoutGenerators.js';

/** Shape families of the Flux mode; each stage draws one, never the previous stage's. */
export const FLUX_FAMILIES = Object.freeze({
  PARAMETRIC: 'parametric',
  MASK: 'mask',
  COMPOSITE: 'composite'
});

/** Separator between the seed and the stage number in a stage's RNG key. */
const STAGE_SEED_SEPARATOR = ':';

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const lerp = (min, max, ratio) => min + (max - min) * ratio;

/**
 * Last entry of a stage table ([{fromStage, ...}], sorted by fromStage) reached by `stage`.
 */
export function pickStageTableEntry(table, stage) {
  let entry = table[0];
  for (const candidate of table) {
    if (stage >= candidate.fromStage) {
      entry = candidate;
    }
  }
  return entry;
}

/**
 * Builds one Flux stage. The result depends only on its arguments: the same seed, stage
 * and previous family always yield the same board, which is what lets a saved run rebuild
 * its stage on reload.
 *
 * @param {object} options
 * @param {string} options.seed - Run seed.
 * @param {number} options.stage - 1-based stage number.
 * @param {string|null} options.previousFamily - Family of the previous stage, excluded here.
 * @param {object} options.fluxConfig - configs/flux.json.
 * @param {object} options.obstaclesConfig - configs/obstacles.json (obstacle radii).
 * @param {number} options.ballRadius - Cluster ball radius.
 * @returns {{stage: number, family: string, shapeIds: string[], isBoss: boolean,
 *   paletteCount: number, modifierWeights: object, obstacles: object[],
 *   spec: {balls: object[], bonds: number[][]}, bossBallIndex: number|null}}
 */
export function generateFluxStage({ seed, stage, previousFamily, fluxConfig, obstaclesConfig, ballRadius }) {
  const rng = new SeededRandom(`${seed}${STAGE_SEED_SEPARATOR}${stage}`);
  const rand = () => rng.next();
  const difficulty = clamp01((stage - 1) / fluxConfig.difficultyRampStages);
  const pickRatio = () => clamp01(difficulty + (rand() * 2 - 1) * fluxConfig.paramJitter);
  const pickInt = ([min, max]) => Math.round(lerp(min, max, pickRatio()));
  const pickFloat = ([min, max]) => lerp(min, max, pickRatio());
  const pickOne = (items) => items[Math.floor(rand() * items.length)];

  const rotorCfg = fluxConfig.rotor;
  const rotorSpeed = Math.min(rotorCfg.maxAngularSpeed, rotorCfg.baseAngularSpeed + rotorCfg.angularSpeedPerStage * (stage - 1));
  const pivotAt = (x, y) => ({
    type: OBSTACLE_TYPES.PIVOT,
    x,
    y,
    angularSpeed: rand() < MATH_CONSTANTS.HALF ? rotorSpeed : -rotorSpeed
  });

  const family = pickFamily(fluxConfig, stage, previousFamily, rand);
  const parts = buildFamilyParts(family, { fluxConfig, stage, pickInt, pickFloat, pickOne, pivotAt });

  const pivots = parts.flatMap((part) => part.pivots);
  let pivotSlotOffset = 0;
  const spec = mergeLayoutSpecs(
    parts.map((part) => {
      const entry = { spec: part.spec, pivotSlotOffset };
      pivotSlotOffset += part.pivots.length;
      return entry;
    })
  );

  const extraObstacles = buyObstacles({ fluxConfig, obstaclesConfig, stage, parts, pivots, ballRadius, rand });
  const isBoss = fluxConfig.bossStageInterval > 0 && stage % fluxConfig.bossStageInterval === 0;

  return {
    stage,
    family,
    shapeIds: parts.map((part) => part.id),
    isBoss,
    paletteCount: pickStageTableEntry(fluxConfig.palette, stage).count,
    modifierWeights: { ...pickStageTableEntry(fluxConfig.modifiers, stage).weights },
    obstacles: [...pivots, ...extraObstacles],
    spec,
    bossBallIndex: isBoss ? findBossBallIndex(spec) : null
  };
}

function eligibleParametricKeys(fluxConfig, stage) {
  return Object.keys(fluxConfig.parametric).filter((key) => fluxConfig.parametric[key].minStage <= stage);
}

function eligibleMasks(fluxConfig, stage) {
  return fluxConfig.masks.filter((mask) => mask.minStage <= stage);
}

function pickFamily(fluxConfig, stage, previousFamily, rand) {
  const available = {
    [FLUX_FAMILIES.PARAMETRIC]: eligibleParametricKeys(fluxConfig, stage).length > 0,
    [FLUX_FAMILIES.MASK]: eligibleMasks(fluxConfig, stage).length > 0,
    [FLUX_FAMILIES.COMPOSITE]: fluxConfig.composite.minStage <= stage && fluxConfig.composite.parts.length > 0
  };
  const usable = Object.entries(fluxConfig.familyWeights).filter(([family]) => available[family]);
  const fresh = usable.filter(([family]) => family !== previousFamily);
  const pool = fresh.length > 0 ? fresh : usable;
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [family, weight] of pool) {
    roll -= weight;
    if (roll < 0) {
      return family;
    }
  }
  return pool[pool.length - 1][0];
}

/**
 * A part is one generated shape: { id, spec, pivots: [pivot obstacle defs], footprints }.
 * Footprints are the circles a rotating part sweeps around each pivot ({x, y, radius},
 * ball radius excluded), each ball counting for its nearest pivot. A static part has
 * none and is checked ball by ball instead.
 */
export function makePart(id, layout, pivots) {
  const spec = generateLayout(layout);
  const radii = pivots.map(() => 0);
  for (const ball of spec.balls) {
    let nearest = -1;
    let nearestDistance = Infinity;
    pivots.forEach((pivot, index) => {
      const distance = Math.hypot(ball.x - pivot.x, ball.y - pivot.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    });
    if (nearest >= 0) {
      radii[nearest] = Math.max(radii[nearest], nearestDistance);
    }
  }
  const footprints = pivots.map((pivot, index) => ({ x: pivot.x, y: pivot.y, radius: radii[index] }));
  return { id, spec, pivots, footprints };
}

function buildFamilyParts(family, ctx) {
  const { fluxConfig, stage, pickOne } = ctx;
  if (family === FLUX_FAMILIES.MASK) {
    const mask = pickOne(eligibleMasks(fluxConfig, stage));
    const { centerX, spacing, maskTopY } = fluxConfig.layout;
    return [makePart(mask.id, { type: LAYOUT_TYPES.MASK, rows: mask.rows, centerX, topY: maskTopY, spacing }, [])];
  }
  if (family === FLUX_FAMILIES.COMPOSITE) {
    const composite = fluxConfig.composite;
    return composite.centersX.map((centerX) => buildCompositePart(pickOne(composite.parts), centerX, ctx));
  }
  const key = pickOne(eligibleParametricKeys(fluxConfig, stage));
  return [buildParametricPart(key, ctx)];
}

function buildCompositePart(part, centerX, { fluxConfig, pivotAt }) {
  const composite = fluxConfig.composite;
  if (part.type === LAYOUT_TYPES.RING) {
    const centerY = composite.ringCenterY;
    return makePart(part.id, { type: LAYOUT_TYPES.RING, centerX, centerY, rings: part.rings }, [pivotAt(centerX, centerY)]);
  }
  return makePart(
    part.id,
    { type: LAYOUT_TYPES.MASK, rows: part.rows, centerX, topY: composite.maskTopY, spacing: fluxConfig.layout.spacing },
    []
  );
}

function buildParametricPart(key, { fluxConfig, pickInt, pickFloat, pivotAt }) {
  const def = fluxConfig.parametric[key];
  const { centerX, spacing } = fluxConfig.layout;

  if (key === LAYOUT_TYPES.PENDULUM) {
    const rows = pickInt(def.rows);
    const cols = pickInt(def.cols);
    const anchorCount = pickInt(def.anchorCount);
    const rowWidth = (cols - 1) * spacing + spacing * MATH_CONSTANTS.HALF;
    const startX = centerX - rowWidth * MATH_CONSTANTS.HALF;
    // Anchors sit right above a first-row ball so that each one bonds to the grid.
    const anchors = Array.from({ length: anchorCount }, (_, i) => ({
      x: startX + Math.round(((i + 1) * (cols - 1)) / (anchorCount + 1)) * spacing,
      y: def.anchorY
    }));
    const layout = { type: key, anchors, rows, cols, startX, startY: def.startY, spacingX: spacing, spacingY: def.spacingY };
    return makePart(key, layout, []);
  }
  if (key === LAYOUT_TYPES.RING) {
    const layout = { type: key, centerX, centerY: def.centerY, rings: def.rings.slice(0, pickInt(def.ringCount)) };
    return makePart(key, layout, [pivotAt(centerX, def.centerY)]);
  }
  if (key === LAYOUT_TYPES.HEXAGON) {
    const layout = { type: key, centerX, centerY: def.centerY, layers: pickInt(def.layers), spacing };
    return makePart(key, layout, [pivotAt(centerX, def.centerY)]);
  }
  if (key === LAYOUT_TYPES.SPIRAL) {
    const layout = {
      type: key,
      centerX,
      centerY: def.centerY,
      arms: pickInt(def.arms),
      ballsPerArm: pickInt(def.ballsPerArm),
      startRadius: def.startRadius,
      radiusStep: def.radiusStep,
      angleStep: pickFloat(def.angleStep),
      anchorStepInterval: def.anchorStepInterval
    };
    return makePart(key, layout, [pivotAt(centerX, def.centerY)]);
  }
  if (key === LAYOUT_TYPES.CROSS) {
    const layout = {
      type: key,
      centerX,
      centerY: def.centerY,
      armLength: pickInt(def.armLength),
      spacing,
      perpSpacingFactor: def.perpSpacingFactor
    };
    return makePart(key, layout, [pivotAt(centerX, def.centerY)]);
  }
  if (key === LAYOUT_TYPES.DUAL_RING) {
    const rings = def.rings.slice(0, pickInt(def.ringCount));
    const clusters = def.centersX.map((x) => ({ centerX: x, centerY: def.centerY, rings }));
    return makePart(key, { type: key, clusters }, def.centersX.map((x) => pivotAt(x, def.centerY)));
  }
  throw new Error(`Unknown Flux parametric shape: ${key}`);
}

function obstacleRadius(obstaclesConfig, type) {
  return obstaclesConfig.types[type]?.radius ?? obstaclesConfig.defaults.radius;
}

/**
 * Spends the stage's obstacle budget on configured obstacle groups, in random order,
 * skipping any group that does not fit next to the shape and the obstacles already placed.
 */
function buyObstacles({ fluxConfig, obstaclesConfig, stage, parts, pivots, ballRadius, rand }) {
  const budgetCfg = fluxConfig.budget;
  let remaining = Math.min(budgetCfg.max, budgetCfg.base + budgetCfg.perStage * (stage - 1));
  const clearance = fluxConfig.obstacleClearance;
  const placed = pivots.map((p) => ({ x: p.x, y: p.y, radius: obstacleRadius(obstaclesConfig, p.type) }));
  const bought = [];

  const candidates = fluxConfig.obstacles.filter((group) => group.minStage <= stage);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const fits = (placement) => {
    const radius = obstacleRadius(obstaclesConfig, placement.type);
    for (const part of parts) {
      for (const footprint of part.footprints) {
        if (Math.hypot(placement.x - footprint.x, placement.y - footprint.y) < footprint.radius + ballRadius + radius + clearance) {
          return false;
        }
      }
      if (part.footprints.length === 0) {
        for (const ball of part.spec.balls) {
          if (Math.hypot(placement.x - ball.x, placement.y - ball.y) < ballRadius + radius + clearance) {
            return false;
          }
        }
      }
    }
    return placed.every((other) => Math.hypot(placement.x - other.x, placement.y - other.y) >= other.radius + radius + clearance);
  };

  for (const group of candidates) {
    if (group.cost > remaining || !group.placements.every(fits)) {
      continue;
    }
    remaining -= group.cost;
    for (const placement of group.placements) {
      bought.push({ ...placement });
      placed.push({ x: placement.x, y: placement.y, radius: obstacleRadius(obstaclesConfig, placement.type) });
    }
  }
  return bought;
}

/**
 * Index of the ball closest to the shape's centroid, which becomes the boss core. Free
 * balls are preferred; a shape made only of anchors (a single-ring rotor) uses an anchor.
 */
function findBossBallIndex(spec) {
  const count = spec.balls.length;
  const centroidX = spec.balls.reduce((sum, b) => sum + b.x, 0) / count;
  const centroidY = spec.balls.reduce((sum, b) => sum + b.y, 0) / count;
  const hasFreeBall = spec.balls.some((ball) => ball.allowModifier);
  let bestIndex = null;
  let bestDistance = Infinity;
  spec.balls.forEach((ball, index) => {
    if (hasFreeBall && !ball.allowModifier) {
      return;
    }
    const distance = Math.hypot(ball.x - centroidX, ball.y - centroidY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

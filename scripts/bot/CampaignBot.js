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
 * The bots that play campaign levels for the calibration.
 *
 * - greedy: aims the loaded color where most spheres of that color sit, never touches a
 *   special ball. It sets the floor: a level it cannot win gets more shots.
 * - arsenal: reads the aim preview the player sees (what a shot destroys and drops) for
 *   the loaded color and for every special ball in stock, and equips a special when it
 *   clearly beats the best color shot. It sets the star thresholds.
 */

import { GAME_STATES, SPECIAL_TYPES } from '../../src/core/Constants.js';
import { predictImpact } from '../../src/game/ImpactPreview.js';
import { pickRocketTargets } from '../../src/game/SpecialBallController.js';

export const BOT_POLICIES = Object.freeze({ GREEDY: 'greedy', ARSENAL: 'arsenal' });

/** Aim angles the bot tries, from right to left across the upper half-plane. */
function sampleAngles(bot) {
  return Array.from(
    { length: bot.aimSamples + 1 },
    (_, i) => -Math.PI * (bot.aimArcStart + (bot.aimArcSpan * i) / bot.aimSamples)
  );
}

/** Sum of +sameColorScore / +otherColorScore over the spheres around a point. */
function neighborhoodScore(engine, bot, reach, end, colorId) {
  let score = 0;
  for (const ball of engine.physicsWorld.balls) {
    if (Math.hypot(ball.x - end.x, ball.y - end.y) < reach) {
      score += ball.colorId === colorId ? bot.sameColorScore : bot.otherColorScore;
    }
  }
  return score;
}

/** Aims where the most spheres of the loaded color sit around the end of the trajectory. */
export function pickGreedyAngle(engine, bot, reach) {
  let bestAngle = null;
  let bestScore = -Infinity;
  for (const angle of sampleAngles(bot)) {
    engine.updateAimFromAngle(angle);
    const end = engine.aimPoints.at(-1);
    if (!end) {
      continue;
    }
    const score = Math.random() * bot.aimJitter + neighborhoodScore(engine, bot, reach, end, engine.currentBall.colorId);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  return bestAngle;
}

/**
 * What the loaded ball would take off the board along the current aim, as spheres:
 * those it destroys, plus the ones that drop after, weighted by `avalancheWeight`. A
 * freeze destroys nothing and is worth `freezeValuePerSphere` for each sphere it holds.
 */
export function shotValue(engine, arsenal) {
  const points = engine.aimPoints;
  const end = points.at(-1);
  if (!end) {
    return 0;
  }
  const ball = engine.currentBall;
  const physicsWorld = engine.physicsWorld;
  let destroyedIds;
  if (ball.specialType === SPECIAL_TYPES.ROCKET) {
    const specs = engine.ballsConfig.specialTypes[SPECIAL_TYPES.ROCKET];
    destroyedIds = new Set(pickRocketTargets(end, physicsWorld.balls, specs.rocketCount).map((target) => target.id));
  } else {
    const impact = predictImpact({
      points,
      currentBall: ball,
      physicsWorld,
      endX: end.x,
      endY: end.y,
      blastMult: engine.getBlastRadiusMultiplier(),
      specialTypes: engine.ballsConfig.specialTypes,
      matchMinCount: engine.gameConfig.defaults.matchMinCount
    });
    if (ball.specialType === SPECIAL_TYPES.FREEZE) {
      return impact.highlight.length * arsenal.freezeValuePerSphere;
    }
    destroyedIds = impact.destroyedIds;
  }
  if (destroyedIds.size === 0) {
    return 0;
  }
  return destroyedIds.size + physicsWorld.findDetachedIfRemoved(destroyedIds).length * arsenal.avalancheWeight;
}

/**
 * Best angle for the loaded color: the greedy neighborhood score, plus what the aim
 * preview says the shot takes off now.
 * @returns {{angle: number|null, value: number}} value is the preview part alone.
 */
function pickArsenalColorShot(engine, bot, reach, angles) {
  const arsenal = bot.arsenal;
  let best = { angle: null, value: 0 };
  let bestScore = -Infinity;
  for (const angle of angles) {
    engine.updateAimFromAngle(angle);
    const end = engine.aimPoints.at(-1);
    if (!end) {
      continue;
    }
    const value = shotValue(engine, arsenal);
    const score = Math.random() * bot.aimJitter
      + neighborhoodScore(engine, bot, reach, end, engine.currentBall.colorId)
      + value * arsenal.colorPreviewWeight;
    if (score > bestScore) {
      bestScore = score;
      best = { angle, value };
    }
  }
  return best;
}

/** Best special ball in stock and its angle, by preview value; null with none in stock. */
function pickSpecialShot(engine, arsenal, angles) {
  const loaded = engine.currentBall;
  let best = null;
  try {
    for (const [specialType, count] of Object.entries(engine.specialInventory)) {
      if (count <= 0) {
        continue;
      }
      // A probe ball stands in for the special so the trajectory bends as it would.
      engine.currentBall = engine.createRandomLauncherBall(specialType);
      for (const angle of angles) {
        engine.updateAimFromAngle(angle);
        const value = shotValue(engine, arsenal);
        if (!best || value > best.value) {
          best = { specialType, angle, value };
        }
      }
    }
  } finally {
    engine.currentBall = loaded;
  }
  return best;
}

/**
 * The arsenal bot's next shot. A special replaces the color shot when it takes off at
 * least `specialMinValue` spheres and `specialMinGain` more than the color shot; once
 * the shots left no longer outnumber the specials in stock, any gain is enough.
 * @returns {{angle: number|null, specialType: string|null}}
 */
export function planArsenalShot(engine, bot, reach) {
  const arsenal = bot.arsenal;
  const angles = sampleAngles(bot);
  const color = pickArsenalColorShot(engine, bot, reach, angles);
  const special = pickSpecialShot(engine, arsenal, angles);
  if (special) {
    const specialsLeft = Object.values(engine.specialInventory).reduce((sum, count) => sum + Math.max(0, count), 0);
    const isEndgame = engine.shotsRemaining <= specialsLeft;
    const minGain = isEndgame ? 0 : arsenal.specialMinGain;
    if (special.value >= arsenal.specialMinValue && special.value > color.value + minGain) {
      return { angle: special.angle, specialType: special.specialType };
    }
  }
  return { angle: color.angle, specialType: null };
}

/**
 * Plays one campaign game with a policy.
 * @param {object} engine - A fresh GameEngine.
 * @param {number} levelId - Campaign level.
 * @param {object} bot - campaignConfig.generated.calibration.bot.
 * @param {string} policy - One of BOT_POLICIES.
 * @returns {{score: number, won: boolean, specialsUsed: number}}
 */
export function playGame(engine, levelId, bot, policy) {
  const reach = engine.physicsConfig.ball.radius * bot.neighborhoodRadii;
  engine.startCampaignLevel(levelId);
  let specialsUsed = 0;
  for (let frame = 0; engine.state === GAME_STATES.PLAYING && frame < bot.maxFrames; frame++) {
    if (!engine.physicsWorld.projectile && engine.shotsRemaining > 0) {
      const shot = policy === BOT_POLICIES.ARSENAL
        ? planArsenalShot(engine, bot, reach)
        : { angle: pickGreedyAngle(engine, bot, reach), specialType: null };
      if (shot.angle !== null) {
        if (shot.specialType) {
          engine.equipSpecialBall(shot.specialType);
          specialsUsed++;
        }
        engine.updateAimFromAngle(shot.angle);
        engine.shoot();
      }
    }
    engine.update();
  }
  let celebrated = false;
  for (let frame = 0; engine.isVictoryCelebrating() && frame < bot.maxCelebrationFrames; frame++) {
    celebrated = true;
    engine.update();
  }
  return { score: engine.score, won: celebrated || engine.state === GAME_STATES.VICTORY, specialsUsed };
}

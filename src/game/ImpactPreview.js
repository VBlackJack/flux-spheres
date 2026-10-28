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

import { SPECIAL_TYPES } from '../core/Constants.js';

/**
 * What a shot along an aim trajectory would hit, as the aim preview shows it: the spheres
 * highlighted, and among them the ones the shot destroys. Shared by the renderer and the
 * calibration bot, so the bot weighs a shot the way the player sees it.
 * @param {object} options
 * @param {Array<{x: number, y: number}>} options.points - Aim trajectory; its `snapTarget`
 *   is the sphere a regular ball would land against.
 * @param {object} options.currentBall - The loaded ball.
 * @param {object} options.physicsWorld - The board.
 * @param {number} options.endX - Trajectory end, x.
 * @param {number} options.endY - Trajectory end, y.
 * @param {number} options.blastMult - Blast radius upgrade multiplier.
 * @param {object} options.specialTypes - ballsConfig.specialTypes.
 * @param {number} options.matchMinCount - Spheres a match needs.
 * @param {{highlight: object[], destroyedIds: Set<number>}} [out] - Containers to fill,
 *   cleared first; the renderer reuses its own between frames.
 * @returns {{highlight: object[], destroyedIds: Set<number>, isMatch: boolean}}
 */
export function predictImpact(
  { points, currentBall, physicsWorld, endX, endY, blastMult, specialTypes, matchMinCount },
  out = { highlight: [], destroyedIds: new Set() }
) {
  const { highlight, destroyedIds } = out;
  highlight.length = 0;
  destroyedIds.clear();
  let isMatch = false;

  if (currentBall.specialType) {
    const specType = currentBall.specialType;
    const specCfg = specialTypes[specType];
    if (specType === SPECIAL_TYPES.BOMB || specType === SPECIAL_TYPES.FREEZE) {
      const radiusFactor = specType === SPECIAL_TYPES.BOMB
        ? specCfg.blastRadiusFactor
        : specCfg.freezeRadiusFactor;
      const aoeRadius = currentBall.radius * radiusFactor * blastMult;
      for (const b of physicsWorld.balls) {
        if (Math.hypot(b.x - endX, b.y - endY) <= aoeRadius) {
          highlight.push(b);
          if (specType === SPECIAL_TYPES.BOMB) {
            destroyedIds.add(b.id);
          }
        }
      }
    } else if (specType === SPECIAL_TYPES.LIGHTNING) {
      const bandHalf = currentBall.radius * specCfg.bandHalfHeightFactor * blastMult;
      for (const b of physicsWorld.balls) {
        if (Math.abs(b.y - endY) <= bandHalf) {
          highlight.push(b);
          destroyedIds.add(b.id);
        }
      }
    } else if (specType === SPECIAL_TYPES.RAINBOW) {
      const neighborRadius = currentBall.radius * specCfg.neighborRadiusFactor;
      const seen = new Set();
      for (const other of physicsWorld.balls) {
        if (seen.has(other.id) || !other.colorId || Math.hypot(other.x - endX, other.y - endY) > neighborRadius) {
          continue;
        }
        for (const member of physicsWorld.findColorCluster(other)) {
          if (!seen.has(member.id)) {
            seen.add(member.id);
            highlight.push(member);
            if (member.armorHits <= 1) {
              destroyedIds.add(member.id);
            }
          }
        }
      }
    } else if (specType === SPECIAL_TYPES.ANVIL) {
      const pierceRadius = currentBall.radius * specCfg.pierceRadiusFactor;
      const pierceRadiusSq = pierceRadius * pierceRadius;
      for (const b of physicsWorld.balls) {
        for (const pt of points) {
          const dx = b.x - pt.x;
          const dy = b.y - pt.y;
          if (dx * dx + dy * dy <= pierceRadiusSq) {
            highlight.push(b);
            destroyedIds.add(b.id);
            break;
          }
        }
      }
    }
    isMatch = true;
  } else if (points.snapTarget) {
    const target = points.snapTarget;
    const isMatchingColor = currentBall.colorId && currentBall.colorId === target.colorId;
    if (isMatchingColor) {
      for (const member of physicsWorld.findColorCluster(target)) {
        highlight.push(member);
      }
    } else {
      highlight.push(target);
    }
    isMatch = Boolean(isMatchingColor && highlight.length + 1 >= matchMinCount);
    if (isMatch) {
      for (const member of highlight) {
        if (member.armorHits <= 1) {
          destroyedIds.add(member.id);
        }
      }
    }
  }

  return { highlight, destroyedIds, isMatch };
}

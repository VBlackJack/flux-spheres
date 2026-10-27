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

import { MATH_CONSTANTS } from './Constants.js';

/**
 * World geometry derived from the world size, so the board can change width or height
 * without editing every position. Level and Flux coordinates are authored for a board of
 * canvas.designWidth and centered in the actual world; the launcher and the danger line
 * hang from the bottom of the world.
 */

/**
 * Fills the derived canvas fields from the world size: launcherX, launcherY, dangerLineY
 * and contentOffsetX. Call it once the game config is loaded, and again whenever the world
 * size changes; every other module reads the derived fields.
 * @param {{canvas: Object}} gameConfig - Game configuration, updated in place.
 * @returns {Object} The same game configuration.
 */
export function applyWorldGeometry(gameConfig) {
  const canvas = gameConfig.canvas;
  canvas.launcherX = canvas.logicalWidth * MATH_CONSTANTS.HALF;
  canvas.launcherY = canvas.logicalHeight - canvas.launcherBottomOffset;
  canvas.dangerLineY = canvas.logicalHeight - canvas.dangerLineBottomOffset;
  canvas.contentOffsetX = (canvas.logicalWidth - canvas.designWidth) * MATH_CONSTANTS.HALF;
  return gameConfig;
}

/**
 * A layout spec moved sideways: the balls' x shift by dx; links and offsets stay relative.
 * @param {{balls: Array<{x: number}>}} spec - Layout spec from a layout generator.
 * @param {number} dx - Horizontal shift.
 * @returns {Object} A new spec.
 */
export function shiftSpecX(spec, dx) {
  if (dx === 0) {
    return spec;
  }
  return { ...spec, balls: spec.balls.map((ball) => ({ ...ball, x: ball.x + dx })) };
}

/**
 * Obstacle definitions moved sideways.
 * @param {Array<{x: number}>} defs - Obstacle definitions.
 * @param {number} dx - Horizontal shift.
 * @returns {Array<Object>} New definitions.
 */
export function shiftObstacleDefsX(defs, dx) {
  if (dx === 0) {
    return defs;
  }
  return defs.map((def) => ({ ...def, x: def.x + dx }));
}

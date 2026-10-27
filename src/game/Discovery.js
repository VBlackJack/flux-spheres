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

import { BOARD_MECHANICS, CLUSTER_MODIFIERS, OBSTACLE_TYPES } from '../core/Constants.js';

/**
 * First-encounter hints: which mechanics a board or a level shows, which one the player
 * has not met yet, and the text that explains it. Pure functions, no DOM and no storage.
 */

const MODIFIER_IDS = new Set(Object.values(CLUSTER_MODIFIERS));
const OBSTACLE_IDS = new Set(Object.values(OBSTACLE_TYPES));

/** Locale template for a mechanic explained by its Codex entry. */
const CODEX_HINT_KEY = 'gameplay.discovery.hint';

/**
 * Mechanics visible on a board. The basic rules are always part of it.
 * @param {Array<{clusterModifier: ?string, railMinX: ?number}>} balls - Board balls.
 * @param {Array<{type: string}>} obstacles - Board obstacles.
 * @returns {Set<string>} Mechanic ids.
 */
export function listBoardMechanics(balls, obstacles) {
  const present = new Set([BOARD_MECHANICS.BASICS]);
  for (const ball of balls) {
    if (ball.clusterModifier) {
      present.add(ball.clusterModifier);
    }
    if (ball.railMinX !== null && ball.railMinX !== undefined) {
      present.add(BOARD_MECHANICS.RAIL);
    }
  }
  for (const obstacle of obstacles) {
    present.add(obstacle.type);
  }
  return present;
}

/**
 * Mechanics a campaign level can show.
 * @param {Object} levelDef - Level definition from configs/levels.json.
 * @param {{guaranteedOnly?: boolean}} [options] - With guaranteedOnly, leaves out the
 *   modifiers that only have a weight, since a weighted roll may never land.
 * @returns {Set<string>} Mechanic ids.
 */
export function listLevelMechanics(levelDef, { guaranteedOnly = false } = {}) {
  const present = new Set([BOARD_MECHANICS.BASICS]);
  for (const obstacle of levelDef.obstacles || []) {
    present.add(obstacle.type);
  }
  for (const anchor of levelDef.layout?.anchors || []) {
    if (anchor.neutral) {
      present.add(CLUSTER_MODIFIERS.NEUTRAL_ANCHOR);
    }
    if (anchor.rail > 0) {
      present.add(BOARD_MECHANICS.RAIL);
    }
  }
  for (const [modKey, count] of Object.entries(levelDef.minModifierCounts || {})) {
    if (count > 0) {
      present.add(modKey);
    }
  }
  if (!guaranteedOnly) {
    for (const [modKey, weight] of Object.entries(levelDef.modifierWeights || {})) {
      if (weight > 0) {
        present.add(modKey);
      }
    }
  }
  return present;
}

/**
 * The first mechanic of the discovery order that is present and not met yet. Prioritized
 * mechanics, such as the ones a campaign level is built around, go before the others.
 * @param {Set<string>} present - Mechanics on the board.
 * @param {Object<string, boolean>} seen - Mechanics already discovered.
 * @param {string[]} order - Discovery priority.
 * @param {Set<string>} [prioritized] - Mechanics to explain first, still in discovery order.
 * @returns {?string} Mechanic id, or null when everything present is known.
 */
export function pickNextDiscovery(present, seen, order, prioritized = new Set()) {
  const isNew = (id) => present.has(id) && !seen[id];
  return order.find((id) => prioritized.has(id) && isNew(id)) || order.find(isNew) || null;
}

/**
 * The mechanic and every other one explained by the same text, so a shared tutorial
 * (the three cores) is shown once rather than three times.
 * @param {string} mechanicId - Mechanic being discovered.
 * @param {Object<string, {hintKey?: string}>} mechanics - onboarding.mechanics.
 * @returns {string[]} Mechanic ids.
 */
export function listMechanicsSharingHint(mechanicId, mechanics) {
  const hintKey = mechanics[mechanicId]?.hintKey;
  if (!hintKey) {
    return [mechanicId];
  }
  return Object.keys(mechanics).filter((id) => mechanics[id].hintKey === hintKey);
}

/**
 * Text of a mechanic's hint: its tutorial when it has one, else its Codex entry.
 * @param {string} mechanicId - Mechanic to explain.
 * @param {{mechanics: Object}} onboardingConfig - onboarding section of configs/game.json.
 * @param {{clusterModifiers: Object}} ballsConfig - Balls configuration (Codex badges).
 * @param {function(string, Object=): string} translate - Translation function.
 * @returns {string} Hint text, empty for an unknown mechanic.
 */
export function resolveHintText(mechanicId, onboardingConfig, ballsConfig, translate) {
  const hintKey = onboardingConfig.mechanics[mechanicId]?.hintKey;
  if (hintKey) {
    return translate(hintKey);
  }
  if (MODIFIER_IDS.has(mechanicId)) {
    const codexKey = `modals.shop.codex.modifiers.${mechanicId}`;
    return translate(CODEX_HINT_KEY, {
      icon: ballsConfig.clusterModifiers[mechanicId]?.badge || '',
      name: translate(`${codexKey}.name`),
      description: translate(`${codexKey}.description`)
    });
  }
  if (OBSTACLE_IDS.has(mechanicId)) {
    const codexKey = `modals.shop.codex.obstacles.${mechanicId}`;
    return translate(CODEX_HINT_KEY, {
      icon: translate(`${codexKey}.icon`),
      name: translate(`${codexKey}.name`),
      description: translate(`${codexKey}.description`)
    });
  }
  return '';
}

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

import { GAME_MODES, GAME_STATES } from '../core/Constants.js';
import { Ball } from '../entities/Ball.js';

/** Sentinel stored in place of an obstacle index when a ball has no pivot. */
const NO_PIVOT_INDEX = -1;

/** Engine scalars copied verbatim between the engine and a snapshot. */
const ENGINE_SCALAR_FIELDS = [
  'currentLevelId',
  'score',
  'combo',
  'overcharge',
  'shotsRemaining',
  'waveCount',
  'endlessRowParity',
  'shotsUntilWave',
  'freezeTurnsRemaining',
  'chainCooldown',
  'outOfShotsGraceFrames',
  'hasFiredInRound',
  'bossesDestroyedInRun',
  'activeTutorialKey',
  'isPolarityFlipped',
  'stashedRegularColorId',
  'aimAngle',
  'fluxSeed',
  'fluxStage',
  'fluxPreviousFamily'
];

/** Ball fields copied verbatim; identity, bonds and the pivot link are handled separately. */
const BALL_SCALAR_FIELDS = [
  'x',
  'y',
  'prevX',
  'prevY',
  'vx',
  'vy',
  'radius',
  'colorId',
  'specialType',
  'clusterModifier',
  'armorHits',
  'isAnchor',
  'anchorX',
  'anchorY',
  'isFrozen',
  'pivotRadius',
  'pivotAngle'
];

/** Obstacle fields that change during play; the rest is rebuilt from the level definition. */
const OBSTACLE_MOTION_FIELDS = [
  'x',
  'y',
  'prevX',
  'prevY',
  'baseX',
  'baseY',
  'angle',
  'prevAngle',
  'angularVelocity',
  'motorAngularSpeed',
  'oscillatePhase',
  'disabled'
];

// Fields absent from the source are left alone, so a run saved before a field existed
// keeps the target's own value for it.
const copyFields = (target, source, fields) => {
  for (const field of fields) {
    if (source[field] !== undefined) {
      target[field] = source[field];
    }
  }
};

/** Primitive types a field may take when the live object currently holds null. */
const NULLABLE_FIELD_TYPES = new Set(['string', 'number', 'boolean']);

/**
 * True when a saved value can replace the live one: same primitive type (a finite number
 * for numbers), or any primitive or null where the live field is currently empty.
 */
const isCompatibleValue = (current, saved) => {
  if (typeof saved === 'number' && !Number.isFinite(saved)) {
    return false;
  }
  if (current === null || current === undefined) {
    return saved === null || NULLABLE_FIELD_TYPES.has(typeof saved);
  }
  return typeof saved === typeof current;
};

/**
 * Copies saved fields onto a live object and throws on a value of the wrong type, so a
 * snapshot that still parses but holds, say, a text score is discarded instead of being
 * concatenated into the run.
 */
const restoreFields = (target, source, fields) => {
  for (const field of fields) {
    if (source[field] === undefined) {
      continue;
    }
    if (!isCompatibleValue(target[field], source[field])) {
      throw new TypeError(`Saved run field ${field} has an unexpected value`);
    }
    target[field] = source[field];
  }
};

const pickFields = (source, fields) => {
  const out = {};
  copyFields(out, source, fields);
  return out;
};

/**
 * True when the run can be captured without losing anything: a run is in progress,
 * no projectile is in flight and no Flux shape is being replaced. Falling avalanche
 * balls are already rewarded and are purely visual, so they do not block a capture.
 * @param {import('./GameEngine.js').GameEngine} engine
 */
export function isRunSnapshotable(engine) {
  const isRunActive = engine.state === GAME_STATES.PLAYING || engine.state === GAME_STATES.PAUSED;
  return (
    isRunActive &&
    !engine.physicsWorld.projectile &&
    !(engine.stageTransitionFrames > 0) &&
    Boolean(engine.currentBall) &&
    Boolean(engine.nextBall)
  );
}

/**
 * Serializes the run into a JSON-safe object, or returns null when the run is not
 * in a capturable state (see isRunSnapshotable).
 * @param {import('./GameEngine.js').GameEngine} engine
 * @param {number} version - Snapshot format version written into the result.
 * @returns {object|null}
 */
export function captureRunSnapshot(engine, version) {
  if (!isRunSnapshotable(engine)) {
    return null;
  }
  const world = engine.physicsWorld;
  const obstacleIndex = new Map(world.obstacles.map((obs, idx) => [obs, idx]));

  return {
    version,
    mode: engine.mode,
    dailySeedKey: engine.dailySeedKey,
    rngState: engine.seededRng ? engine.seededRng.state : null,
    engine: pickFields(engine, ENGINE_SCALAR_FIELDS),
    specialInventory: { ...engine.specialInventory },
    currentBall: { colorId: engine.currentBall.colorId, specialType: engine.currentBall.specialType },
    nextBall: { colorId: engine.nextBall.colorId, specialType: engine.nextBall.specialType },
    allowTensionBreak: world.allowTensionBreak,
    pendingChainCandidateIds: Array.from(world.pendingChainCandidateIds),
    obstacles: world.obstacles.map((obs) => ({ type: obs.type, ...pickFields(obs, OBSTACLE_MOTION_FIELDS) })),
    balls: world.balls.map((ball) => ({
      id: ball.id,
      ...pickFields(ball, BALL_SCALAR_FIELDS),
      bonds: Array.from(ball.bonds),
      pivotIndex: ball.pivotRef && obstacleIndex.has(ball.pivotRef) ? obstacleIndex.get(ball.pivotRef) : NO_PIVOT_INDEX
    }))
  };
}

/**
 * Structural check run before any engine state is touched, so a corrupted or
 * outdated snapshot is rejected instead of half-applied.
 * @param {*} snapshot
 * @param {number} version - Snapshot format version this build understands.
 * @returns {boolean}
 */
export function isValidRunSnapshot(snapshot, version) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== version) {
    return false;
  }
  if (!Object.values(GAME_MODES).includes(snapshot.mode)) {
    return false;
  }
  if (snapshot.mode === GAME_MODES.DAILY && typeof snapshot.dailySeedKey !== 'string') {
    return false;
  }
  if (
    snapshot.mode === GAME_MODES.FLUX &&
    (typeof snapshot.engine?.fluxSeed !== 'string' || !Number.isInteger(snapshot.engine.fluxStage) || snapshot.engine.fluxStage < 1)
  ) {
    return false;
  }
  return (
    Array.isArray(snapshot.balls) &&
    snapshot.balls.length > 0 &&
    Array.isArray(snapshot.obstacles) &&
    Array.isArray(snapshot.pendingChainCandidateIds) &&
    Boolean(snapshot.engine && typeof snapshot.engine === 'object') &&
    Boolean(snapshot.specialInventory && typeof snapshot.specialInventory === 'object') &&
    Boolean(snapshot.currentBall && snapshot.nextBall)
  );
}

/**
 * Rebuilds the board of the snapshot's mode (obstacles, palette, mutators), then
 * replaces its balls and live state with the saved ones. The run resumes paused.
 * @param {import('./GameEngine.js').GameEngine} engine
 * @param {object} snapshot - A snapshot accepted by isValidRunSnapshot.
 * @returns {boolean} False when the rebuilt board does not match the snapshot; the
 *   freshly started run is then left in place.
 */
export function applyRunSnapshot(engine, snapshot) {
  if (snapshot.mode === GAME_MODES.CAMPAIGN) {
    engine.startCampaignLevel(snapshot.engine.currentLevelId);
  } else if (snapshot.mode === GAME_MODES.DAILY) {
    engine.startDailyChallenge(snapshot.dailySeedKey, true);
  } else if (snapshot.mode === GAME_MODES.FLUX) {
    engine.restoreFluxRun(snapshot.engine.fluxSeed, snapshot.engine.fluxStage, snapshot.engine.fluxPreviousFamily);
  } else {
    engine.startEndlessMode();
  }

  const world = engine.physicsWorld;
  const typesMatch = snapshot.obstacles.every((obs, idx) => world.obstacles[idx]?.type === obs.type);
  if (world.obstacles.length !== snapshot.obstacles.length || !typesMatch) {
    return false;
  }

  snapshot.obstacles.forEach((saved, idx) => {
    restoreFields(world.obstacles[idx], saved, OBSTACLE_MOTION_FIELDS);
  });

  for (const ball of [...world.balls]) {
    world.removeBall(ball);
  }
  world.spatialGrid.clear();

  const newIdBySavedId = new Map();
  const restored = snapshot.balls.map((saved) => {
    const ball = new Ball({ x: saved.x, y: saved.y, radius: saved.radius, colorId: saved.colorId });
    restoreFields(ball, saved, BALL_SCALAR_FIELDS);
    ball.pivotRef = saved.pivotIndex === NO_PIVOT_INDEX ? null : world.obstacles[saved.pivotIndex] || null;
    newIdBySavedId.set(saved.id, ball.id);
    world.addBall(ball);
    return ball;
  });

  snapshot.balls.forEach((saved, idx) => {
    for (const savedNeighborId of saved.bonds) {
      const neighborId = newIdBySavedId.get(savedNeighborId);
      if (neighborId !== undefined) {
        restored[idx].bonds.add(neighborId);
      }
    }
  });

  for (const savedId of snapshot.pendingChainCandidateIds) {
    const newId = newIdBySavedId.get(savedId);
    if (newId !== undefined) {
      world.pendingChainCandidateIds.add(newId);
    }
  }
  world.allowTensionBreak = Boolean(snapshot.allowTensionBreak);

  restoreFields(engine, snapshot.engine, ENGINE_SCALAR_FIELDS);
  engine.specialInventory = { ...snapshot.specialInventory };
  if (engine.seededRng && Number.isFinite(snapshot.rngState)) {
    engine.seededRng.state = snapshot.rngState;
  }
  engine.currentBall = engine.createRandomLauncherBall(snapshot.currentBall.specialType, snapshot.currentBall.colorId);
  engine.nextBall = engine.createRandomLauncherBall(snapshot.nextBall.specialType, snapshot.nextBall.colorId);
  engine.state = GAME_STATES.PAUSED;
  world.aimCacheValid = false;
  engine.updateAimFromAngle(engine.aimAngle);
  return true;
}

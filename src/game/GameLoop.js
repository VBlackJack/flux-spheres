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

import { GAME_STATES } from '../core/Constants.js';

/**
 * Returns true when the next engine.update() call will advance the physics simulation,
 * i.e. the game is playing and no hit-stop freeze is pending.
 * @param {object} engine - Game engine exposing state and hitStopFrames.
 * @returns {boolean}
 */
export function willSimulationAdvance(engine) {
  return engine.state === GAME_STATES.PLAYING && engine.hitStopFrames <= 0;
}

/**
 * Creates a fixed-timestep game loop with render interpolation.
 *
 * Interpolation alpha is forced to 1 whenever the last update did not advance the
 * simulation (hit-stop, pause, menus), because previous positions are only saved by a
 * real physics step. While the engine is neither playing nor celebrating a victory, the
 * scene is static and is redrawn at the configured idle interval instead of every frame. Any exception
 * thrown by update or render stops the loop for good and is reported once.
 *
 * @param {object} options
 * @param {object} options.engine - Game engine (update(), state, hitStopFrames, and an
 *   optional getTimeScale() below 1 for slow motion).
 * @param {object} options.renderer - Renderer exposing render(engine, alpha).
 * @param {number} options.fixedStepMs - Fixed simulation step in milliseconds.
 * @param {number} options.maxAccumulatedMs - Upper bound of elapsed time per frame.
 * @param {number} options.idleRenderIntervalMs - Redraw interval while not playing.
 * @param {Function} options.scheduleFrame - requestAnimationFrame-like scheduler.
 * @param {Function} options.onFatalError - Called once with the thrown error.
 * @returns {{start: Function, frame: Function, isStopped: Function}}
 */
export function createGameLoop({
  engine,
  renderer,
  fixedStepMs,
  maxAccumulatedMs,
  idleRenderIntervalMs,
  scheduleFrame,
  onFatalError
}) {
  let lastTime = null;
  let accumulator = 0;
  let lastUpdateAdvanced = false;
  let lastRenderTime = null;
  let stopped = false;

  const frame = (now) => {
    if (stopped) {
      return;
    }
    try {
      const elapsed = lastTime === null ? 0 : Math.min(maxAccumulatedMs, Math.max(0, now - lastTime));
      lastTime = now;
      // Slow motion: fewer fixed steps per real second; interpolation keeps it smooth.
      const timeScale = typeof engine.getTimeScale === 'function' ? engine.getTimeScale() : 1;
      accumulator += elapsed * timeScale;

      while (accumulator >= fixedStepMs) {
        lastUpdateAdvanced = willSimulationAdvance(engine);
        engine.update();
        accumulator -= fixedStepMs;
      }

      const alpha = lastUpdateAdvanced && fixedStepMs > 0 ? accumulator / fixedStepMs : 1.0;
      const isLive = engine.state === GAME_STATES.PLAYING || engine.isVictoryCelebrating();
      if (isLive || lastRenderTime === null || now - lastRenderTime >= idleRenderIntervalMs) {
        renderer.render(engine, alpha);
        lastRenderTime = now;
      }
      scheduleFrame(frame);
    } catch (err) {
      stopped = true;
      onFatalError(err);
    }
  };

  return {
    start() {
      scheduleFrame(frame);
    },
    frame,
    isStopped() {
      return stopped;
    }
  };
}

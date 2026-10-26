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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { configRegistry } from '../src/core/ConfigRegistry.js';
import { StorageManager } from '../src/core/StorageManager.js';
import { AudioManager } from '../src/core/AudioManager.js';
import { GameEngine } from '../src/game/GameEngine.js';
import { Renderer } from '../src/game/Renderer.js';
import { createGameLoop } from '../src/game/GameLoop.js';
import { GAME_STATES } from '../src/core/Constants.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const gameConfig = loadJson('./configs/game.json');
const physicsConfig = loadJson('./configs/physics.json');
const ballsConfig = loadJson('./configs/balls.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const levelsConfig = loadJson('./configs/levels.json');
const audioConfig = loadJson('./configs/audio.json');

configRegistry.configs.set('game', gameConfig);
configRegistry.configs.set('physics', physicsConfig);
configRegistry.configs.set('balls', ballsConfig);
configRegistry.configs.set('obstacles', obstaclesConfig);
configRegistry.configs.set('levels', levelsConfig);
configRegistry.configs.set('audio', audioConfig);

const FIXED_STEP_MS = 10;
const MAX_ACCUMULATED_MS = 100;

/** Canvas 2D context stub: every method is a no-op, gradients accept color stops. */
const createStubContext = () => {
  const state = {};
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop() {} });
      }
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
};

const createStubCanvas = () => {
  const ctx = createStubContext();
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 })
  };
};

const createRenderer = () => {
  const renderer = new Renderer(createStubCanvas(), gameConfig, ballsConfig, obstaclesConfig);
  renderer.createLayerCanvas = () => createStubCanvas();
  return renderer;
};

const createTestEngine = () => {
  const storageManager = new StorageManager();
  storageManager.init();
  const dummyAudio = {
    playEffect: () => {},
    stopAll: () => {},
    isMuted: () => true,
    setMuted: () => {}
  };
  return new GameEngine({
    gameConfig,
    physicsConfig,
    ballsConfig,
    obstaclesConfig,
    levelsConfig,
    audioManager: dummyAudio,
    storageManager,
    onStateChange: () => {}
  });
};

const createLoopHarness = (engine, renderer) => {
  const scheduled = [];
  const errors = [];
  const loop = createGameLoop({
    engine,
    renderer,
    fixedStepMs: FIXED_STEP_MS,
    maxAccumulatedMs: MAX_ACCUMULATED_MS,
    idleRenderIntervalMs: 0,
    scheduleFrame: (cb) => scheduled.push(cb),
    onFatalError: (err) => errors.push(err)
  });
  return { loop, scheduled, errors };
};

test('Game loop stops after an update throws and never calls update again', () => {
  let updates = 0;
  const engine = {
    state: GAME_STATES.PLAYING,
    hitStopFrames: 0,
    update() {
      updates++;
      if (updates === 2) {
        throw new Error('simulated failure');
      }
    }
  };
  const renderer = { render: () => {} };
  const { loop, scheduled, errors } = createLoopHarness(engine, renderer);

  loop.frame(0);
  loop.frame(FIXED_STEP_MS);
  loop.frame(FIXED_STEP_MS * 2);
  assert.equal(updates, 2);
  assert.equal(errors.length, 1);
  assert.ok(loop.isStopped());

  const scheduledBefore = scheduled.length;
  loop.frame(FIXED_STEP_MS * 3);
  loop.frame(FIXED_STEP_MS * 4);
  assert.equal(updates, 2, 'update must not run after a fatal error');
  assert.equal(scheduled.length, scheduledBefore, 'no frame may be scheduled after a fatal error');
  assert.equal(errors.length, 1, 'the error is reported once');
});

test('Game loop stops after a render throws', () => {
  let updates = 0;
  const engine = { state: GAME_STATES.PLAYING, hitStopFrames: 0, update: () => updates++ };
  const renderer = {
    render() {
      throw new Error('render failure');
    }
  };
  const { loop, errors } = createLoopHarness(engine, renderer);
  loop.frame(0);
  loop.frame(FIXED_STEP_MS * 3);
  assert.equal(errors.length, 1);
  assert.equal(updates, 0);
});

test('Render alpha is 1 when no simulation step advanced, interpolated otherwise', () => {
  const alphas = [];
  const engine = {
    state: GAME_STATES.PLAYING,
    hitStopFrames: 0,
    update: () => {},
    isVictoryCelebrating: () => false
  };
  const renderer = { render: (_eng, alpha) => alphas.push(alpha) };
  const { loop } = createLoopHarness(engine, renderer);

  loop.frame(0);
  loop.frame(FIXED_STEP_MS * 1.5);
  assert.equal(alphas.at(-1), 0.5, 'a real step interpolates with the remainder');

  engine.state = GAME_STATES.PAUSED;
  loop.frame(FIXED_STEP_MS * 3.2);
  assert.equal(alphas.at(-1), 1.0, 'paused: alpha must be 1');
  loop.frame(FIXED_STEP_MS * 3.7);
  assert.equal(alphas.at(-1), 1.0, 'still paused without new steps: alpha must stay 1');

  engine.state = GAME_STATES.PLAYING;
  engine.hitStopFrames = 5;
  engine.update = () => {
    engine.hitStopFrames--;
  };
  loop.frame(FIXED_STEP_MS * 5.4);
  assert.equal(alphas.at(-1), 1.0, 'hit-stop: alpha must be 1');

  engine.hitStopFrames = 0;
  engine.stageTransitionFrames = 10;
  engine.update = () => {
    engine.stageTransitionFrames--;
  };
  loop.frame(FIXED_STEP_MS * 6.9);
  assert.equal(alphas.at(-1), 1.0, 'Flux stage transition: alpha must be 1');
});

test('Game loop throttles rendering while the engine is not playing', () => {
  let renders = 0;
  const engine = {
    state: GAME_STATES.PAUSED,
    hitStopFrames: 0,
    update: () => {},
    isVictoryCelebrating: () => false
  };
  const loop = createGameLoop({
    engine,
    renderer: { render: () => renders++ },
    fixedStepMs: FIXED_STEP_MS,
    maxAccumulatedMs: MAX_ACCUMULATED_MS,
    idleRenderIntervalMs: gameConfig.canvas.idleRenderIntervalMs,
    scheduleFrame: () => {},
    onFatalError: () => {}
  });
  loop.frame(0);
  loop.frame(1);
  loop.frame(2);
  assert.equal(renders, 1);
  loop.frame(gameConfig.canvas.idleRenderIntervalMs);
  assert.equal(renders, 2);
  engine.state = GAME_STATES.PLAYING;
  loop.frame(gameConfig.canvas.idleRenderIntervalMs + 1);
  assert.equal(renders, 3);
});

test('Game loop renders every frame while a victory is being celebrated', () => {
  let renders = 0;
  let celebrating = true;
  const engine = {
    state: GAME_STATES.VICTORY,
    hitStopFrames: 0,
    update: () => {},
    isVictoryCelebrating: () => celebrating
  };
  const loop = createGameLoop({
    engine,
    renderer: { render: () => renders++ },
    fixedStepMs: FIXED_STEP_MS,
    maxAccumulatedMs: MAX_ACCUMULATED_MS,
    idleRenderIntervalMs: gameConfig.canvas.idleRenderIntervalMs,
    scheduleFrame: () => {},
    onFatalError: () => {}
  });
  loop.frame(0);
  loop.frame(1);
  loop.frame(2);
  assert.equal(renders, 3);
  celebrating = false;
  loop.frame(3);
  assert.equal(renders, 3, 'once the celebration ends the static scene is throttled again');
});

/** Minimal Web Audio stub counting oscillators and recording the output chain. */
class StubAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = { id: 'destination' };
    this.oscillatorsCreated = 0;
    StubAudioContext.last = this;
  }

  createParam() {
    return { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  }

  createOscillator() {
    this.oscillatorsCreated++;
    return {
      frequency: this.createParam(),
      connect() {},
      disconnect() {},
      start() {},
      stop() {}
    };
  }

  createGain() {
    const node = { gain: this.createParam(), connectedTo: null, disconnect() {} };
    node.connect = (target) => {
      node.connectedTo = target;
    };
    return node;
  }

  createDynamicsCompressor() {
    const node = {
      threshold: this.createParam(),
      knee: this.createParam(),
      ratio: this.createParam(),
      attack: this.createParam(),
      release: this.createParam(),
      connectedTo: null
    };
    node.connect = (target) => {
      node.connectedTo = target;
    };
    this.compressor = node;
    return node;
  }

  suspend() {
    this.state = 'suspended';
  }

  resume() {
    this.state = 'running';
  }
}

test('AudioManager caps simultaneous voices and routes them through a limiter', () => {
  globalThis.window = { AudioContext: StubAudioContext };
  try {
    const audio = new AudioManager();
    audio.init(false, false);
    const attempts = audioConfig.maxVoices * 3;
    for (let i = 0; i < attempts; i++) {
      audio.playTone('sine', 440, 220, 0.1);
    }
    const ctx = StubAudioContext.last;
    assert.equal(audio.getActiveVoiceCount(), audioConfig.maxVoices);
    assert.equal(ctx.oscillatorsCreated, audioConfig.maxVoices);
    assert.equal(ctx.compressor.connectedTo, ctx.destination, 'limiter must feed the destination');

    audio.setMuted(true);
    assert.equal(ctx.state, 'suspended', 'muting suspends the context');
    audio.setMuted(false);
    assert.equal(ctx.state, 'running', 'unmuting resumes the context');
  } finally {
    delete globalThis.window;
  }
});

test('AudioManager throttles repeated effects within the minimum interval', () => {
  globalThis.window = { AudioContext: StubAudioContext };
  try {
    const audio = new AudioManager();
    audio.init(false, false);
    let nowMs = 0;
    audio.clock = () => nowMs;
    audio.playEffect('bounce');
    audio.playEffect('bounce');
    audio.playEffect('bounce');
    const ctx = StubAudioContext.last;
    assert.equal(ctx.oscillatorsCreated, 1, 'a burst of the same effect plays once');
    nowMs += audioConfig.effectMinIntervalMs;
    audio.playEffect('bounce');
    assert.equal(ctx.oscillatorsCreated, 2, 'the effect plays again after the interval');
  } finally {
    delete globalThis.window;
  }
});

test('Aim preview cache is not recomputed while aim and board are unchanged', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  engine.updateAim(gameConfig.canvas.launcherX, gameConfig.canvas.launcherY + gameConfig.canvas.initialAimOffsetY);
  assert.ok(engine.aimPoints.snapTarget, 'the default aim must hit a ball in level 1');

  const renderer = createRenderer();
  const world = engine.physicsWorld;
  let clusterCalls = 0;
  const originalFind = world.findColorCluster.bind(world);
  world.findColorCluster = (ball) => {
    clusterCalls++;
    return originalFind(ball);
  };
  engine.currentBall.colorId = engine.aimPoints.snapTarget.colorId;

  const draw = () =>
    renderer.drawAimTrajectory(
      renderer.ctx,
      engine.aimPoints,
      engine.currentBall,
      world,
      gameConfig.theme,
      0,
      engine.getBlastRadiusMultiplier(),
      engine.aimAngle,
      1.0
    );

  draw();
  draw();
  draw();
  assert.equal(renderer.aimPreviewComputeCount, 1);
  assert.equal(clusterCalls, 1);

  const removable = world.balls.find((b) => b !== engine.aimPoints.snapTarget);
  world.removeBall(removable);
  draw();
  assert.equal(renderer.aimPreviewComputeCount, 2, 'a board change must invalidate the preview');
});

test('Full render pass runs against a stub context without mutating launcher balls', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const renderer = createRenderer();
  const current = engine.currentBall;
  const before = { x: current.x, y: current.y, prevX: current.prevX, prevY: current.prevY };
  renderer.render(engine, 0.5);
  renderer.render(engine, 1.0);
  assert.deepEqual(
    { x: current.x, y: current.y, prevX: current.prevX, prevY: current.prevY },
    before,
    'rendering must not write positions into engine state'
  );
  assert.equal(renderer.canvas.width, Math.round(gameConfig.canvas.logicalWidth * renderer.dpr));
});

test('Reduced motion drops decorative particles but keeps the informative floating texts', () => {
  const engine = createTestEngine();
  engine.startCampaignLevel(1);
  const particles = engine.particleSystem;
  const spot = gameConfig.canvas.launcherX;
  particles.spawnBurst(spot, spot, '#ffffff');
  particles.spawnFloatingText(spot, spot, 'kept', '#ffffff');

  engine.setReducedMotion(true);
  assert.equal(particles.particles.length, 0, 'switching on clears the running effects');
  assert.equal(particles.floatingTexts.length, 1);

  particles.spawnBurst(spot, spot, '#ffffff');
  particles.spawnTrail(spot, spot, physicsConfig.ball.radius, '#ffffff');
  particles.spawnShockwave(spot, spot, '#ffffff');
  particles.spawnLightning(spot, 0, gameConfig.canvas.logicalWidth, '#ffffff');
  particles.addScreenShake(gameConfig.juice.matchShake);
  particles.spawnFloatingText(spot, spot, 'still shown', '#ffffff');

  assert.equal(particles.particles.length, 0);
  assert.equal(particles.trailParticles.length, 0);
  assert.equal(particles.shockwaves.length, 0);
  assert.equal(particles.lightningBolts.length, 0);
  assert.equal(particles.shakeIntensity, 0);
  assert.equal(particles.floatingTexts.length, 2);
  assert.doesNotThrow(() => createRenderer().render(engine, 1.0));
});

test('A rotor board traces the aim preview once per rendered frame, not once per step', () => {
  const engine = createTestEngine();
  engine.startDailyChallenge('2025-01-01');
  const world = engine.physicsWorld;
  assert.ok(world.obstacles.some((obs) => obs.angularVelocity !== undefined), 'the Daily board has a rotor');
  const renderer = { render: () => {} };
  const { loop } = createLoopHarness(engine, renderer);
  const stepsPerFrame = 4;

  loop.frame(0);
  const before = world.aimTrajectoryComputeCount;
  loop.frame(FIXED_STEP_MS * stepsPerFrame);
  assert.equal(world.aimTrajectoryComputeCount - before, 1);
});

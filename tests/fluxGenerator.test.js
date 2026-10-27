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

import { applyWorldGeometry } from '../src/core/WorldGeometry.js';
import { LAYOUT_TYPES } from '../src/core/Constants.js';
import { generateLayout, MASK_CELLS } from '../src/game/layouts/LayoutGenerators.js';
import { FLUX_FAMILIES, generateFluxStage, listValidGeneratedParams } from '../src/game/layouts/FluxStageGenerator.js';
import {
  GENERATED_FILLS,
  GENERATED_SHAPE_TYPES,
  buildGeneratedRows,
  decodeGeneratedShapeId,
  encodeGeneratedShapeId,
  maskFingerprint
} from '../src/game/layouts/ShapeGenerator.js';

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const gameConfig = applyWorldGeometry(loadJson('./configs/game.json'));
const physicsConfig = loadJson('./configs/physics.json');
const fluxConfig = loadJson('./configs/flux.json');
const obstaclesConfig = loadJson('./configs/obstacles.json');
const locales = { fr: loadJson('./locales/fr.json'), en: loadJson('./locales/en.json') };

/** The variety the generator promises. */
const MIN_DISTINCT_SHAPES = 1000;
/** How far the sampled share of generated shapes may stray from the configured weight. */
const SHARE_TOLERANCE = 0.05;
const SAMPLE_SEEDS = 60;
const SAMPLE_STAGES = 30;
/** Parameter sets checked for a lossless id round trip. */
const ROUND_TRIP_SAMPLE = 50;

const generated = fluxConfig.generated;
const valid = listValidGeneratedParams(generated);
const buildRows = (params) => buildGeneratedRows(params, generated.limits);

test('The generator yields at least 1000 distinct playable shapes, from every shape type', () => {
  const fingerprints = new Set(valid.map((params) => maskFingerprint(buildRows(params))));
  assert.ok(
    fingerprints.size >= MIN_DISTINCT_SHAPES,
    `${fingerprints.size} distinct shapes, at least ${MIN_DISTINCT_SHAPES} expected`
  );
  const types = new Set(valid.map((params) => params.type));
  assert.deepEqual([...types].sort(), Object.values(GENERATED_SHAPE_TYPES).sort());
});

test('Every generated shape fits the board and hangs from its anchors', () => {
  const canvas = gameConfig.canvas;
  const radius = physicsConfig.ball.radius;
  const lowestAllowedY = canvas.dangerLineY - canvas.dangerWarningMarginY;
  const bondReach = radius * physicsConfig.simulation.bondCreationDistanceFactor;
  const { centerX, spacing, maskTopY } = fluxConfig.layout;
  for (const params of valid) {
    const label = encodeGeneratedShapeId(params);
    const rows = buildRows(params);
    const balls = generateLayout({ type: LAYOUT_TYPES.MASK, rows, centerX, topY: maskTopY, spacing }).balls.map((b) => ({
      ...b,
      x: b.x + canvas.contentOffsetX
    }));
    for (const ball of balls) {
      assert.ok(ball.x - radius >= canvas.wallMargin, `${label} clears the left wall`);
      assert.ok(ball.x + radius <= canvas.logicalWidth - canvas.wallMargin, `${label} clears the right wall`);
      assert.ok(ball.y + radius <= lowestAllowedY, `${label} stays above the warning line`);
    }
    // Every sphere reaches an anchor through spheres close enough to bond.
    const reached = new Set();
    balls.forEach((b, i) => b.isAnchor && reached.add(i));
    assert.ok(reached.size > 0, `${label} has an anchor`);
    const queue = [...reached];
    for (let head = 0; head < queue.length; head++) {
      const a = balls[queue[head]];
      balls.forEach((b, i) => {
        if (!reached.has(i) && Math.hypot(a.x - b.x, a.y - b.y) <= bondReach) {
          reached.add(i);
          queue.push(i);
        }
      });
    }
    assert.equal(reached.size, balls.length, `${label} hangs together`);
  }
});

test('A generated shape id rebuilds the same shape, neutral anchors included', () => {
  for (const params of valid.slice(0, ROUND_TRIP_SAMPLE)) {
    const withNeutral = { ...params, neutralAnchors: true };
    const decoded = decodeGeneratedShapeId(encodeGeneratedShapeId(withNeutral));
    assert.deepEqual(buildRows({ ...decoded, rotation: params.rotation }), buildRows(withNeutral));
  }
  const rows = buildRows({ ...valid[0], neutralAnchors: true }).join('');
  const anchorCount = [...rows].filter((c) => c === MASK_CELLS.ANCHOR || c === MASK_CELLS.NEUTRAL_ANCHOR).length;
  if (anchorCount > 1) {
    assert.ok(!rows.includes(MASK_CELLS.ANCHOR), 'with several anchors, all of them turn neutral');
  }
});

test('Generated shapes take about their configured share of the Flux draw', () => {
  let generatedCount = 0;
  let total = 0;
  for (let seed = 0; seed < SAMPLE_SEEDS; seed++) {
    let previousFamily = null;
    for (let stage = 1; stage <= SAMPLE_STAGES; stage++) {
      const stageDef = generateFluxStage({
        seed: `share-${seed}`,
        stage,
        previousFamily,
        fluxConfig,
        obstaclesConfig,
        ballRadius: physicsConfig.ball.radius
      });
      previousFamily = stageDef.family;
      generatedCount += stageDef.family === FLUX_FAMILIES.GENERATED ? 1 : 0;
      total++;
    }
  }
  const weights = fluxConfig.familyWeights;
  const expected = weights.generated / Object.values(weights).reduce((sum, w) => sum + w, 0);
  const share = generatedCount / total;
  assert.ok(Math.abs(share - expected) <= SHARE_TOLERANCE, `generated share ${share.toFixed(2)}, about ${expected} expected`);
});

test('Every generated shape type and fill has a name in both languages', () => {
  for (const [lang, dict] of Object.entries(locales)) {
    for (const type of Object.values(GENERATED_SHAPE_TYPES)) {
      for (const fill of Object.values(GENERATED_FILLS)) {
        const text = dict.gameplay.flux.generated?.[type]?.[fill];
        assert.equal(typeof text, 'string', `${lang}: gameplay.flux.generated.${type}.${fill}`);
      }
    }
  }
});

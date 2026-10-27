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

import { LAYOUT_TYPES, MATH_CONSTANTS } from '../../core/Constants.js';

/**
 * Pure geometry for every cluster layout. A generator turns a layout definition into a
 * layout spec and never touches the engine, colors or randomness, so the same definition
 * always yields the same board shape:
 *
 *   { balls: [BallSpec], bonds: [[indexA, indexB]] }
 *
 * BallSpec: { x, y, isAnchor, isNeutral, railHalfWidth, allowModifier, pivotSlot, pivotRadius, pivotAngle }
 * - isNeutral: a colorless anchor that matches cannot break (see the neutralAnchor modifier).
 * - railHalfWidth: an anchor that slides that far left and right of its x on a rail; 0 is fixed.
 * - pivotSlot: index into the board's pivot obstacles (in obstacle order), or NO_PIVOT_SLOT.
 * - allowModifier: whether the engine may roll a cluster modifier (armored, coin core...).
 * - bonds: explicit structural bonds created on top of the distance-based initial bonds.
 *
 * Balls are listed in creation order: the engine picks colors ball by ball, so the order
 * is part of the contract.
 */

/** pivotSlot value of a ball that is not bound to a pivot obstacle. */
export const NO_PIVOT_SLOT = -1;

/** Mask characters understood by the mask generator. */
export const MASK_CELLS = Object.freeze({
  BALL: 'o',
  ANCHOR: 'A',
  NEUTRAL_ANCHOR: 'N'
});

/** Hexagonal packing: vertical distance between rows for a given horizontal spacing. */
const HEX_ROW_HEIGHT_FACTOR = Math.sqrt(3) * MATH_CONSTANTS.HALF;

const freeBall = (x, y) => ({
  x,
  y,
  isAnchor: false,
  isNeutral: false,
  railHalfWidth: 0,
  allowModifier: true,
  pivotSlot: NO_PIVOT_SLOT,
  pivotRadius: 0,
  pivotAngle: 0
});

const fixedAnchor = (x, y, isNeutral = false) => ({ ...freeBall(x, y), isAnchor: true, isNeutral, allowModifier: false });

/**
 * Anchor bound to a pivot: it orbits the pivot at its current distance and angle.
 * Without a pivot obstacle on the board the engine keeps it as a fixed anchor.
 */
const pivotAnchor = (x, y, centerX, centerY, pivotSlot) => ({
  ...fixedAnchor(x, y),
  pivotSlot,
  pivotRadius: Math.hypot(x - centerX, y - centerY),
  pivotAngle: Math.atan2(y - centerY, x - centerX)
});

/** Variant of pivotAnchor for rings, whose radius and angle are known exactly. */
const ringAnchor = (x, y, radius, angle, pivotSlot) => ({
  ...fixedAnchor(x, y),
  pivotSlot,
  pivotRadius: radius,
  pivotAngle: angle
});

/** Free ball that remembers its polar angle, like the inner balls of pivot layouts do. */
const orbitingFreeBall = (x, y, angle) => ({ ...freeBall(x, y), pivotAngle: angle });

function generatePendulum(layout) {
  const balls = layout.anchors.map((a) => ({ ...fixedAnchor(a.x, a.y, Boolean(a.neutral)), railHalfWidth: a.rail || 0 }));
  for (let row = 0; row < layout.rows; row++) {
    const offset = (row % 2) * (layout.spacingX * MATH_CONSTANTS.HALF);
    for (let col = 0; col < layout.cols; col++) {
      balls.push(freeBall(layout.startX + col * layout.spacingX + offset, layout.startY + row * layout.spacingY));
    }
  }
  return { balls, bonds: [] };
}

function appendConcentricRings(balls, centerX, centerY, rings, pivotSlot) {
  rings.forEach((ringDef, ringIndex) => {
    for (let i = 0; i < ringDef.count; i++) {
      const angle = (MATH_CONSTANTS.TWO_PI * i) / ringDef.count;
      const x = centerX + Math.cos(angle) * ringDef.radius;
      const y = centerY + Math.sin(angle) * ringDef.radius;
      balls.push(ringIndex === 0 ? ringAnchor(x, y, ringDef.radius, angle, pivotSlot) : orbitingFreeBall(x, y, angle));
    }
  });
}

function generateRing(layout) {
  const balls = [];
  appendConcentricRings(balls, layout.centerX, layout.centerY, layout.rings, 0);
  return { balls, bonds: [] };
}

function generateDualRing(layout) {
  const balls = [];
  layout.clusters.forEach((cluster, index) => {
    appendConcentricRings(balls, cluster.centerX, cluster.centerY, cluster.rings, index);
  });
  return { balls, bonds: [] };
}

function generateHexagon(layout) {
  const { layers, spacing, centerX, centerY } = layout;
  const balls = [];
  for (let q = -layers; q <= layers; q++) {
    const r1 = Math.max(-layers, -q - layers);
    const r2 = Math.min(layers, -q + layers);
    for (let s = r1; s <= r2; s++) {
      if (q === 0 && s === 0) {
        continue;
      }
      const x = centerX + spacing * (q + s * MATH_CONSTANTS.HALF);
      const y = centerY + spacing * (HEX_ROW_HEIGHT_FACTOR * s);
      const isInner = Math.abs(q) <= 1 && Math.abs(s) <= 1 && Math.abs(q + s) <= 1;
      const angle = Math.atan2(y - centerY, x - centerX);
      balls.push(isInner ? pivotAnchor(x, y, centerX, centerY, 0) : orbitingFreeBall(x, y, angle));
    }
  }
  return { balls, bonds: [] };
}

function generateSpiral(layout) {
  const balls = [];
  const bonds = [];
  for (let arm = 0; arm < layout.arms; arm++) {
    const baseAngle = (MATH_CONSTANTS.TWO_PI * arm) / layout.arms;
    for (let step = 0; step < layout.ballsPerArm; step++) {
      const dist = layout.startRadius + step * layout.radiusStep;
      const angle = baseAngle + step * layout.angleStep;
      const x = layout.centerX + Math.cos(angle) * dist;
      const y = layout.centerY + Math.sin(angle) * dist;
      const isInner = step % layout.anchorStepInterval === 0;
      balls.push(isInner ? ringAnchor(x, y, dist, angle, 0) : orbitingFreeBall(x, y, angle));
      if (step > 0) {
        bonds.push([balls.length - 2, balls.length - 1]);
      }
    }
  }
  return { balls, bonds };
}

function generateCross(layout) {
  const { armLength, spacing, centerX, centerY } = layout;
  const perpFactor = layout.perpSpacingFactor;
  const directions = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 }
  ];
  const balls = [];
  const bonds = [];
  for (const dir of directions) {
    const armGrid = new Map();
    for (let step = 1; step <= armLength; step++) {
      for (let perp = -1; perp <= 1; perp++) {
        if (step === 1 && perp !== 0) {
          continue;
        }
        const x = centerX + (dir.dx * step - dir.dy * perp * perpFactor) * spacing;
        const y = centerY + (dir.dy * step + dir.dx * perp * perpFactor) * spacing;
        const isInner = perp === 0;
        const angle = Math.atan2(y - centerY, x - centerX);
        balls.push(isInner ? pivotAnchor(x, y, centerX, centerY, 0) : orbitingFreeBall(x, y, angle));
        armGrid.set(`${step}:${perp}`, balls.length - 1);
      }
    }
    for (let step = 1; step <= armLength; step++) {
      const center = armGrid.get(`${step}:0`);
      const prevCenter = armGrid.get(`${step - 1}:0`);
      if (center !== undefined && prevCenter !== undefined) {
        bonds.push([prevCenter, center]);
      }
      for (const perp of [-1, 1]) {
        const flank = armGrid.get(`${step}:${perp}`);
        if (flank === undefined) {
          continue;
        }
        if (center !== undefined) {
          bonds.push([center, flank]);
        }
        const prevFlank = armGrid.get(`${step - 1}:${perp}`);
        if (prevFlank !== undefined) {
          bonds.push([prevFlank, flank]);
        }
        if (prevCenter !== undefined) {
          bonds.push([prevCenter, flank]);
        }
      }
    }
  }
  return { balls, bonds };
}

/**
 * Fills a character mask with hexagonally packed balls, centered horizontally on centerX.
 * The first row sits at topY. Odd rows are shifted by half a cell. 'A' cells are fixed
 * anchors the silhouette hangs from, 'N' cells are neutral anchors; any other character is
 * an empty cell.
 * @param {{rows: string[], centerX: number, topY: number, spacing: number}} layout
 */
function generateMask(layout) {
  const { rows, centerX, topY, spacing } = layout;
  const rowHeight = spacing * HEX_ROW_HEIGHT_FACTOR;
  const widestRow = Math.max(...rows.map((row) => row.length));
  const hasOddRows = rows.length > 1;
  const gridWidth = (widestRow - 1) * spacing + (hasOddRows ? spacing * MATH_CONSTANTS.HALF : 0);
  const originX = centerX - gridWidth * MATH_CONSTANTS.HALF;
  const balls = [];
  rows.forEach((row, rowIndex) => {
    const offset = (rowIndex % 2) * spacing * MATH_CONSTANTS.HALF;
    for (let col = 0; col < row.length; col++) {
      const cell = row[col];
      if (cell !== MASK_CELLS.BALL && cell !== MASK_CELLS.ANCHOR && cell !== MASK_CELLS.NEUTRAL_ANCHOR) {
        continue;
      }
      const x = originX + col * spacing + offset;
      const y = topY + rowIndex * rowHeight;
      if (cell === MASK_CELLS.BALL) {
        balls.push(freeBall(x, y));
      } else {
        balls.push(fixedAnchor(x, y, cell === MASK_CELLS.NEUTRAL_ANCHOR));
      }
    }
  });
  return { balls, bonds: [] };
}

const GENERATORS = Object.freeze({
  [LAYOUT_TYPES.PENDULUM]: generatePendulum,
  [LAYOUT_TYPES.RING]: generateRing,
  [LAYOUT_TYPES.DUAL_RING]: generateDualRing,
  [LAYOUT_TYPES.HEXAGON]: generateHexagon,
  [LAYOUT_TYPES.SPIRAL]: generateSpiral,
  [LAYOUT_TYPES.CROSS]: generateCross,
  [LAYOUT_TYPES.MASK]: generateMask
});

/**
 * Builds the layout spec of a layout definition.
 * @param {{type: string}} layout - Layout definition, from a level or from the Flux generator.
 * @returns {{balls: object[], bonds: number[][]}}
 */
export function generateLayout(layout) {
  const generator = GENERATORS[layout.type];
  if (!generator) {
    throw new Error(`Unknown layout type: ${layout.type}`);
  }
  return generator(layout);
}

/**
 * Concatenates several layout specs into one, shifting bond indices and pivot slots so
 * that each part keeps its own pivots.
 * @param {Array<{spec: object, pivotSlotOffset: number}>} parts
 */
export function mergeLayoutSpecs(parts) {
  const balls = [];
  const bonds = [];
  for (const { spec, pivotSlotOffset } of parts) {
    const indexOffset = balls.length;
    for (const ball of spec.balls) {
      const pivotSlot = ball.pivotSlot === NO_PIVOT_SLOT ? NO_PIVOT_SLOT : ball.pivotSlot + pivotSlotOffset;
      balls.push({ ...ball, pivotSlot });
    }
    for (const [a, b] of spec.bonds) {
      bonds.push([a + indexOffset, b + indexOffset]);
    }
  }
  return { balls, bonds };
}

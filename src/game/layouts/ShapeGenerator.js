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

import { MATH_CONSTANTS } from '../../core/Constants.js';
import { MASK_CELLS } from './LayoutGenerators.js';

/**
 * Generated Flux silhouettes: a polar curve filled on the hexagonal sphere grid, given
 * anchors on top, then kept only if it passes a quality filter. The output is the same
 * mask rows as a hand-drawn silhouette, so the mask layout builds it.
 */

export const GENERATED_SHAPE_TYPES = Object.freeze({
  POLYGON: 'polygon',
  STAR: 'star',
  FLOWER: 'flower',
  GEAR: 'gear',
  CRESCENT: 'crescent',
  HEART: 'heart'
});

export const GENERATED_FILLS = Object.freeze({
  SOLID: 'solid',
  HOLLOW: 'hollow'
});

/** Prefix of a generated shape id, which encodes its parameters. */
export const GENERATED_SHAPE_PREFIX = 'generated';
const ID_SEPARATOR = ':';

/** Vertical distance between grid rows, in cells (hexagonal packing). */
const ROW_HEIGHT = Math.sqrt(3) * MATH_CONSTANTS.HALF;
/** Grid margin around the shape, in cells, so no filled cell touches the grid edge. */
const GRID_MARGIN = 2;
const EMPTY_CELL = '.';
/** Odd rows sit half a cell to the right of even ones. */
const ODD_ROW_SHIFT = MATH_CONSTANTS.HALF;
/** Heart curve (x^2 + y^2 - 1)^3 = x^2 y^3: scale that fills a unit radius, and the lift that centers it. */
const HEART_SCALE = 1.15;
const HEART_LIFT = 0.2;
const HEART_EXPONENT = 3;

/** True inside the heart curve, tip down, for coordinates already scaled and lifted. */
const insideHeartCurve = (hx, hy) => (hx * hx + hy * hy - 1) ** HEART_EXPONENT - hx * hx * hy ** HEART_EXPONENT <= 0;

/**
 * Radius of the shape's outline at an angle, as a share of its full radius.
 * @param {string} type - One of GENERATED_SHAPE_TYPES (not crescent or heart).
 * @param {number} angle - Angle in radians, rotation already removed.
 * @param {{points: number, depth: number}} params - Shape parameters.
 * @returns {number} Radius ratio in [0, 1].
 */
function outlineRatio(type, angle, { points, depth }) {
  const sector = MATH_CONSTANTS.TWO_PI / points;
  const phase = ((angle % sector) + sector) % sector;
  // 0 at a point, 1 halfway between two points.
  const between = Math.abs(phase / sector - MATH_CONSTANTS.HALF) * 2;
  if (type === GENERATED_SHAPE_TYPES.POLYGON) {
    return Math.cos(Math.PI / points) / Math.cos(phase - sector * MATH_CONSTANTS.HALF);
  }
  if (type === GENERATED_SHAPE_TYPES.STAR) {
    return 1 - depth * between;
  }
  if (type === GENERATED_SHAPE_TYPES.FLOWER) {
    return 1 - depth * (1 - Math.abs(Math.cos((points * angle) * MATH_CONSTANTS.HALF)));
  }
  // Gear: flat teeth, half the sector each.
  return between < MATH_CONSTANTS.HALF ? 1 : 1 - depth;
}

/**
 * Whether a point, in shape units (full radius = 1, y pointing down), is inside the shape.
 * @param {{type: string, points: number, depth: number, rotation: number}} params
 * @param {number} x - Horizontal offset from the center, in radii.
 * @param {number} y - Vertical offset from the center, in radii (down is positive).
 * @param {number} rim - Thickness kept inside the outline for a hollow fill, in radii;
 *   zero for a solid fill.
 */
function isInside(params, x, y, rim) {
  const { type, depth } = params;
  if (type === GENERATED_SHAPE_TYPES.HEART) {
    const hx = x * HEART_SCALE;
    const hy = -y * HEART_SCALE + HEART_LIFT;
    const outer = insideHeartCurve(hx, hy);
    if (!outer || rim === 0) {
      return outer;
    }
    // Hollow: outside the same curve shrunk by the rim.
    const shrink = 1 / (1 - rim);
    return !insideHeartCurve(hx * shrink, (hy - HEART_LIFT) * shrink + HEART_LIFT);
  }
  const distance = Math.hypot(x, y);
  if (type === GENERATED_SHAPE_TYPES.CRESCENT) {
    // A disc with an offset disc cut out, the bite turned by the rotation.
    const biteX = Math.cos(params.rotation) * depth;
    const biteY = Math.sin(params.rotation) * depth;
    const inDisc = distance <= 1;
    const inBite = Math.hypot(x - biteX, y - biteY) < 1 - depth * MATH_CONSTANTS.HALF;
    if (!inDisc || inBite) {
      return false;
    }
    return rim === 0 || distance >= 1 - rim || Math.hypot(x - biteX, y - biteY) < 1 - depth * MATH_CONSTANTS.HALF + rim;
  }
  const angle = Math.atan2(y, x) - params.rotation;
  const outline = outlineRatio(type, angle, params);
  return distance <= outline && (rim === 0 || distance >= outline - rim);
}

/** Hex grid neighbors of a cell in the mask's offset layout (odd rows shifted right). */
function neighborsOf(row, col) {
  const shift = row % 2 === 0 ? -1 : 0;
  return [
    [row, col - 1],
    [row, col + 1],
    [row - 1, col + shift],
    [row - 1, col + shift + 1],
    [row + 1, col + shift],
    [row + 1, col + shift + 1]
  ];
}

const cellKey = (row, col) => `${row},${col}`;

/**
 * Builds the mask rows of a generated shape, or null when it fails the quality filter.
 * @param {object} params - From decodeGeneratedShapeId or pickGeneratedShape.
 * @param {object} limits - fluxConfig.generated.limits.
 * @returns {?string[]} Mask rows.
 */
export function buildGeneratedRows(params, limits) {
  const { radiusCells, fill, neutralAnchors } = params;
  if (!isReadable(params, limits)) {
    return null;
  }
  const rim = fill === GENERATED_FILLS.HOLLOW ? limits.hollowRimCells / radiusCells : 0;
  const rowCount = Math.ceil((radiusCells * params.stretch * 2) / ROW_HEIGHT) + GRID_MARGIN * 2;
  const colCount = Math.ceil(radiusCells * 2) + GRID_MARGIN * 2;
  const centerRow = Math.floor(rowCount * MATH_CONSTANTS.HALF);
  const centerX = colCount * MATH_CONSTANTS.HALF;
  const centerY = centerRow * ROW_HEIGHT;

  const filled = new Set();
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < colCount; col++) {
      const x = (col + (row % 2) * ODD_ROW_SHIFT - centerX) / radiusCells;
      // A stretch above 1 makes the shape taller than wide.
      const y = (row * ROW_HEIGHT - centerY) / (radiusCells * params.stretch);
      if (isInside(params, x, y, rim)) {
        filled.add(cellKey(row, col));
      }
    }
  }
  if (filled.size === 0) {
    return null;
  }

  const anchors = pickAnchors(filled);
  const connected = keepConnected(filled, anchors);
  if (connected.size < filled.size * limits.minConnectedShare) {
    return null;
  }

  const cells = [...connected].map((key) => key.split(',').map(Number));
  const rows = cells.map(([row]) => row);
  const cols = cells.map(([row, col]) => col + (row % 2) * ODD_ROW_SHIFT);
  // Keep row parity: the mask layout shifts odd rows, so the first kept row must be even.
  const firstRow = Math.min(...rows) - (Math.min(...rows) % 2);
  const lastRow = Math.max(...rows);
  const firstCol = Math.floor(Math.min(...cols));
  const lastCol = Math.ceil(Math.max(...cols));
  // The mask layout centers the whole grid, odd-row shift included, not just its spheres.
  const widthCells = lastCol - firstCol + ODD_ROW_SHIFT;
  const heightRows = lastRow - Math.min(...rows);
  const freeBalls = connected.size - anchors.length;

  if (
    freeBalls < limits.minSpheres ||
    freeBalls > limits.maxSpheres ||
    widthCells > limits.maxWidthCells ||
    heightRows > limits.maxHeightRows
  ) {
    return null;
  }
  const boundingCells = (widthCells + 1) * (heightRows + 1);
  if (connected.size / boundingCells < limits.minFullness) {
    return null;
  }

  const anchorKeys = new Set(anchors.map(([row, col]) => cellKey(row, col)));
  const anchorCell = neutralAnchors && anchors.length > 1 ? MASK_CELLS.NEUTRAL_ANCHOR : MASK_CELLS.ANCHOR;
  const out = [];
  for (let row = firstRow; row <= lastRow; row++) {
    let line = '';
    for (let col = firstCol; col <= lastCol; col++) {
      const key = cellKey(row, col);
      if (anchorKeys.has(key)) {
        line += anchorCell;
      } else {
        line += connected.has(key) ? MASK_CELLS.BALL : EMPTY_CELL;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Whether the grid can draw the shape's points and notches: a sphere grid cannot show 12
 * star points on a radius of 4 spheres, and the shape would then not match its name.
 * Each point needs limits.cellsPerPoint cells of outline, and each notch at least
 * limits.minNotchCells of depth.
 */
function isReadable({ type, points, depth, radiusCells }, limits) {
  const hasPoints =
    type === GENERATED_SHAPE_TYPES.STAR ||
    type === GENERATED_SHAPE_TYPES.FLOWER ||
    type === GENERATED_SHAPE_TYPES.GEAR ||
    type === GENERATED_SHAPE_TYPES.POLYGON;
  if (hasPoints && points > (MATH_CONSTANTS.TWO_PI * radiusCells) / limits.cellsPerPoint) {
    return false;
  }
  const hasNotches = hasPoints && type !== GENERATED_SHAPE_TYPES.POLYGON;
  return !hasNotches || depth * radiusCells >= limits.minNotchCells;
}

/**
 * Anchors on top of the shape: both ends of its top row, plus the middle when that row is
 * wide; a pointed top also anchors both ends of the next row so the shape does not swing
 * from a single sphere.
 * @param {Set<string>} filled - Filled cells.
 * @returns {Array<number[]>} [row, col] of each anchor.
 */
function pickAnchors(filled) {
  const byRow = new Map();
  for (const key of filled) {
    const [row, col] = key.split(',').map(Number);
    if (!byRow.has(row)) {
      byRow.set(row, []);
    }
    byRow.get(row).push(col);
  }
  const sortedRows = [...byRow.keys()].sort((a, b) => a - b);
  const anchors = [];
  const addEnds = (row) => {
    const cols = byRow.get(row).sort((a, b) => a - b);
    anchors.push([row, cols[0]]);
    if (cols.length > 1) {
      anchors.push([row, cols[cols.length - 1]]);
    }
    return cols;
  };
  const topCols = addEnds(sortedRows[0]);
  if (topCols.length === 1 && sortedRows.length > 1) {
    addEnds(sortedRows[1]);
  }
  return anchors;
}

/** Cells reachable from the anchors through grid neighbors. */
function keepConnected(filled, anchors) {
  const seen = new Set(anchors.map(([row, col]) => cellKey(row, col)));
  const queue = [...anchors];
  for (let head = 0; head < queue.length; head++) {
    const [row, col] = queue[head];
    for (const [nRow, nCol] of neighborsOf(row, col)) {
      const key = cellKey(nRow, nCol);
      if (filled.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push([nRow, nCol]);
      }
    }
  }
  return seen;
}

/**
 * Every parameter set the generator can draw, in a fixed order.
 * @param {object} generatedConfig - fluxConfig.generated.
 * @returns {object[]} Parameter sets.
 */
export function listGeneratedShapeParams(generatedConfig) {
  const out = [];
  for (const [type, spec] of Object.entries(generatedConfig.types)) {
    for (const points of spec.points) {
      for (const depth of spec.depths) {
        for (const rotationStep of spec.rotationSteps) {
          for (const radiusCells of generatedConfig.radiusCells) {
            for (const stretch of generatedConfig.stretches) {
              for (const fill of spec.fills) {
                out.push({ type, points, depth, rotationStep, radiusCells, stretch, fill, neutralAnchors: false });
              }
            }
          }
        }
      }
    }
  }
  return out;
}

/** Rotation in radians of a parameter set: steps of a half sector, or of 45 degrees for curves without points. */
function rotationOf({ points, rotationStep }) {
  const sector = MATH_CONSTANTS.TWO_PI / Math.max(points, 1);
  return (rotationStep * sector) / generatedRotationDivisions(points);
}

/** Rotation steps per sector: shapes with points turn by fractions of a sector. */
function generatedRotationDivisions(points) {
  return points > 1 ? 2 : 8;
}

/**
 * Parameter set with its rotation in radians, ready for buildGeneratedRows.
 * @param {object} params - From listGeneratedShapeParams.
 */
export function resolveGeneratedParams(params) {
  return { ...params, rotation: rotationOf(params) };
}

/** Id of a generated shape: it carries every parameter, so the name and the rows follow from it. */
export function encodeGeneratedShapeId(params) {
  return [
    GENERATED_SHAPE_PREFIX,
    params.type,
    params.points,
    params.depth,
    params.rotationStep,
    params.radiusCells,
    params.stretch,
    params.fill,
    params.neutralAnchors ? 1 : 0
  ].join(ID_SEPARATOR);
}

export function isGeneratedShapeId(id) {
  return typeof id === 'string' && id.startsWith(GENERATED_SHAPE_PREFIX + ID_SEPARATOR);
}

export function decodeGeneratedShapeId(id) {
  const [, type, points, depth, rotationStep, radiusCells, stretch, fill, neutral] = id.split(ID_SEPARATOR);
  return {
    type,
    points: Number(points),
    depth: Number(depth),
    rotationStep: Number(rotationStep),
    radiusCells: Number(radiusCells),
    stretch: Number(stretch),
    fill,
    neutralAnchors: neutral === '1'
  };
}

/**
 * Footprint of a mask: its sphere positions relative to their centroid, so two shapes that
 * only differ by position compare equal; a left-right mirror counts as the same shape.
 * @param {string[]} rows - Mask rows.
 * @returns {string} Comparable key.
 */
export function maskFingerprint(rows) {
  const points = [];
  rows.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      if (line[col] !== EMPTY_CELL) {
        points.push([col + (row % 2) * ODD_ROW_SHIFT, row]);
      }
    }
  });
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const encode = (mirror) =>
    points
      .map(([x, y]) => `${(mirror ? meanX - x : x - meanX).toFixed(1)}:${y}`)
      .sort()
      .join('|');
  const direct = encode(false);
  const mirrored = encode(true);
  return direct < mirrored ? direct : mirrored;
}

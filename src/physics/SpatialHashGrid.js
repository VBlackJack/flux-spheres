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

const COORD_OFFSET = 32768;
const COORD_STRIDE = 65536;

/**
 * Uniform 2D spatial hash grid for broad-phase neighbor queries on circular bodies.
 * Uses an injective integer pairing function over shifted grid coordinates so that
 * negative and positive cell indices never collide.
 */
export class SpatialHashGrid {
  /**
   * @param {number} cellSize - Width and height of each square grid cell in logical pixels.
   */
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.cells = new Map();
    this.bucketPool = [];
  }

  /**
   * Updates the grid cell size if changed.
   * @param {number} cellSize - New cell size in logical pixels.
   */
  setCellSize(cellSize) {
    if (cellSize > 0 && cellSize !== this.cellSize) {
      this.cellSize = cellSize;
      this.invCellSize = 1 / cellSize;
    }
  }

  /**
   * Clears all active cell buckets and recycles arrays into the internal pool.
   */
  clear() {
    for (const bucket of this.cells.values()) {
      bucket.length = 0;
      this.bucketPool.push(bucket);
    }
    this.cells.clear();
  }

  /**
   * Computes a collision-free integer key for 2D cell coordinates.
   * @param {number} cx - Cell X coordinate.
   * @param {number} cy - Cell Y coordinate.
   * @returns {number} Unique integer key for (cx, cy).
   */
  hashCoords(cx, cy) {
    return (cx + COORD_OFFSET) * COORD_STRIDE + (cy + COORD_OFFSET);
  }

  /**
   * Inserts a ball into its corresponding spatial cell bucket.
   * @param {import('../entities/Ball.js').Ball} ball - Ball entity to insert.
   */
  insert(ball) {
    const cx = Math.floor(ball.x * this.invCellSize);
    const cy = Math.floor(ball.y * this.invCellSize);
    const key = this.hashCoords(cx, cy);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = this.bucketPool.pop() || [];
      this.cells.set(key, bucket);
    }
    bucket.push(ball);
  }

  /**
   * Rebuilds the spatial hash grid from the given list of balls.
   * @param {Array<import('../entities/Ball.js').Ball>} balls - Active balls in the world.
   */
  rebuild(balls) {
    this.clear();
    for (let i = 0; i < balls.length; i++) {
      this.insert(balls[i]);
    }
  }

  /**
   * Iterates over all unique candidate neighbor pairs in adjacent 3x3 cells.
   * Each unordered pair (a, b) with b.id > a.id is visited at most once.
   * @param {Array<import('../entities/Ball.js').Ball>} balls - Active balls in the world.
   * @param {(a: import('../entities/Ball.js').Ball, b: import('../entities/Ball.js').Ball) => void} callback - Pair handler.
   */
  forEachNeighborPair(balls, callback) {
    this.rebuild(balls);
    this.forEachCandidatePair(balls, callback);
  }

  /**
   * Rebuilds the grid once and collects every unique neighbor pair closer than the given
   * distance into two parallel output arrays, so hot loops can iterate the pairs several
   * times without rebuilding the grid or allocating closures.
   * @param {Array<import('../entities/Ball.js').Ball>} balls - Active balls in the world.
   * @param {number} maxDistSq - Squared distance below which a pair is kept.
   * @param {Array<import('../entities/Ball.js').Ball>} outA - Receives the first ball of each pair.
   * @param {Array<import('../entities/Ball.js').Ball>} outB - Receives the second ball of each pair.
   * @returns {number} Number of collected pairs.
   */
  collectPairs(balls, maxDistSq, outA, outB) {
    this.rebuild(balls);
    let count = 0;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      const cx = Math.floor(a.x * this.invCellSize);
      const cy = Math.floor(a.y * this.invCellSize);

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bucket = this.cells.get(this.hashCoords(cx + dx, cy + dy));
          if (!bucket) {
            continue;
          }
          for (let k = 0; k < bucket.length; k++) {
            const b = bucket[k];
            if (b.id <= a.id) {
              continue;
            }
            const ox = b.x - a.x;
            const oy = b.y - a.y;
            if (ox * ox + oy * oy < maxDistSq) {
              outA[count] = a;
              outB[count] = b;
              count++;
            }
          }
        }
      }
    }
    outA.length = count;
    outB.length = count;
    return count;
  }

  /**
   * Iterates candidate neighbor pairs against the current grid contents without rebuilding.
   * @param {Array<import('../entities/Ball.js').Ball>} balls - Balls to query from.
   * @param {(a: import('../entities/Ball.js').Ball, b: import('../entities/Ball.js').Ball) => void} callback - Pair handler.
   */
  forEachCandidatePair(balls, callback) {
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      const cx = Math.floor(a.x * this.invCellSize);
      const cy = Math.floor(a.y * this.invCellSize);

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bucket = this.cells.get(this.hashCoords(cx + dx, cy + dy));
          if (!bucket) {
            continue;
          }
          for (let k = 0; k < bucket.length; k++) {
            const b = bucket[k];
            if (b.id > a.id) {
              callback(a, b);
            }
          }
        }
      }
    }
  }
}

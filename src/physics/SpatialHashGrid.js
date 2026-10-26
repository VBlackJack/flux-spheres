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

const COORD_PRIME_X = 73856093;
const COORD_PRIME_Y = 19349663;

export class SpatialHashGrid {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.cells = new Map();
    this.bucketPool = [];
  }

  setCellSize(cellSize) {
    if (cellSize > 0 && cellSize !== this.cellSize) {
      this.cellSize = cellSize;
      this.invCellSize = 1 / cellSize;
    }
  }

  clear() {
    for (const bucket of this.cells.values()) {
      bucket.length = 0;
      this.bucketPool.push(bucket);
    }
    this.cells.clear();
  }

  hashCoords(cx, cy) {
    return (cx * COORD_PRIME_X) ^ (cy * COORD_PRIME_Y);
  }

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

  rebuild(balls) {
    this.clear();
    for (let i = 0; i < balls.length; i++) {
      this.insert(balls[i]);
    }
  }

  forEachNeighborPair(balls, callback) {
    this.rebuild(balls);
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

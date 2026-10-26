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

import { MATH_CONSTANTS } from '../core/Constants.js';

let nextBallId = 1;

export class Ball {
  constructor({
    x,
    y,
    radius,
    colorId,
    specialType = null,
    clusterModifier = null,
    armorHits = 0,
    isAnchor = false,
    isProjectile = false,
    pivotRef = null,
    pivotRadius = 0,
    pivotAngle = 0
  }) {
    this.id = nextBallId++;
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = radius;
    this.colorId = colorId;
    this.specialType = specialType;
    this.clusterModifier = clusterModifier;
    this.armorHits = armorHits;
    this.isAnchor = isAnchor;
    this.anchorX = x;
    this.anchorY = y;
    this.isProjectile = isProjectile;
    this.isDropping = false;
    this.isFrozen = false;
    this.bonds = new Set();
    this.pivotRef = pivotRef;
    this.pivotRadius = pivotRadius;
    this.pivotAngle = pivotAngle;
    this.pulsePhase = Math.random() * MATH_CONSTANTS.TWO_PI;
  }

  savePreviousPosition() {
    this.prevX = this.x;
    this.prevY = this.y;
  }
}

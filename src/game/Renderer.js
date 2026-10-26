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

import { OBSTACLE_TYPES, SPECIAL_TYPES, CLUSTER_MODIFIERS, MATH_CONSTANTS } from '../core/Constants.js';

/**
 * Canvas 2D renderer supporting high-DPI scaling, state interpolation,
 * high-contrast mode, and predictive trajectory/AOE/avalanche overlays.
 */
export class Renderer {
  constructor(canvas, gameConfig, ballsConfig, obstaclesConfig) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.gameConfig = gameConfig;
    this.ballsConfig = ballsConfig;
    this.obstaclesConfig = obstaclesConfig;

    this.colorMap = new Map();
    for (const c of ballsConfig.standardColors) {
      this.colorMap.set(c.id, c);
    }

    this.logicalWidth = gameConfig.canvas.logicalWidth;
    this.logicalHeight = gameConfig.canvas.logicalHeight;
    this.dpr = 1;
    this.updateCanvasResolution();

    const theme = this.gameConfig.theme;
    this.bgGradient = this.ctx.createLinearGradient(0, 0, 0, this.logicalHeight);
    this.bgGradient.addColorStop(0, theme.backgroundTop);
    this.bgGradient.addColorStop(1, theme.backgroundBottom);

    this.ballGradientCache = new Map();
    this.highContrast = false;
  }

  updateCanvasResolution() {
    const rawDpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const nextDpr = Math.max(1, Math.min(3, rawDpr));
    const targetW = Math.round(this.logicalWidth * nextDpr);
    const targetH = Math.round(this.logicalHeight * nextDpr);
    if (this.canvas.width !== targetW || this.canvas.height !== targetH || this.dpr !== nextDpr) {
      this.dpr = nextDpr;
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }
  }

  setHighContrast(enabled) {
    this.highContrast = Boolean(enabled);
  }

  getCachedBallGradient(palette, radius) {
    const key = `${palette.id}_${radius}`;
    let grad = this.ballGradientCache.get(key);
    if (!grad) {
      const renderCfg = this.ballsConfig.render;
      const offset = radius * renderCfg.gradientOffsetFactor;
      grad = this.ctx.createRadialGradient(
        offset,
        offset,
        radius * renderCfg.gradientInnerRadiusFactor,
        0,
        0,
        radius
      );
      grad.addColorStop(0, palette.highlight);
      grad.addColorStop(renderCfg.gradientMidStop, palette.fill);
      grad.addColorStop(1, palette.shadow);
      this.ballGradientCache.set(key, grad);
    }
    return grad;
  }

  interpolate(prev, curr, alpha) {
    return prev !== undefined ? prev + (curr - prev) * alpha : curr;
  }

  render(engineState, alpha = 1.0) {
    this.updateCanvasResolution();
    const ctx = this.ctx;
    const width = this.logicalWidth;
    const height = this.logicalHeight;
    const theme = this.gameConfig.theme;
    const now = performance.now();

    ctx.save();
    if (this.dpr !== 1) {
      ctx.scale(this.dpr, this.dpr);
    }
    const shake = engineState.particleSystem.shakeIntensity;
    if (shake > 0) {
      const dx = (Math.random() - MATH_CONSTANTS.HALF) * 2 * shake;
      const dy = (Math.random() - MATH_CONSTANTS.HALF) * 2 * shake;
      ctx.translate(dx, dy);
    }

    ctx.fillStyle = this.bgGradient;
    ctx.fillRect(0, 0, width, height);

    this.drawGrid(ctx, width, height, theme);
    this.drawWallsAndDangerZone(ctx, width, height, theme, engineState.physicsWorld.balls, now, alpha);
    this.drawObstacles(ctx, engineState.physicsWorld.obstacles, now, alpha);
    this.drawMagneticBonds(ctx, engineState.physicsWorld, theme, now, alpha);

    for (const ball of engineState.physicsWorld.balls) {
      this.drawBall(ctx, ball, now, alpha);
    }

    for (const ball of engineState.physicsWorld.droppingBalls) {
      this.drawBall(ctx, ball, now, alpha);
    }

    if (engineState.aimPoints && !engineState.physicsWorld.projectile && !engineState.isAimCancelled) {
      const blastMult = typeof engineState.getBlastRadiusMultiplier === 'function'
        ? engineState.getBlastRadiusMultiplier()
        : 1.0;
      this.drawAimTrajectory(
        ctx,
        engineState.aimPoints,
        engineState.currentBall,
        engineState.physicsWorld,
        theme,
        now,
        blastMult
      );
    }

    this.drawTrail(ctx, engineState.particleSystem);

    if (engineState.physicsWorld.projectile) {
      this.drawBall(ctx, engineState.physicsWorld.projectile, now, alpha);
    }

    this.drawLauncher(ctx, engineState, theme, now);
    this.drawParticles(ctx, engineState.particleSystem);
    ctx.restore();
  }

  drawGrid(ctx, width, height, theme) {
    ctx.strokeStyle = theme.gridLineColor;
    ctx.lineWidth = theme.gridLineWidth;
    const step = theme.gridSize;

    ctx.beginPath();
    for (let x = step; x < width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = step; y < height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }

  drawWallsAndDangerZone(ctx, width, height, theme, balls = [], now = 0, alpha = 1.0) {
    const margin = this.gameConfig.canvas.wallMargin;
    const dangerY = this.gameConfig.canvas.dangerLineY;
    const warningMargin = this.gameConfig.canvas.dangerWarningMarginY;
    const warningThresholdY = dangerY - warningMargin;

    const closeBalls = [];
    for (const b of balls) {
      if (b.isDropping) {
        continue;
      }
      const by = this.interpolate(b.prevY, b.y, alpha);
      if (by + b.radius >= warningThresholdY) {
        closeBalls.push({ x: this.interpolate(b.prevX, b.x, alpha), y: by, radius: b.radius });
      }
    }

    const isWarning = closeBalls.length > 0;
    const pulse = isWarning
      ? theme.magneticPulseBase + theme.magneticPulseAmp * Math.sin(now * theme.dangerWarningPulseSpeed)
      : 1.0;

    ctx.fillStyle = isWarning && theme.dangerZoneWarningFill ? theme.dangerZoneWarningFill : theme.dangerZoneFill;
    ctx.fillRect(margin, dangerY, width - margin * 2, height - dangerY);

    ctx.save();
    ctx.setLineDash(theme.dangerLineDash);
    ctx.strokeStyle = theme.dangerLineColor;
    ctx.lineWidth = isWarning ? theme.dangerLineWidth + theme.dangerWarningLineWidthExtra : theme.dangerLineWidth;
    ctx.globalAlpha = isWarning ? pulse : 1.0;
    ctx.beginPath();
    ctx.moveTo(margin, dangerY);
    ctx.lineTo(width - margin, dangerY);
    ctx.stroke();

    if (isWarning) {
      ctx.setLineDash([]);
      ctx.strokeStyle = theme.dangerBallRingColor || theme.dangerLineColor;
      ctx.lineWidth = theme.aimTargetMatchLineWidth;
      for (const cb of closeBalls) {
        ctx.beginPath();
        ctx.arc(cb.x, cb.y, cb.radius + theme.aimTargetRingPadding, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.strokeStyle = theme.wallGlowColor;
    ctx.lineWidth = theme.wallGlowLineWidth;
    ctx.strokeRect(margin * MATH_CONSTANTS.HALF, margin * MATH_CONSTANTS.HALF, width - margin, height - margin);

    ctx.strokeStyle = theme.wallColor;
    ctx.lineWidth = theme.wallLineWidth;
    ctx.strokeRect(margin * MATH_CONSTANTS.HALF, margin * MATH_CONSTANTS.HALF, width - margin, height - margin);
  }

  drawMagneticBonds(ctx, physicsWorld, theme, now, alpha = 1.0) {
    const pulse = theme.magneticPulseBase + theme.magneticPulseAmp * Math.sin(now * theme.magneticFieldPulseSpeed);
    const magCfg = physicsWorld.physicsConfig.magnetism;
    const simCfg = physicsWorld.physicsConfig.simulation;
    const ballRadius = physicsWorld.physicsConfig.ball.radius;
    const fieldMaxDist = ballRadius * magCfg.fieldLineMaxDistanceFactor;
    const fieldMaxDistSq = fieldMaxDist * fieldMaxDist;
    const stressDist = ballRadius * simCfg.bondRestDistanceFactor * theme.magneticStressThresholdFactor;

    ctx.save();
    ctx.lineWidth = theme.magneticFieldLineWidth;
    ctx.setLineDash(theme.magneticFieldDash);
    ctx.strokeStyle = `rgba(${theme.magneticSameColorBase}, ${theme.magneticFieldAlpha * pulse})`;
    ctx.beginPath();
    physicsWorld.spatialGrid.forEachNeighborPair(physicsWorld.balls, (a, b) => {
      if (!a.colorId || a.colorId !== b.colorId || a.bonds.has(b.id)) {
        return;
      }
      const ax = this.interpolate(a.prevX, a.x, alpha);
      const ay = this.interpolate(a.prevY, a.y, alpha);
      const bx = this.interpolate(b.prevX, b.x, alpha);
      const by = this.interpolate(b.prevY, b.y, alpha);
      const dx = bx - ax;
      const dy = by - ay;
      if (dx * dx + dy * dy <= fieldMaxDistSq) {
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.lineWidth = theme.magneticBondLineWidth;
    const sameColorStroke = `rgba(${theme.magneticSameColorBase}, ${theme.magneticBondSameColorAlpha * pulse})`;
    const repelColorStroke = `rgba(${theme.magneticRepelColorBase}, ${theme.magneticFieldAlpha * pulse})`;
    for (const a of physicsWorld.balls) {
      const polA = a.colorId ? (physicsWorld.polarityMap.get(a.colorId) || 0) : 0;
      const ax = this.interpolate(a.prevX, a.x, alpha);
      const ay = this.interpolate(a.prevY, a.y, alpha);
      for (const neighborId of a.bonds) {
        if (neighborId <= a.id) {
          continue;
        }
        const b = physicsWorld.ballMap.get(neighborId);
        if (!b) {
          continue;
        }
        const bx = this.interpolate(b.prevX, b.x, alpha);
        const by = this.interpolate(b.prevY, b.y, alpha);
        const dist = Math.hypot(bx - ax, by - ay);
        const isStressed = !a.isAnchor && !b.isAnchor && dist > stressDist;
        const sameColor = a.colorId && a.colorId === b.colorId;
        const polB = b.colorId ? (physicsWorld.polarityMap.get(b.colorId) || 0) : 0;
        const samePolarityRepel = !sameColor && polA * polB > 0;
        if (isStressed) {
          ctx.strokeStyle = theme.magneticStressColor;
        } else if (sameColor) {
          ctx.strokeStyle = sameColorStroke;
        } else {
          ctx.strokeStyle = samePolarityRepel ? repelColorStroke : theme.magneticLinkColor;
        }

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawObstacles(ctx, obstacles, now, alpha = 1.0) {
    const typesCfg = this.obstaclesConfig.types;
    const obsDefaults = this.obstaclesConfig.defaults;
    const drawnPortalPairs = new Set();

    for (const obs of obstacles) {
      if (obs.disabled) {
        continue;
      }
      const cfg = typesCfg[obs.type] || {};
      const ox = this.interpolate(obs.prevX, obs.x, alpha);
      const oy = this.interpolate(obs.prevY, obs.y, alpha);
      const oAngle = this.interpolate(obs.prevAngle, obs.angle, alpha);
      ctx.save();

      if (obs.type === OBSTACLE_TYPES.PORTAL) {
        if (obs.pairId && !drawnPortalPairs.has(obs.pairId)) {
          drawnPortalPairs.add(obs.pairId);
          const mate = obstacles.find((o) => o !== obs && o.type === OBSTACLE_TYPES.PORTAL && o.pairId === obs.pairId);
          if (mate) {
            ctx.save();
            ctx.strokeStyle = cfg.fieldColor;
            ctx.lineWidth = obsDefaults.lineWidth;
            ctx.setLineDash(cfg.linkDash);
            ctx.beginPath();
            ctx.moveTo(ox, oy);
            ctx.lineTo(mate.x, mate.y);
            ctx.stroke();
            ctx.restore();
          }
        }

        const pulseScale = 1 + obs.hitPulse * obsDefaults.bumperPulseScale;
        ctx.translate(ox, oy);
        ctx.scale(pulseScale, pulseScale);

        ctx.fillStyle = cfg.fieldColor;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius + cfg.fieldRadiusPadding, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();

        ctx.fillStyle = cfg.outerColor;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();

        ctx.rotate(oAngle);
        ctx.strokeStyle = cfg.ringColor;
        ctx.lineWidth = obsDefaults.ringLineWidth;
        ctx.setLineDash(cfg.ringDash);
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius - cfg.ringInset, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = cfg.coreColor;
        ctx.lineWidth = obsDefaults.lineWidth;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius * cfg.swirlRadiusFactor, 0, Math.PI * cfg.swirlArcAngleFactor);
        ctx.stroke();
      } else if (obs.type === OBSTACLE_TYPES.SINGULARITY) {
        if (obs.pullRadius > obs.captureRadius && cfg.pullFieldColor) {
          const pullWave = obs.pullRadius - ((now * obsDefaults.fieldWaveSpeed) % obs.pullRadius);
          ctx.fillStyle = cfg.pullFieldColor;
          ctx.beginPath();
          ctx.arc(ox, oy, obs.pullRadius, 0, MATH_CONSTANTS.TWO_PI);
          ctx.fill();

          ctx.strokeStyle = cfg.ringColor;
          ctx.globalAlpha = obsDefaults.fieldWaveAlpha * MATH_CONSTANTS.HALF;
          ctx.lineWidth = obsDefaults.lineWidth;
          ctx.beginPath();
          ctx.arc(ox, oy, Math.max(obs.captureRadius, pullWave), 0, MATH_CONSTANTS.TWO_PI);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        const pulseScale = 1 + obs.hitPulse * obsDefaults.bumperPulseScale;
        ctx.translate(ox, oy);
        ctx.scale(pulseScale, pulseScale);

        ctx.fillStyle = cfg.fieldColor;
        ctx.beginPath();
        ctx.arc(0, 0, obs.captureRadius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();

        ctx.fillStyle = cfg.outerColor;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();

        ctx.rotate(oAngle);
        ctx.strokeStyle = cfg.ringColor;
        ctx.lineWidth = obsDefaults.ringLineWidth;
        ctx.setLineDash(cfg.ringDash);
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius - cfg.ringInset, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = cfg.coreColor;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius * cfg.swirlRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();
      } else if (obs.type === OBSTACLE_TYPES.REPULSOR || obs.type === OBSTACLE_TYPES.ATTRACTOR) {
        const wave = (now * obsDefaults.fieldWaveSpeed) % obs.fieldRadius;
        const radiusWave = obs.type === OBSTACLE_TYPES.REPULSOR
          ? wave
          : obs.fieldRadius - wave;

        ctx.fillStyle = cfg.fieldColor;
        ctx.beginPath();
        ctx.arc(ox, oy, obs.fieldRadius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();

        ctx.strokeStyle = cfg.coreColor;
        ctx.globalAlpha = obsDefaults.fieldWaveAlpha;
        ctx.lineWidth = obsDefaults.lineWidth;
        ctx.beginPath();
        ctx.arc(ox, oy, Math.max(obsDefaults.fieldWaveMinRadius, radiusWave), 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = cfg.coreColor;
        ctx.beginPath();
        ctx.arc(ox, oy, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();
      } else if (obs.type === OBSTACLE_TYPES.PIVOT) {
        const inset = obsDefaults.ringInset;
        ctx.translate(ox, oy);
        ctx.rotate(oAngle);
        ctx.fillStyle = cfg.outerColor;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();

        ctx.strokeStyle = cfg.ringColor;
        ctx.lineWidth = obsDefaults.ringLineWidth;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius - inset, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();

        ctx.strokeStyle = cfg.coreColor;
        ctx.beginPath();
        ctx.moveTo(-obs.radius + inset, 0);
        ctx.lineTo(obs.radius - inset, 0);
        ctx.moveTo(0, -obs.radius + inset);
        ctx.lineTo(0, obs.radius - inset);
        ctx.stroke();
      } else if (obs.type === OBSTACLE_TYPES.BUMPER) {
        const pulseScale = 1 + obs.hitPulse * obsDefaults.bumperPulseScale;
        ctx.translate(ox, oy);
        ctx.scale(pulseScale, pulseScale);
        ctx.fillStyle = cfg.outerColor;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();

        ctx.strokeStyle = cfg.ringColor;
        ctx.lineWidth = cfg.ringLineWidth;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius - obsDefaults.ringInset, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();

        ctx.fillStyle = cfg.coreColor;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius * obsDefaults.bumperCoreRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();
      } else if (obs.type === OBSTACLE_TYPES.BARRIER) {
        const halfW = obs.width * MATH_CONSTANTS.HALF;
        const halfH = obs.height * MATH_CONSTANTS.HALF;
        ctx.fillStyle = cfg.fillColor;
        ctx.strokeStyle = cfg.borderColor;
        ctx.lineWidth = obsDefaults.lineWidth;
        ctx.beginPath();
        ctx.roundRect(ox - halfW, oy - halfH, obs.width, obs.height, obsDefaults.barrierCornerRadius);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  getBallPalette(ball) {
    if (ball.specialType) {
      return this.ballsConfig.specialTypes[ball.specialType];
    }
    return this.colorMap.get(ball.colorId) || this.ballsConfig.standardColors[0];
  }

  drawBall(ctx, ball, now, alpha = 1.0) {
    const palette = this.getBallPalette(ball);
    const r = ball.radius;
    const theme = this.gameConfig.theme;
    const renderCfg = this.ballsConfig.render;
    const bxPos = this.interpolate(ball.prevX, ball.x, alpha);
    const byPos = this.interpolate(ball.prevY, ball.y, alpha);

    ctx.save();
    ctx.translate(bxPos, byPos);

    if (palette.glow && (ball.specialType || ball.clusterModifier)) {
      ctx.save();
      ctx.fillStyle = palette.glow;
      ctx.globalAlpha = renderCfg.glowAlpha;
      ctx.beginPath();
      ctx.arc(0, 0, r * renderCfg.glowRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
      ctx.restore();
    }

    if (ball.isAnchor) {
      ctx.strokeStyle = theme.anchorRingColor;
      ctx.lineWidth = renderCfg.anchorRingLineWidth;
      ctx.beginPath();
      ctx.arc(0, 0, r + renderCfg.anchorRingPadding, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();

      ctx.fillStyle = theme.anchorCoreColor;
      ctx.beginPath();
      ctx.arc(0, -r - renderCfg.anchorRingPadding, renderCfg.anchorPinRadius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
    }

    ctx.fillStyle = this.getCachedBallGradient(palette, r);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();

    ctx.strokeStyle = this.highContrast ? renderCfg.borderStrokeHighContrast : renderCfg.borderStrokeNormal;
    ctx.lineWidth = this.highContrast ? renderCfg.borderWidthHighContrast : renderCfg.borderWidthNormal;
    ctx.stroke();

    ctx.fillStyle = renderCfg.shineColor;
    ctx.beginPath();
    ctx.ellipse(
      r * renderCfg.shineOffsetFactor,
      r * renderCfg.shineOffsetFactor,
      r * renderCfg.shineRadiusXFactor,
      r * renderCfg.shineRadiusYFactor,
      -MATH_CONSTANTS.QUARTER_PI,
      0,
      MATH_CONSTANTS.TWO_PI
    );
    ctx.fill();

    if (ball.isFrozen) {
      ctx.fillStyle = theme.frozenOverlayColor;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
    }

    const modSpec = ball.clusterModifier
      ? this.ballsConfig.clusterModifiers?.[ball.clusterModifier]
      : null;

    if (modSpec) {
      const isArmoredType =
        ball.clusterModifier === CLUSTER_MODIFIERS.ARMORED || ball.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE;
      const isCrackedArmor = isArmoredType && ball.armorHits === 1;
      ctx.strokeStyle = isCrackedArmor && modSpec.crackedColor ? modSpec.crackedColor : modSpec.ringColor;
      ctx.lineWidth = isArmoredType && ball.armorHits > 1
        ? renderCfg.armorIntactLineWidth
        : renderCfg.modifierRingLineWidth;
      if (isCrackedArmor) {
        ctx.setLineDash(renderCfg.crackedArmorDash);
      }
      ctx.beginPath();
      ctx.arc(0, 0, r - renderCfg.modifierRingInset, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const primaryLabel = palette.icon || palette.symbol;
    if (primaryLabel) {
      const fontScale = this.highContrast ? renderCfg.labelScaleHighContrast : renderCfg.labelScaleNormal;
      ctx.font = `bold ${Math.round(r * fontScale)}px ${theme.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (this.highContrast) {
        ctx.strokeStyle = theme.floatingTextShadowColor;
        ctx.lineWidth = renderCfg.labelStrokeWidth;
        ctx.strokeText(primaryLabel, 0, renderCfg.labelOffsetY);
      }
      ctx.fillStyle = this.highContrast ? renderCfg.labelColorHighContrast : renderCfg.labelColorNormal;
      ctx.fillText(primaryLabel, 0, renderCfg.labelOffsetY);
    }

    if (modSpec?.badge) {
      const bx = r * renderCfg.badgeOffsetFactor;
      const by = -r * renderCfg.badgeOffsetFactor;
      ctx.fillStyle = theme.floatingTextShadowColor;
      ctx.strokeStyle = modSpec.ringColor;
      ctx.lineWidth = renderCfg.badgeBorderWidth;
      ctx.beginPath();
      ctx.arc(bx, by, r * renderCfg.badgeRadiusFactor, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = renderCfg.badgeColor;
      ctx.font = `bold ${Math.round(r * renderCfg.badgeFontScale)}px ${theme.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(modSpec.badge, bx, by + renderCfg.badgeTextOffsetY);
    }

    if (ball.specialType) {
      const glowPulse =
        renderCfg.specialGlowBaseAlpha +
        renderCfg.specialGlowPulseAmp * Math.sin(now * renderCfg.specialGlowPulseSpeed + ball.pulsePhase);
      ctx.strokeStyle = palette.highlight;
      ctx.globalAlpha = glowPulse;
      ctx.lineWidth = renderCfg.specialGlowLineWidth;
      ctx.beginPath();
      ctx.arc(0, 0, r + renderCfg.specialGlowRadiusOffset, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawTrail(ctx, particleSystem) {
    if (particleSystem.trailParticles.length === 0) {
      return;
    }
    ctx.save();
    for (const tp of particleSystem.trailParticles) {
      ctx.fillStyle = tp.color;
      ctx.globalAlpha = Math.max(0, tp.alpha);
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, tp.radius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  drawAimTrajectory(ctx, points, currentBall, physicsWorld, theme, now, blastRadiusMultiplier = 1.0) {
    if (!points || points.length < 2 || !currentBall) {
      return;
    }
    const palette = this.getBallPalette(currentBall);

    ctx.save();
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = theme.aimLineWidth;
    ctx.setLineDash(theme.aimLineDash);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      if (points[i].warpBreak) {
        ctx.moveTo(points[i].x, points[i].y);
      } else {
        ctx.lineTo(points[i].x, points[i].y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const endX = points.landingX !== undefined ? points.landingX : points[points.length - 1].x;
    const endY = points.landingY !== undefined ? points.landingY : points[points.length - 1].y;
    ctx.globalAlpha = theme.aimGhostFillAlpha;
    ctx.fillStyle = palette.fill;
    ctx.beginPath();
    ctx.arc(endX, endY, currentBall.radius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    ctx.globalAlpha = theme.aimGhostStrokeAlpha;
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = theme.aimGhostLineWidth;
    ctx.stroke();

    const pulse = theme.magneticPulseBase + theme.magneticPulseAmp * Math.sin(now * theme.aimTargetPulseSpeed);
    const affectedBalls = [];
    const destroyedIds = new Set();

    if (currentBall.specialType && physicsWorld) {
      const specType = currentBall.specialType;
      const specCfg = this.ballsConfig.specialTypes[specType];
      if (specType === SPECIAL_TYPES.BOMB || specType === SPECIAL_TYPES.FREEZE) {
        const radiusFactor = specType === SPECIAL_TYPES.BOMB
          ? specCfg.blastRadiusFactor
          : specCfg.freezeRadiusFactor;
        const aoeRadius = currentBall.radius * radiusFactor * blastRadiusMultiplier;
        ctx.save();
        ctx.fillStyle = palette.highlight;
        ctx.globalAlpha = theme.specialAoeFillAlpha;
        ctx.beginPath();
        ctx.arc(endX, endY, aoeRadius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();
        ctx.strokeStyle = palette.highlight;
        ctx.globalAlpha = theme.specialAoeStrokeAlpha * pulse;
        ctx.lineWidth = theme.aimGhostLineWidth;
        ctx.setLineDash(theme.specialAoeDash);
        ctx.stroke();
        ctx.restore();

        for (const b of physicsWorld.balls) {
          if (Math.hypot(b.x - endX, b.y - endY) <= aoeRadius) {
            affectedBalls.push(b);
            if (specType === SPECIAL_TYPES.BOMB) {
              destroyedIds.add(b.id);
            }
          }
        }
      } else if (specType === SPECIAL_TYPES.LIGHTNING) {
        const bandHalf = currentBall.radius * specCfg.bandHalfHeightFactor * blastRadiusMultiplier;
        const margin = this.gameConfig.canvas.wallMargin;
        const bandWidth = this.logicalWidth - margin * 2;
        ctx.save();
        ctx.fillStyle = palette.highlight;
        ctx.globalAlpha = theme.specialAoeFillAlpha;
        ctx.fillRect(margin, endY - bandHalf, bandWidth, bandHalf * 2);
        ctx.strokeStyle = palette.highlight;
        ctx.globalAlpha = theme.specialAoeStrokeAlpha * pulse;
        ctx.lineWidth = theme.aimGhostLineWidth;
        ctx.setLineDash(theme.specialAoeDash);
        ctx.strokeRect(margin, endY - bandHalf, bandWidth, bandHalf * 2);
        ctx.restore();

        for (const b of physicsWorld.balls) {
          if (Math.abs(b.y - endY) <= bandHalf) {
            affectedBalls.push(b);
            destroyedIds.add(b.id);
          }
        }
      } else if (specType === SPECIAL_TYPES.RAINBOW) {
        const neighborRadius = currentBall.radius * specCfg.neighborRadiusFactor;
        const seen = new Set();
        for (const other of physicsWorld.balls) {
          if (other.colorId && Math.hypot(other.x - endX, other.y - endY) <= neighborRadius) {
            const cluster = physicsWorld.findColorCluster(other);
            for (const member of cluster) {
              if (!seen.has(member.id)) {
                seen.add(member.id);
                affectedBalls.push(member);
                if (member.armorHits <= 1) {
                  destroyedIds.add(member.id);
                }
              }
            }
          }
        }
      } else if (specType === SPECIAL_TYPES.ANVIL) {
        const pierceRadius = currentBall.radius * specCfg.pierceRadiusFactor;
        const seen = new Set();
        for (const pt of points) {
          for (const b of physicsWorld.balls) {
            if (!seen.has(b.id) && Math.hypot(b.x - pt.x, b.y - pt.y) <= pierceRadius) {
              seen.add(b.id);
              affectedBalls.push(b);
              destroyedIds.add(b.id);
            }
          }
        }
      }

      if (affectedBalls.length > 0) {
        ctx.strokeStyle = theme.targetHighlightColor;
        ctx.lineWidth = theme.aimTargetMatchLineWidth;
        ctx.globalAlpha = pulse;
        for (const member of affectedBalls) {
          ctx.beginPath();
          ctx.arc(member.x, member.y, member.radius + theme.aimTargetRingPadding, 0, MATH_CONSTANTS.TWO_PI);
          ctx.stroke();
        }
      }
    } else if (points.snapTarget && physicsWorld) {
      const target = points.snapTarget;
      const isMatchingColor = currentBall.colorId && currentBall.colorId === target.colorId;
      const cluster = isMatchingColor ? physicsWorld.findColorCluster(target) : [target];
      const willMatch = isMatchingColor && cluster.length + 1 >= this.gameConfig.defaults.matchMinCount;
      ctx.strokeStyle = willMatch ? theme.targetHighlightColor : palette.highlight;
      ctx.lineWidth = willMatch ? theme.aimTargetMatchLineWidth : theme.aimTargetNormalLineWidth;
      ctx.globalAlpha = pulse;
      for (const member of cluster) {
        ctx.beginPath();
        ctx.arc(member.x, member.y, member.radius + theme.aimTargetRingPadding, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
        if (willMatch && member.armorHits <= 1) {
          destroyedIds.add(member.id);
        }
      }
    }

    if (destroyedIds.size > 0 && physicsWorld && typeof physicsWorld.findDetachedIfRemoved === 'function') {
      const avalancheBalls = physicsWorld.findDetachedIfRemoved(destroyedIds);
      if (avalancheBalls.length > 0) {
        ctx.save();
        ctx.strokeStyle = theme.avalancheDropHighlightColor || theme.anchorRingColor;
        ctx.lineWidth = theme.aimTargetNormalLineWidth;
        ctx.setLineDash(theme.specialAoeDash);
        ctx.globalAlpha = pulse;
        for (const ab of avalancheBalls) {
          ctx.beginPath();
          ctx.arc(ab.x, ab.y, ab.radius + theme.aimTargetRingPadding + theme.avalancheRingPaddingExtra, 0, MATH_CONSTANTS.TWO_PI);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }

  drawLauncher(ctx, engineState, theme, now) {
    const canvasCfg = this.gameConfig.canvas;
    const launcherGeom = canvasCfg.launcher;
    const lx = canvasCfg.launcherX;
    const ly = canvasCfg.launcherY;
    const angle = engineState.aimAngle;

    if (engineState.isAimCancelled) {
      ctx.save();
      ctx.strokeStyle = theme.cancelAimColor;
      ctx.lineWidth = launcherGeom.cancelRingLineWidth;
      ctx.setLineDash(launcherGeom.cancelRingDash);
      ctx.beginPath();
      ctx.arc(lx, ly, launcherGeom.cancelRingRadius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(angle + Math.PI * MATH_CONSTANTS.HALF);

    ctx.fillStyle = theme.launcherBarrelColor;
    ctx.strokeStyle = theme.launcherAccentColor;
    ctx.lineWidth = launcherGeom.barrelBorderWidth;
    ctx.beginPath();
    ctx.roundRect(
      launcherGeom.barrelX,
      launcherGeom.barrelY,
      launcherGeom.barrelWidth,
      launcherGeom.barrelHeight,
      launcherGeom.barrelCornerRadius
    );
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    ctx.save();
    ctx.fillStyle = theme.launcherBaseColor;
    ctx.strokeStyle = theme.launcherAccentColor;
    ctx.lineWidth = launcherGeom.baseBorderWidth;
    ctx.beginPath();
    ctx.arc(lx, ly, launcherGeom.baseRadius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (engineState.currentBall && !engineState.physicsWorld.projectile) {
      engineState.currentBall.x = lx;
      engineState.currentBall.y = ly;
      engineState.currentBall.savePreviousPosition();
      this.drawBall(ctx, engineState.currentBall, now, 1.0);
      if (engineState.isPolarityFlipped) {
        const renderCfg = this.ballsConfig.render;
        ctx.save();
        ctx.strokeStyle = renderCfg.polarityFlipRingColor;
        ctx.lineWidth = launcherGeom.nextBallRingWidth;
        ctx.setLineDash(renderCfg.polarityFlipDash);
        ctx.beginPath();
        ctx.arc(lx, ly, engineState.currentBall.radius + renderCfg.polarityFlipRadiusOffset, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (engineState.nextBall) {
      const nx = lx + canvasCfg.nextBallOffsetX;
      const ny = ly + canvasCfg.nextBallOffsetY;
      ctx.save();
      ctx.strokeStyle = theme.launcherAccentColor;
      ctx.lineWidth = launcherGeom.nextBallRingWidth;
      ctx.beginPath();
      ctx.arc(nx, ny, engineState.nextBall.radius + launcherGeom.nextBallRingPadding, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
      ctx.restore();

      engineState.nextBall.x = nx;
      engineState.nextBall.y = ny;
      engineState.nextBall.savePreviousPosition();
      this.drawBall(ctx, engineState.nextBall, now, 1.0);
    }
  }

  drawParticles(ctx, particleSystem) {
    const pCfg = this.gameConfig.juice.particles;
    const theme = this.gameConfig.theme;
    ctx.save();

    for (const sw of particleSystem.shockwaves) {
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = Math.max(0, sw.alpha);
      ctx.lineWidth = pCfg.shockwaveLineWidth;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
    }

    for (const bolt of particleSystem.lightningBolts) {
      if (bolt.segments.length < 2) {
        continue;
      }
      ctx.strokeStyle = bolt.color;
      ctx.globalAlpha = Math.max(0, bolt.alpha);
      ctx.lineWidth = pCfg.lightningLineWidth;
      ctx.beginPath();
      ctx.moveTo(bolt.segments[0].x, bolt.segments[0].y);
      for (let i = 1; i < bolt.segments.length; i++) {
        ctx.lineTo(bolt.segments[i].x, bolt.segments[i].y);
      }
      ctx.stroke();

      if (bolt.branches) {
        ctx.lineWidth = pCfg.lightningBranchLineWidth;
        for (const branch of bolt.branches) {
          if (branch.length < 2) {
            continue;
          }
          ctx.beginPath();
          ctx.moveTo(branch[0].x, branch[0].y);
          for (let j = 1; j < branch.length; j++) {
            ctx.lineTo(branch[j].x, branch[j].y);
          }
          ctx.stroke();
        }
      }
    }

    for (const p of particleSystem.particles) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
    }

    const shadowColor = theme.floatingTextShadowColor;
    const shadowOffset = pCfg.floatingTextShadowOffset;
    ctx.font = `bold ${pCfg.floatingTextFontSize}px ${theme.fontFamily}`;
    ctx.textAlign = 'center';
    for (const ft of particleSystem.floatingTexts) {
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.fillStyle = shadowColor;
      ctx.fillText(ft.text, ft.x + shadowOffset, ft.y + shadowOffset);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }

    ctx.restore();
  }
}

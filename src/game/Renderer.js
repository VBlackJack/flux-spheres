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

import { OBSTACLE_TYPES, CLUSTER_MODIFIERS, MATH_CONSTANTS } from '../core/Constants.js';

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

    this.canvas.width = gameConfig.canvas.logicalWidth;
    this.canvas.height = gameConfig.canvas.logicalHeight;

    const theme = this.gameConfig.theme;
    this.bgGradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    this.bgGradient.addColorStop(0, theme.backgroundTop);
    this.bgGradient.addColorStop(1, theme.backgroundBottom);

    this.ballGradientCache = new Map();
    this.highContrast = false;
  }

  setHighContrast(enabled) {
    this.highContrast = Boolean(enabled);
  }

  getCachedBallGradient(palette, radius) {
    const key = `${palette.id}_${radius}`;
    let grad = this.ballGradientCache.get(key);
    if (!grad) {
      grad = this.ctx.createRadialGradient(
        -radius * 0.35,
        -radius * 0.35,
        radius * 0.12,
        0,
        0,
        radius
      );
      grad.addColorStop(0, palette.highlight);
      grad.addColorStop(0.55, palette.fill);
      grad.addColorStop(1, palette.shadow);
      this.ballGradientCache.set(key, grad);
    }
    return grad;
  }

  render(engineState) {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const theme = this.gameConfig.theme;
    const now = performance.now();

    ctx.save();
    const shake = engineState.particleSystem.shakeIntensity;
    if (shake > 0) {
      const dx = (Math.random() - MATH_CONSTANTS.HALF) * 2 * shake;
      const dy = (Math.random() - MATH_CONSTANTS.HALF) * 2 * shake;
      ctx.translate(dx, dy);
    }

    ctx.fillStyle = this.bgGradient;
    ctx.fillRect(0, 0, width, height);

    this.drawGrid(ctx, width, height, theme);
    this.drawWallsAndDangerZone(ctx, width, height, theme);
    this.drawObstacles(ctx, engineState.physicsWorld.obstacles, now);
    this.drawMagneticBonds(ctx, engineState.physicsWorld, theme, now);

    for (const ball of engineState.physicsWorld.balls) {
      this.drawBall(ctx, ball, now);
    }

    for (const ball of engineState.physicsWorld.droppingBalls) {
      this.drawBall(ctx, ball, now);
    }

    if (engineState.aimPoints && !engineState.physicsWorld.projectile && !engineState.isAimCancelled) {
      this.drawAimTrajectory(
        ctx,
        engineState.aimPoints,
        engineState.currentBall,
        engineState.physicsWorld,
        theme,
        now
      );
    }

    this.drawTrail(ctx, engineState.particleSystem);

    if (engineState.physicsWorld.projectile) {
      this.drawBall(ctx, engineState.physicsWorld.projectile, now);
    }

    this.drawLauncher(ctx, engineState, theme, now);
    this.drawParticles(ctx, engineState.particleSystem);
    ctx.restore();
  }

  drawGrid(ctx, width, height, theme) {
    ctx.strokeStyle = theme.gridLineColor;
    ctx.lineWidth = 1;
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

  drawWallsAndDangerZone(ctx, width, height, theme) {
    const margin = this.gameConfig.canvas.wallMargin;
    const dangerY = this.gameConfig.canvas.dangerLineY;

    ctx.fillStyle = theme.dangerZoneFill;
    ctx.fillRect(margin, dangerY, width - margin * 2, height - dangerY);

    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = theme.dangerLineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(margin, dangerY);
    ctx.lineTo(width - margin, dangerY);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = theme.wallGlowColor;
    ctx.lineWidth = 8;
    ctx.strokeRect(margin * MATH_CONSTANTS.HALF, margin * MATH_CONSTANTS.HALF, width - margin, height - margin);

    ctx.strokeStyle = theme.wallColor;
    ctx.lineWidth = 4;
    ctx.strokeRect(margin * MATH_CONSTANTS.HALF, margin * MATH_CONSTANTS.HALF, width - margin, height - margin);
  }

  drawMagneticBonds(ctx, physicsWorld, theme, now) {
    const pulse = 0.65 + 0.35 * Math.sin(now * theme.magneticFieldPulseSpeed);
    const magCfg = physicsWorld.physicsConfig.magnetism;
    const ballRadius = physicsWorld.physicsConfig.ball.radius;
    const fieldMaxDist = ballRadius * magCfg.fieldLineMaxDistanceFactor;
    const fieldMaxDistSq = fieldMaxDist * fieldMaxDist;

    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 5]);
    for (let i = 0; i < physicsWorld.balls.length; i++) {
      const a = physicsWorld.balls[i];
      if (!a.colorId) {
        continue;
      }
      for (let j = i + 1; j < physicsWorld.balls.length; j++) {
        const b = physicsWorld.balls[j];
        if (a.colorId !== b.colorId || a.bonds.has(b.id)) {
          continue;
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= fieldMaxDistSq) {
          ctx.strokeStyle = `rgba(${theme.magneticSameColorBase}, ${0.24 * pulse})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.setLineDash([]);

    ctx.lineWidth = 2.4;
    for (const a of physicsWorld.balls) {
      for (const neighborId of a.bonds) {
        if (neighborId <= a.id) {
          continue;
        }
        const b = physicsWorld.ballMap.get(neighborId);
        if (!b) {
          continue;
        }
        const sameColor = a.colorId && a.colorId === b.colorId;
        ctx.strokeStyle = sameColor
          ? `rgba(${theme.magneticSameColorBase}, ${0.55 * pulse})`
          : theme.magneticLinkColor;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawObstacles(ctx, obstacles, now) {
    const typesCfg = this.obstaclesConfig.types;
    const obsDefaults = this.obstaclesConfig.defaults;
    const drawnPortalPairs = new Set();

    for (const obs of obstacles) {
      const cfg = typesCfg[obs.type] || {};
      ctx.save();

      if (obs.type === OBSTACLE_TYPES.PORTAL) {
        if (obs.pairId && !drawnPortalPairs.has(obs.pairId)) {
          drawnPortalPairs.add(obs.pairId);
          const mate = obstacles.find((o) => o !== obs && o.type === OBSTACLE_TYPES.PORTAL && o.pairId === obs.pairId);
          if (mate) {
            ctx.save();
            ctx.strokeStyle = cfg.fieldColor;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 8]);
            ctx.beginPath();
            ctx.moveTo(obs.x, obs.y);
            ctx.lineTo(mate.x, mate.y);
            ctx.stroke();
            ctx.restore();
          }
        }

        const pulseScale = 1 + obs.hitPulse * obsDefaults.bumperPulseScale;
        ctx.translate(obs.x, obs.y);
        ctx.scale(pulseScale, pulseScale);

        ctx.fillStyle = cfg.fieldColor;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius + 8, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();

        ctx.fillStyle = cfg.outerColor;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();

        ctx.rotate(obs.angle);
        ctx.strokeStyle = cfg.ringColor;
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius - 3, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = cfg.coreColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius * 0.45, 0, Math.PI * 1.35);
        ctx.stroke();
      } else if (obs.type === OBSTACLE_TYPES.REPULSOR || obs.type === OBSTACLE_TYPES.ATTRACTOR) {
        const wave = (now * obsDefaults.fieldWaveSpeed) % obs.fieldRadius;
        const radiusWave = obs.type === OBSTACLE_TYPES.REPULSOR
          ? wave
          : obs.fieldRadius - wave;

        ctx.fillStyle = cfg.fieldColor;
        ctx.beginPath();
        ctx.arc(obs.x, obs.y, obs.fieldRadius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();

        ctx.strokeStyle = cfg.coreColor;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(obs.x, obs.y, Math.max(4, radiusWave), 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = cfg.coreColor;
        ctx.beginPath();
        ctx.arc(obs.x, obs.y, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();
      } else if (obs.type === OBSTACLE_TYPES.PIVOT) {
        ctx.translate(obs.x, obs.y);
        ctx.rotate(obs.angle);
        ctx.fillStyle = cfg.outerColor;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();

        ctx.strokeStyle = cfg.ringColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius - 4, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();

        ctx.strokeStyle = cfg.coreColor;
        ctx.beginPath();
        ctx.moveTo(-obs.radius + 4, 0);
        ctx.lineTo(obs.radius - 4, 0);
        ctx.moveTo(0, -obs.radius + 4);
        ctx.lineTo(0, obs.radius - 4);
        ctx.stroke();
      } else if (obs.type === OBSTACLE_TYPES.BUMPER) {
        const pulseScale = 1 + obs.hitPulse * obsDefaults.bumperPulseScale;
        ctx.translate(obs.x, obs.y);
        ctx.scale(pulseScale, pulseScale);
        ctx.fillStyle = cfg.outerColor;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius, 0, MATH_CONSTANTS.TWO_PI);
        ctx.fill();

        ctx.strokeStyle = cfg.ringColor;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, obs.radius - 4, 0, MATH_CONSTANTS.TWO_PI);
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
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(obs.x - halfW, obs.y - halfH, obs.width, obs.height, obsDefaults.barrierCornerRadius);
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

  drawBall(ctx, ball, now) {
    const palette = this.getBallPalette(ball);
    const r = ball.radius;
    const theme = this.gameConfig.theme;

    ctx.save();
    ctx.translate(ball.x, ball.y);

    if (ball.isAnchor) {
      ctx.strokeStyle = theme.anchorRingColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, r + 3.5, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();

      ctx.fillStyle = theme.anchorCoreColor;
      ctx.beginPath();
      ctx.arc(0, -r - 3.5, 2.5, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
    }

    ctx.fillStyle = this.getCachedBallGradient(palette, r);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();

    ctx.strokeStyle = this.highContrast ? '#ffffff' : 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = this.highContrast ? 2.5 : 1.25;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.ellipse(
      -r * 0.32,
      -r * 0.32,
      r * 0.26,
      r * 0.14,
      -Math.PI / 4,
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
      const isCrackedArmor =
        (ball.clusterModifier === CLUSTER_MODIFIERS.ARMORED || ball.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE) &&
        ball.armorHits === 1;
      ctx.strokeStyle = isCrackedArmor && modSpec.crackedColor ? modSpec.crackedColor : modSpec.ringColor;
      ctx.lineWidth =
        (ball.clusterModifier === CLUSTER_MODIFIERS.ARMORED || ball.clusterModifier === CLUSTER_MODIFIERS.BOSS_CORE) &&
        ball.armorHits > 1
          ? 3.8
          : 2.4;
      if (isCrackedArmor) {
        ctx.setLineDash([5, 4]);
      }
      ctx.beginPath();
      ctx.arc(0, 0, r - 2, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const primaryLabel = palette.icon || palette.symbol;
    if (primaryLabel) {
      const fontScale = this.highContrast ? 0.78 : 0.68;
      ctx.font = `bold ${Math.round(r * fontScale)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (this.highContrast) {
        ctx.strokeStyle = theme.floatingTextShadowColor;
        ctx.lineWidth = 3;
        ctx.strokeText(primaryLabel, 0, 1);
      }
      ctx.fillStyle = this.highContrast ? '#ffffff' : 'rgba(255, 255, 255, 0.92)';
      ctx.fillText(primaryLabel, 0, 1);
    }

    if (modSpec?.badge) {
      const bx = r * 0.56;
      const by = -r * 0.56;
      ctx.fillStyle = theme.floatingTextShadowColor;
      ctx.strokeStyle = modSpec.ringColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.36, 0, MATH_CONSTANTS.TWO_PI);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.font = `bold ${Math.round(r * 0.42)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(modSpec.badge, bx, by + 0.5);
    }

    if (ball.specialType) {
      const glowPulse = 0.6 + 0.4 * Math.sin(now * 0.008 + ball.pulsePhase);
      ctx.strokeStyle = palette.highlight;
      ctx.globalAlpha = glowPulse;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r + 2.5, 0, MATH_CONSTANTS.TWO_PI);
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

  drawAimTrajectory(ctx, points, currentBall, physicsWorld, theme, now) {
    if (!points || points.length < 2 || !currentBall) {
      return;
    }
    const palette = this.getBallPalette(currentBall);

    ctx.save();
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 7]);
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
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = palette.fill;
    ctx.beginPath();
    ctx.arc(endX, endY, currentBall.radius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (points.snapTarget && physicsWorld) {
      const target = points.snapTarget;
      const isMatchingColor = currentBall.colorId && currentBall.colorId === target.colorId;
      const cluster = isMatchingColor ? physicsWorld.findColorCluster(target) : [target];
      const willMatch = isMatchingColor && cluster.length + 1 >= this.gameConfig.defaults.matchMinCount;
      const pulse = 0.65 + 0.35 * Math.sin(now * 0.012);
      ctx.strokeStyle = willMatch ? (theme.targetHighlightColor || palette.highlight) : palette.highlight;
      ctx.lineWidth = willMatch ? 3 : 2;
      ctx.globalAlpha = pulse;
      for (const member of cluster) {
        ctx.beginPath();
        ctx.arc(member.x, member.y, member.radius + 4, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  drawLauncher(ctx, engineState, theme, now) {
    const canvasCfg = this.gameConfig.canvas;
    const lx = canvasCfg.launcherX;
    const ly = canvasCfg.launcherY;
    const angle = engineState.aimAngle;

    if (engineState.isAimCancelled) {
      ctx.save();
      ctx.strokeStyle = theme.cancelAimColor;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(lx, ly, 42, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(angle + Math.PI * MATH_CONSTANTS.HALF);

    ctx.fillStyle = theme.launcherBarrelColor;
    ctx.strokeStyle = theme.launcherAccentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-22, -46, 44, 52, 10);
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    ctx.save();
    ctx.fillStyle = theme.launcherBaseColor;
    ctx.strokeStyle = theme.launcherAccentColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(lx, ly, 30, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (engineState.currentBall && !engineState.physicsWorld.projectile) {
      engineState.currentBall.x = lx;
      engineState.currentBall.y = ly;
      this.drawBall(ctx, engineState.currentBall, now);
    }

    if (engineState.nextBall) {
      const nx = lx + canvasCfg.nextBallOffsetX;
      const ny = ly + canvasCfg.nextBallOffsetY;
      ctx.save();
      ctx.strokeStyle = theme.launcherAccentColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(nx, ny, engineState.nextBall.radius + 5, 0, MATH_CONSTANTS.TWO_PI);
      ctx.stroke();
      ctx.restore();

      engineState.nextBall.x = nx;
      engineState.nextBall.y = ny;
      this.drawBall(ctx, engineState.nextBall, now);
    }
  }

  drawParticles(ctx, particleSystem) {
    ctx.save();

    for (const sw of particleSystem.shockwaves) {
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = Math.max(0, sw.alpha);
      ctx.lineWidth = 3.5;
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
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(bolt.segments[0].x, bolt.segments[0].y);
      for (let i = 1; i < bolt.segments.length; i++) {
        ctx.lineTo(bolt.segments[i].x, bolt.segments[i].y);
      }
      ctx.stroke();

      if (bolt.branches) {
        ctx.lineWidth = 2;
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

    const shadowColor = this.gameConfig.theme.floatingTextShadowColor;
    for (const ft of particleSystem.floatingTexts) {
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = shadowColor;
      ctx.fillText(ft.text, ft.x + 1, ft.y + 1);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }

    ctx.restore();
  }
}

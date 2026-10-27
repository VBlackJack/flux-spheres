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
import { isChainLink } from '../physics/PhysicsWorld.js';

const BOND_STYLE = Object.freeze({
  STRESSED: 0,
  SAME_COLOR: 1,
  REPEL: 2,
  LINK: 3,
  CHAIN: 4
});
const BOND_STYLE_COUNT = 5;
const SEGMENT_STRIDE = 4;
/** Cubic ease-out of the Flux shape entrance: fast at first, soft landing. */
const INTRO_EASE_POWER = 3;
/** Fixed render clock under reduced motion: pulses and field waves hold their resting frame. */
const REDUCED_MOTION_CLOCK_MS = 0;

/** Media query matching exactly the given device pixel ratio. */
export function buildResolutionQuery(dpr) {
  return `(resolution: ${dpr}dppx)`;
}

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
    this.colorWeights = new Map();
    ballsConfig.standardColors.forEach((c, index) => {
      this.colorMap.set(c.id, c);
      this.colorWeights.set(c.id, index + 1);
    });

    this.logicalWidth = gameConfig.canvas.logicalWidth;
    this.logicalHeight = gameConfig.canvas.logicalHeight;
    this.dpr = 1;
    this.scaleX = 1;
    this.scaleY = 1;
    this.resolutionDirty = true;
    this.staticLayer = null;
    this.staticLayerDirty = true;

    const theme = this.gameConfig.theme;
    this.floatingTextFont = `bold ${gameConfig.juice.particles.floatingTextFontSize}px ${theme.fontFamily}`;
    this.labelFontCache = new Map();
    // CSS pixels per logical unit; ball labels are enlarged when it gets small.
    this.displayScale = 1;
    this.badgeFontCache = new Map();

    this.bondSegments = [];
    for (let i = 0; i < BOND_STYLE_COUNT; i++) {
      this.bondSegments.push([]);
    }

    this.portalLinks = new Map();
    this.portalLinkSource = [];

    this.aimPreview = {
      valid: false,
      aimAngle: 0,
      cellX: 0,
      cellY: 0,
      ballId: 0,
      specialType: null,
      colorId: null,
      snapTargetId: 0,
      blastMult: 0,
      boardCount: 0,
      boardIdSum: 0,
      boardBondTotal: 0,
      boardArmorTotal: 0,
      boardColorSum: 0,
      highlightBalls: [],
      highlightIsMatch: false,
      destroyedIds: new Set(),
      avalancheBalls: []
    };
    this.aimPreviewComputeCount = 0;

    this.ballGradientCache = new Map();
    this.highContrast = false;
    this.bindResolutionListeners();
    this.updateCanvasResolution();
  }

  bindResolutionListeners() {
    if (typeof window === 'undefined') {
      return;
    }
    const invalidate = () => {
      this.resolutionDirty = true;
    };
    window.addEventListener('resize', invalidate);
    window.addEventListener('orientationchange', invalidate);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(invalidate);
      this.resizeObserver.observe(this.canvas);
    }
    this.watchDevicePixelRatio(invalidate);
  }

  /**
   * Moving the window to a screen with another pixel density, or zooming the page,
   * changes devicePixelRatio without always resizing the canvas. A resolution query
   * only matches the ratio it was built for, so each change re-arms a new one.
   */
  watchDevicePixelRatio(onChange) {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const query = window.matchMedia(buildResolutionQuery(dpr));
    if (typeof query.addEventListener !== 'function') {
      return;
    }
    query.addEventListener(
      'change',
      () => {
        onChange();
        this.watchDevicePixelRatio(onChange);
      },
      { once: true }
    );
  }

  /**
   * Sizes the backing store from the canvas display size times the capped device pixel
   * ratio. The logical coordinate system is preserved through setTransform in render().
   */
  updateCanvasResolution() {
    if (!this.resolutionDirty) {
      return;
    }
    this.resolutionDirty = false;
    const rawDpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const nextDpr = Math.max(1, Math.min(this.gameConfig.canvas.maxDevicePixelRatio, rawDpr));
    const rect = this.canvas.getBoundingClientRect();
    const displayW = rect.width > 0 ? rect.width : this.logicalWidth;
    const displayH = rect.height > 0 ? rect.height : this.logicalHeight;
    const targetW = Math.max(1, Math.round(displayW * nextDpr));
    const targetH = Math.max(1, Math.round(displayH * nextDpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH || this.dpr !== nextDpr) {
      this.dpr = nextDpr;
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this.staticLayerDirty = true;
    }
    this.scaleX = this.canvas.width / this.logicalWidth;
    this.scaleY = this.canvas.height / this.logicalHeight;
    const nextDisplayScale = displayW / this.logicalWidth;
    if (nextDisplayScale !== this.displayScale) {
      this.displayScale = nextDisplayScale;
      this.labelFontCache.clear();
    }
  }

  invalidateStaticLayer() {
    this.staticLayerDirty = true;
  }

  createLayerCanvas() {
    return document.createElement('canvas');
  }

  /**
   * Pre-renders the static background gradient, grid and walls at backing-store
   * resolution so each frame blits one image instead of redrawing them.
   */
  buildStaticLayer() {
    if (!this.staticLayer) {
      this.staticLayer = this.createLayerCanvas();
    }
    this.staticLayer.width = this.canvas.width;
    this.staticLayer.height = this.canvas.height;
    const layerCtx = this.staticLayer.getContext('2d');
    const theme = this.gameConfig.theme;
    const width = this.logicalWidth;
    const height = this.logicalHeight;

    layerCtx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
    const bgGradient = layerCtx.createLinearGradient(0, 0, 0, height);
    bgGradient.addColorStop(0, theme.backgroundTop);
    bgGradient.addColorStop(1, theme.backgroundBottom);
    layerCtx.fillStyle = bgGradient;
    layerCtx.fillRect(0, 0, width, height);
    this.drawGrid(layerCtx, width, height, theme);
    this.drawWalls(layerCtx, width, height, theme);
    this.staticLayerDirty = false;
  }

  setHighContrast(enabled) {
    this.highContrast = Boolean(enabled);
  }

  /**
   * Polarity glyphs are the color-independent cue for a ball, so on a small canvas
   * they grow toward the ball edge to stay at a readable on-screen size.
   * @returns {{font: string, isEnlarged: boolean}}
   */
  getLabelFont(radius) {
    let entry = this.labelFontCache.get(radius);
    if (!entry) {
      const renderCfg = this.ballsConfig.render;
      const family = this.gameConfig.theme.fontFamily;
      const minLogicalPx = renderCfg.labelMinDisplayPx / this.displayScale;
      const maxLogicalPx = radius * renderCfg.labelScaleMax;
      const build = (scale) => {
        const basePx = radius * scale;
        const px = Math.min(maxLogicalPx, Math.max(basePx, minLogicalPx));
        return { font: `bold ${Math.round(px)}px ${family}`, isEnlarged: px > basePx };
      };
      entry = {
        normal: build(renderCfg.labelScaleNormal),
        highContrast: build(renderCfg.labelScaleHighContrast)
      };
      this.labelFontCache.set(radius, entry);
    }
    return this.highContrast ? entry.highContrast : entry.normal;
  }

  getBadgeFont(radius) {
    let font = this.badgeFontCache.get(radius);
    if (!font) {
      const scale = this.ballsConfig.render.badgeFontScale;
      font = `bold ${Math.round(radius * scale)}px ${this.gameConfig.theme.fontFamily}`;
      this.badgeFontCache.set(radius, font);
    }
    return font;
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

  /**
   * Vertical distance, in logical pixels, still left for an incoming Flux shape to travel.
   * Eases out so the shape lands softly; 0 once it is in place or outside Flux.
   */
  getStageIntroOffset(engineState) {
    if (typeof engineState.getStageIntroProgress !== 'function' || !engineState.fluxConfig) {
      return 0;
    }
    const remaining = 1 - engineState.getStageIntroProgress();
    if (remaining <= 0) {
      return 0;
    }
    return engineState.fluxConfig.transition.introDropDistance * remaining ** INTRO_EASE_POWER;
  }

  render(engineState, alpha = 1.0) {
    this.updateCanvasResolution();
    if (this.staticLayerDirty) {
      this.buildStaticLayer();
    }
    const ctx = this.ctx;
    const width = this.logicalWidth;
    const height = this.logicalHeight;
    const theme = this.gameConfig.theme;
    // Every pulse, glow and field wave is a function of this clock: holding it still under
    // reduced motion freezes them all, while the physics keeps moving the board.
    const now = engineState.isReducedMotion ? REDUCED_MOTION_CLOCK_MS : performance.now();

    ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
    ctx.save();
    const shake = engineState.particleSystem.shakeIntensity;
    if (shake > 0) {
      const dx = (Math.random() - MATH_CONSTANTS.HALF) * 2 * shake;
      const dy = (Math.random() - MATH_CONSTANTS.HALF) * 2 * shake;
      ctx.translate(dx, dy);
    }

    ctx.drawImage(this.staticLayer, 0, 0, width, height);

    this.drawDangerZone(ctx, width, height, theme, engineState.physicsWorld.balls, now, alpha);

    // A new Flux shape slides down into place; only the drawing moves, not the physics.
    const introOffset = this.getStageIntroOffset(engineState);
    if (introOffset > 0) {
      ctx.save();
      ctx.translate(0, -introOffset);
    }
    this.drawObstacles(ctx, engineState.physicsWorld.obstacles, now, alpha);
    this.drawMagneticBonds(ctx, engineState.physicsWorld, theme, now, alpha);

    for (const ball of engineState.physicsWorld.balls) {
      this.drawBall(ctx, ball, now, alpha);
    }
    this.drawChainLinkOverlays(ctx, engineState.physicsWorld, alpha);
    if (introOffset > 0) {
      ctx.restore();
    }

    for (const ball of engineState.physicsWorld.droppingBalls) {
      this.drawBall(ctx, ball, now, alpha);
    }

    if (engineState.aimPoints && !engineState.physicsWorld.projectile && !engineState.isAimCancelled) {
      this.drawAimTrajectory(
        ctx,
        engineState.aimPoints,
        engineState.currentBall,
        engineState.physicsWorld,
        theme,
        now,
        engineState.getBlastRadiusMultiplier(),
        engineState.aimAngle,
        alpha
      );
    }

    this.drawTrail(ctx, engineState.particleSystem);

    if (engineState.physicsWorld.projectile) {
      this.drawBall(ctx, engineState.physicsWorld.projectile, now, alpha);
    }

    this.drawLauncher(ctx, engineState, theme, now);
    this.drawParticles(ctx, engineState.particleSystem, alpha);
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

  isBallInDangerWarning(ball, warningThresholdY, alpha) {
    return !ball.isDropping && this.interpolate(ball.prevY, ball.y, alpha) + ball.radius >= warningThresholdY;
  }

  drawDangerZone(ctx, width, height, theme, balls, now, alpha = 1.0) {
    const margin = this.gameConfig.canvas.wallMargin;
    const dangerY = this.gameConfig.canvas.dangerLineY;
    const warningMargin = this.gameConfig.canvas.dangerWarningMarginY;
    const warningThresholdY = dangerY - warningMargin;

    let isWarning = false;
    for (const b of balls) {
      if (this.isBallInDangerWarning(b, warningThresholdY, alpha)) {
        isWarning = true;
        break;
      }
    }

    const pulse = isWarning
      ? theme.magneticPulseBase + theme.magneticPulseAmp * Math.sin(now * theme.dangerWarningPulseSpeed)
      : 1.0;

    ctx.fillStyle = isWarning ? theme.dangerZoneWarningFill : theme.dangerZoneFill;
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
      ctx.strokeStyle = theme.dangerBallRingColor;
      ctx.lineWidth = theme.aimTargetMatchLineWidth;
      for (const b of balls) {
        if (!this.isBallInDangerWarning(b, warningThresholdY, alpha)) {
          continue;
        }
        const bx = this.interpolate(b.prevX, b.x, alpha);
        const by = this.interpolate(b.prevY, b.y, alpha);
        ctx.beginPath();
        ctx.arc(bx, by, b.radius + theme.aimTargetRingPadding, 0, MATH_CONSTANTS.TWO_PI);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawWalls(ctx, width, height, theme) {
    const margin = this.gameConfig.canvas.wallMargin;
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
    const segments = this.bondSegments;
    for (const list of segments) {
      list.length = 0;
    }
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
        let style = BOND_STYLE.LINK;
        if (isChainLink(a, b)) {
          style = BOND_STYLE.CHAIN;
        } else if (isStressed) {
          style = BOND_STYLE.STRESSED;
        } else if (sameColor) {
          style = BOND_STYLE.SAME_COLOR;
        } else if (samePolarityRepel) {
          style = BOND_STYLE.REPEL;
        }
        segments[style].push(ax, ay, bx, by);
      }
    }

    if (segments[BOND_STYLE.STRESSED].length > 0) {
      this.strokeSegments(ctx, segments[BOND_STYLE.STRESSED], theme.magneticStressColor);
    }
    if (segments[BOND_STYLE.SAME_COLOR].length > 0) {
      this.strokeSegments(
        ctx,
        segments[BOND_STYLE.SAME_COLOR],
        `rgba(${theme.magneticSameColorBase}, ${theme.magneticBondSameColorAlpha * pulse})`
      );
    }
    if (segments[BOND_STYLE.REPEL].length > 0) {
      this.strokeSegments(
        ctx,
        segments[BOND_STYLE.REPEL],
        `rgba(${theme.magneticRepelColorBase}, ${theme.magneticFieldAlpha * pulse})`
      );
    }
    if (segments[BOND_STYLE.LINK].length > 0) {
      this.strokeSegments(ctx, segments[BOND_STYLE.LINK], theme.magneticLinkColor);
    }
    if (segments[BOND_STYLE.CHAIN].length > 0) {
      const chainSpec = this.ballsConfig.clusterModifiers.chained;
      ctx.lineWidth = chainSpec.linkWidth;
      ctx.setLineDash(chainSpec.linkDash);
      this.strokeSegments(ctx, segments[BOND_STYLE.CHAIN], chainSpec.linkColor);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  strokeSegments(ctx, coords, strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.beginPath();
    for (let i = 0; i < coords.length; i += SEGMENT_STRIDE) {
      ctx.moveTo(coords[i], coords[i + 1]);
      ctx.lineTo(coords[i + 2], coords[i + 3]);
    }
    ctx.stroke();
  }

  /**
   * Rebuilds the portal link map only when the obstacle list changes, so per-frame
   * drawing needs neither a Set nor a linear mate search.
   */
  refreshPortalLinks(obstacles) {
    const source = this.portalLinkSource;
    let changed = source.length !== obstacles.length;
    for (let i = 0; !changed && i < obstacles.length; i++) {
      changed = source[i] !== obstacles[i];
    }
    if (!changed) {
      return;
    }
    source.length = 0;
    this.portalLinks.clear();
    const firstByPair = new Map();
    for (const obs of obstacles) {
      source.push(obs);
      if (obs.type !== OBSTACLE_TYPES.PORTAL || !obs.pairId) {
        continue;
      }
      const lead = firstByPair.get(obs.pairId);
      if (lead) {
        if (!this.portalLinks.has(lead)) {
          this.portalLinks.set(lead, obs);
        }
      } else {
        firstByPair.set(obs.pairId, obs);
      }
    }
  }

  drawObstacles(ctx, obstacles, now, alpha = 1.0) {
    const typesCfg = this.obstaclesConfig.types;
    const obsDefaults = this.obstaclesConfig.defaults;
    this.refreshPortalLinks(obstacles);

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
        const mate = this.portalLinks.get(obs);
        if (mate) {
          ctx.save();
          ctx.strokeStyle = cfg.fieldColor;
          ctx.lineWidth = obsDefaults.lineWidth;
          ctx.setLineDash(cfg.linkDash);
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(this.interpolate(mate.prevX, mate.x, alpha), this.interpolate(mate.prevY, mate.y, alpha));
          ctx.stroke();
          ctx.restore();
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
    if (!ball.colorId) {
      return this.ballsConfig.neutralPalette;
    }
    return this.colorMap.get(ball.colorId) || this.ballsConfig.standardColors[0];
  }

  drawBall(ctx, ball, now, alpha = 1.0) {
    this.drawBallAt(
      ctx,
      ball,
      this.interpolate(ball.prevX, ball.x, alpha),
      this.interpolate(ball.prevY, ball.y, alpha),
      now
    );
  }

  drawBallAt(ctx, ball, bxPos, byPos, now) {
    const palette = this.getBallPalette(ball);
    const r = ball.radius;
    const theme = this.gameConfig.theme;
    const renderCfg = this.ballsConfig.render;

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
      const label = this.getLabelFont(r);
      ctx.font = label.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // An enlarged glyph covers the shine and gradient, so it gets the outline too.
      if (this.highContrast || label.isEnlarged) {
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
      ctx.font = this.getBadgeFont(r);
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

    if (ball.clusterModifier === CLUSTER_MODIFIERS.BUBBLE) {
      this.drawBubbleShell(ctx, r);
    }

    ctx.restore();
  }

  /**
   * Chain links sit where touching spheres hide their bonds, so each chain link also gets a
   * small metal link drawn on top, at the contact point between the two spheres.
   */
  drawChainLinkOverlays(ctx, physicsWorld, alpha) {
    const chainSpec = this.ballsConfig.clusterModifiers.chained;
    ctx.save();
    ctx.lineCap = 'round';
    for (const a of physicsWorld.balls) {
      for (const neighborId of a.bonds) {
        const b = physicsWorld.ballMap.get(neighborId);
        if (!b || neighborId < a.id || !isChainLink(a, b)) {
          continue;
        }
        const ax = this.interpolate(a.prevX, a.x, alpha);
        const ay = this.interpolate(a.prevY, a.y, alpha);
        const bx = this.interpolate(b.prevX, b.x, alpha);
        const by = this.interpolate(b.prevY, b.y, alpha);
        const angle = Math.atan2(by - ay, bx - ax);
        const mx = (ax + bx) * MATH_CONSTANTS.HALF;
        const my = (ay + by) * MATH_CONSTANTS.HALF;
        for (const [color, width] of [[chainSpec.overlayShadowColor, chainSpec.overlayShadowWidth], [chainSpec.linkColor, chainSpec.overlayLineWidth]]) {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.ellipse(mx, my, chainSpec.overlayLinkLength * MATH_CONSTANTS.HALF, chainSpec.overlayLinkWidth * MATH_CONSTANTS.HALF, angle, 0, MATH_CONSTANTS.TWO_PI);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  /** Translucent shell around a bubbled ball: its color stays visible but it cannot match yet. */
  drawBubbleShell(ctx, r) {
    const bubbleSpec = this.ballsConfig.clusterModifiers.bubble;
    const shellRadius = r * bubbleSpec.shellRadiusFactor;
    ctx.globalAlpha = 1;
    ctx.fillStyle = bubbleSpec.shellColor;
    ctx.strokeStyle = bubbleSpec.ringColor;
    ctx.lineWidth = bubbleSpec.shellLineWidth;
    ctx.beginPath();
    ctx.arc(0, 0, shellRadius, 0, MATH_CONSTANTS.TWO_PI);
    ctx.fill();
    ctx.stroke();
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

  /**
   * Returns true when the cached aim preview was built for exactly this aim, launcher
   * ball and board signature, and refreshes the cache key otherwise.
   */
  isAimPreviewFresh(points, currentBall, physicsWorld, endX, endY, blastMult, aimAngle) {
    const cache = this.aimPreview;
    const cell = this.gameConfig.canvas.aimPreviewCacheCellPx;
    const cellX = Math.round(endX / cell);
    const cellY = Math.round(endY / cell);
    const snapTargetId = points.snapTarget ? points.snapTarget.id : 0;

    let boardCount = 0;
    let boardIdSum = 0;
    let boardBondTotal = 0;
    let boardArmorTotal = 0;
    let boardColorSum = 0;
    for (const b of physicsWorld.balls) {
      boardCount++;
      boardIdSum += b.id;
      boardBondTotal += b.bonds.size;
      boardArmorTotal += b.armorHits;
      if (b.colorId) {
        boardColorSum += b.id * this.colorWeights.get(b.colorId);
      }
    }

    const fresh =
      cache.valid &&
      cache.aimAngle === aimAngle &&
      cache.cellX === cellX &&
      cache.cellY === cellY &&
      cache.ballId === currentBall.id &&
      cache.specialType === currentBall.specialType &&
      cache.colorId === currentBall.colorId &&
      cache.snapTargetId === snapTargetId &&
      cache.blastMult === blastMult &&
      cache.boardCount === boardCount &&
      cache.boardIdSum === boardIdSum &&
      cache.boardBondTotal === boardBondTotal &&
      cache.boardArmorTotal === boardArmorTotal &&
      cache.boardColorSum === boardColorSum;

    if (!fresh) {
      cache.valid = true;
      cache.aimAngle = aimAngle;
      cache.cellX = cellX;
      cache.cellY = cellY;
      cache.ballId = currentBall.id;
      cache.specialType = currentBall.specialType;
      cache.colorId = currentBall.colorId;
      cache.snapTargetId = snapTargetId;
      cache.blastMult = blastMult;
      cache.boardCount = boardCount;
      cache.boardIdSum = boardIdSum;
      cache.boardBondTotal = boardBondTotal;
      cache.boardArmorTotal = boardArmorTotal;
      cache.boardColorSum = boardColorSum;
    }
    return fresh;
  }

  /**
   * Computes the balls highlighted, destroyed and detached by the current aim. Runs the
   * cluster BFS and detachment search only when the aim target or the board changed.
   */
  computeAimPreview(points, currentBall, physicsWorld, endX, endY, blastMult) {
    const cache = this.aimPreview;
    const highlight = cache.highlightBalls;
    const destroyedIds = cache.destroyedIds;
    highlight.length = 0;
    destroyedIds.clear();
    cache.highlightIsMatch = false;
    cache.avalancheBalls = [];
    this.aimPreviewComputeCount++;

    if (currentBall.specialType) {
      const specType = currentBall.specialType;
      const specCfg = this.ballsConfig.specialTypes[specType];
      if (specType === SPECIAL_TYPES.BOMB || specType === SPECIAL_TYPES.FREEZE) {
        const radiusFactor = specType === SPECIAL_TYPES.BOMB
          ? specCfg.blastRadiusFactor
          : specCfg.freezeRadiusFactor;
        const aoeRadius = currentBall.radius * radiusFactor * blastMult;
        for (const b of physicsWorld.balls) {
          if (Math.hypot(b.x - endX, b.y - endY) <= aoeRadius) {
            highlight.push(b);
            if (specType === SPECIAL_TYPES.BOMB) {
              destroyedIds.add(b.id);
            }
          }
        }
      } else if (specType === SPECIAL_TYPES.LIGHTNING) {
        const bandHalf = currentBall.radius * specCfg.bandHalfHeightFactor * blastMult;
        for (const b of physicsWorld.balls) {
          if (Math.abs(b.y - endY) <= bandHalf) {
            highlight.push(b);
            destroyedIds.add(b.id);
          }
        }
      } else if (specType === SPECIAL_TYPES.RAINBOW) {
        const neighborRadius = currentBall.radius * specCfg.neighborRadiusFactor;
        const seen = new Set();
        for (const other of physicsWorld.balls) {
          if (seen.has(other.id) || !other.colorId || Math.hypot(other.x - endX, other.y - endY) > neighborRadius) {
            continue;
          }
          for (const member of physicsWorld.findColorCluster(other)) {
            if (!seen.has(member.id)) {
              seen.add(member.id);
              highlight.push(member);
              if (member.armorHits <= 1) {
                destroyedIds.add(member.id);
              }
            }
          }
        }
      } else if (specType === SPECIAL_TYPES.ANVIL) {
        const pierceRadius = currentBall.radius * specCfg.pierceRadiusFactor;
        const pierceRadiusSq = pierceRadius * pierceRadius;
        for (const b of physicsWorld.balls) {
          for (const pt of points) {
            const dx = b.x - pt.x;
            const dy = b.y - pt.y;
            if (dx * dx + dy * dy <= pierceRadiusSq) {
              highlight.push(b);
              destroyedIds.add(b.id);
              break;
            }
          }
        }
      }
      cache.highlightIsMatch = true;
    } else if (points.snapTarget) {
      const target = points.snapTarget;
      const isMatchingColor = currentBall.colorId && currentBall.colorId === target.colorId;
      if (isMatchingColor) {
        for (const member of physicsWorld.findColorCluster(target)) {
          highlight.push(member);
        }
      } else {
        highlight.push(target);
      }
      const willMatch = isMatchingColor && highlight.length + 1 >= this.gameConfig.defaults.matchMinCount;
      cache.highlightIsMatch = Boolean(willMatch);
      if (willMatch) {
        for (const member of highlight) {
          if (member.armorHits <= 1) {
            destroyedIds.add(member.id);
          }
        }
      }
    }

    if (destroyedIds.size > 0) {
      cache.avalancheBalls = physicsWorld.findDetachedIfRemoved(destroyedIds);
    }
  }

  strokeBallRings(ctx, balls, padding, alpha) {
    for (const b of balls) {
      ctx.beginPath();
      ctx.arc(
        this.interpolate(b.prevX, b.x, alpha),
        this.interpolate(b.prevY, b.y, alpha),
        b.radius + padding,
        0,
        MATH_CONSTANTS.TWO_PI
      );
      ctx.stroke();
    }
  }

  drawAimTrajectory(ctx, points, currentBall, physicsWorld, theme, now, blastRadiusMultiplier, aimAngle, alpha = 1.0) {
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
    if (!physicsWorld) {
      ctx.restore();
      return;
    }
    if (!this.isAimPreviewFresh(points, currentBall, physicsWorld, endX, endY, blastRadiusMultiplier, aimAngle)) {
      this.computeAimPreview(points, currentBall, physicsWorld, endX, endY, blastRadiusMultiplier);
    }
    const preview = this.aimPreview;

    if (currentBall.specialType) {
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
      }
    }

    if (preview.highlightBalls.length > 0) {
      ctx.strokeStyle = preview.highlightIsMatch ? theme.targetHighlightColor : palette.highlight;
      ctx.lineWidth = preview.highlightIsMatch ? theme.aimTargetMatchLineWidth : theme.aimTargetNormalLineWidth;
      ctx.globalAlpha = pulse;
      this.strokeBallRings(ctx, preview.highlightBalls, theme.aimTargetRingPadding, alpha);
    }

    if (preview.avalancheBalls.length > 0) {
      ctx.save();
      ctx.strokeStyle = theme.avalancheDropHighlightColor;
      ctx.lineWidth = theme.aimTargetNormalLineWidth;
      ctx.setLineDash(theme.specialAoeDash);
      ctx.globalAlpha = pulse;
      this.strokeBallRings(
        ctx,
        preview.avalancheBalls,
        theme.aimTargetRingPadding + theme.avalancheRingPaddingExtra,
        alpha
      );
      ctx.restore();
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
      this.drawBallAt(ctx, engineState.currentBall, lx, ly, now);
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

      this.drawBallAt(ctx, engineState.nextBall, nx, ny, now);
    }
  }

  drawParticles(ctx, particleSystem, alpha = 1.0) {
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
      ctx.arc(
        this.interpolate(p.prevX, p.x, alpha),
        this.interpolate(p.prevY, p.y, alpha),
        p.radius,
        0,
        MATH_CONSTANTS.TWO_PI
      );
      ctx.fill();
    }

    const shadowColor = theme.floatingTextShadowColor;
    const shadowOffset = pCfg.floatingTextShadowOffset;
    ctx.font = this.floatingTextFont;
    ctx.textAlign = 'center';
    for (const ft of particleSystem.floatingTexts) {
      const fy = this.interpolate(ft.prevY, ft.y, alpha);
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.fillStyle = shadowColor;
      ctx.fillText(ft.text, ft.x + shadowOffset, fy + shadowOffset);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, fy);
    }

    ctx.restore();
  }
}

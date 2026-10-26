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

import { configRegistry } from './core/ConfigRegistry.js';
import { i18n, t } from './core/I18n.js';
import { StorageManager } from './core/StorageManager.js';
import { AudioManager } from './core/AudioManager.js';
import { Renderer } from './game/Renderer.js';
import { GameEngine } from './game/GameEngine.js';
import { UIManager } from './ui/UIManager.js';

class Application {
  async bootstrap() {
    try {
      await configRegistry.loadAll();

      const gameConfig = configRegistry.get('game');
      const physicsConfig = configRegistry.get('physics');
      const ballsConfig = configRegistry.get('balls');
      const obstaclesConfig = configRegistry.get('obstacles');
      const levelsConfig = configRegistry.get('levels');

      const storageManager = new StorageManager();
      storageManager.init();

      const initialLang = storageManager.getLanguage();
      await i18n.init(initialLang);

      const audioManager = new AudioManager();
      audioManager.init(storageManager.getMuted(), storageManager.getReducedMotion());

      const canvas = document.getElementById('game-canvas');
      const renderer = new Renderer(canvas, gameConfig, ballsConfig, obstaclesConfig);
      renderer.setHighContrast(storageManager.getHighContrast());

      let uiManager = null;
      const engine = new GameEngine({
        gameConfig,
        physicsConfig,
        ballsConfig,
        obstaclesConfig,
        levelsConfig,
        audioManager,
        storageManager,
        onStateChange: (eng, extra) => {
          if (uiManager) {
            uiManager.refresh(eng, extra);
          }
        }
      });

      uiManager = new UIManager({
        engine,
        renderer,
        storageManager,
        audioManager,
        gameConfig,
        levelsConfig,
        ballsConfig
      });
      uiManager.init();

      this.bindCanvasInput(canvas, engine, gameConfig, uiManager);

      const startLevel = storageManager.getUnlockedLevel();
      engine.startCampaignLevel(startLevel);

      const fixedStepMs = physicsConfig.simulation.fixedStepMs;
      const maxAccumulatedMs = physicsConfig.simulation.maxAccumulatedMs;
      let lastTime = performance.now();
      let accumulator = 0;

      const loop = (now) => {
        const elapsed = Math.min(maxAccumulatedMs, Math.max(0, now - lastTime));
        lastTime = now;
        accumulator += elapsed;

        while (accumulator >= fixedStepMs) {
          engine.update();
          accumulator -= fixedStepMs;
        }

        const alpha = fixedStepMs > 0 ? accumulator / fixedStepMs : 1.0;
        renderer.render(engine, alpha);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      this.registerServiceWorker();
    } catch (err) {
      console.error('Initialization failed:', err);
      this.renderBootstrapError();
    }
  }

  renderBootstrapError() {
    if (typeof document === 'undefined') {
      return;
    }
    const banner = document.createElement('div');
    banner.setAttribute('role', 'alert');
    banner.style.cssText =
      'position:fixed;inset:16px;z-index:100;margin:auto;max-width:480px;max-height:200px;' +
      'background:#111827;color:#f8fafc;border:2px solid #ef4444;border-radius:12px;padding:20px;' +
      'display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:10px;';
    const title = document.createElement('strong');
    title.textContent = 'Erreur de chargement / Loading Error';
    const msg = document.createElement('p');
    msg.textContent =
      'Impossible de charger les fichiers de configuration. Veuillez rafraîchir la page. / ' +
      'Failed to load configuration files. Please refresh the page.';
    banner.append(title, msg);
    document.body.appendChild(banner);
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Ignore service worker registration errors in local dev
      });
    }
  }

  bindCanvasInput(canvas, engine, gameConfig, uiManager) {
    const toLogicalCoords = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = gameConfig.canvas.logicalWidth / rect.width;
      const scaleY = gameConfig.canvas.logicalHeight / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    };

    const getAimAdjustedCoords = (e, pos) => {
      if (e.pointerType === 'touch') {
        const canvasCfg = gameConfig.canvas;
        const cancelThresholdY = canvasCfg.launcherY + canvasCfg.cancelAimOffsetY;
        if (pos.y > cancelThresholdY) {
          return pos;
        }
        const shiftedY = pos.y + canvasCfg.touchAimVerticalOffset;
        const maxAnchorY = canvasCfg.launcherY + canvasCfg.touchMinAimAnchorOffsetY;
        return {
          x: pos.x,
          y: Math.min(shiftedY, maxAnchorY)
        };
      }
      return pos;
    };

    const isSwapClick = (x, y) => {
      const canvasCfg = gameConfig.canvas;
      const nx = canvasCfg.launcherX + canvasCfg.nextBallOffsetX;
      const ny = canvasCfg.launcherY + canvasCfg.nextBallOffsetY;
      return Math.hypot(x - nx, y - ny) <= canvasCfg.swapClickRadius;
    };

    const isLauncherBaseTap = (x, y, startPos) => {
      const canvasCfg = gameConfig.canvas;
      const distToLauncher = Math.hypot(x - canvasCfg.launcherX, y - canvasCfg.launcherY);
      if (distToLauncher > canvasCfg.launcherTapSwapRadius) {
        return false;
      }
      if (!startPos) {
        return true;
      }
      return Math.hypot(x - startPos.x, y - startPos.y) <= canvasCfg.tapMaxMoveDistance;
    };

    let isPointerDownOnCanvas = false;
    let pointerDownPos = null;

    canvas.addEventListener('pointermove', (e) => {
      if (uiManager && uiManager.isAnyModalOpen()) {
        return;
      }
      const rawPos = toLogicalCoords(e.clientX, e.clientY);
      const aimPos = getAimAdjustedCoords(e, rawPos);
      engine.updateAim(aimPos.x, aimPos.y);
      if (uiManager) {
        uiManager.updateAimState(engine);
      }
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) {
        return;
      }
      if (uiManager && uiManager.isAnyModalOpen()) {
        return;
      }
      isPointerDownOnCanvas = true;
      if (typeof canvas.setPointerCapture === 'function') {
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          // Ignore pointer capture errors
        }
      }
      const rawPos = toLogicalCoords(e.clientX, e.clientY);
      pointerDownPos = { x: rawPos.x, y: rawPos.y };
      if (isSwapClick(rawPos.x, rawPos.y) || isLauncherBaseTap(rawPos.x, rawPos.y, null)) {
        return;
      }
      const aimPos = getAimAdjustedCoords(e, rawPos);
      engine.updateAim(aimPos.x, aimPos.y);
      if (uiManager) {
        uiManager.updateAimState(engine);
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (e.button !== undefined && e.button !== 0) {
        return;
      }
      if (!isPointerDownOnCanvas) {
        return;
      }
      isPointerDownOnCanvas = false;
      if (typeof canvas.releasePointerCapture === 'function') {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore pointer capture errors
        }
      }
      const startPos = pointerDownPos;
      pointerDownPos = null;
      if (uiManager && uiManager.isAnyModalOpen()) {
        return;
      }
      const rawPos = toLogicalCoords(e.clientX, e.clientY);
      if (isSwapClick(rawPos.x, rawPos.y) || isLauncherBaseTap(rawPos.x, rawPos.y, startPos)) {
        engine.isAimCancelled = false;
        engine.swapLauncherBalls();
        if (uiManager) {
          uiManager.updateAimState(engine);
        }
        return;
      }
      const aimPos = getAimAdjustedCoords(e, rawPos);
      engine.updateAim(aimPos.x, aimPos.y);
      engine.shoot();
      if (uiManager) {
        uiManager.updateAimState(engine);
      }
    });

    canvas.addEventListener('pointercancel', (e) => {
      isPointerDownOnCanvas = false;
      pointerDownPos = null;
      if (typeof canvas.releasePointerCapture === 'function' && e?.pointerId !== undefined) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore pointer capture errors
        }
      }
      engine.isAimCancelled = false;
      if (uiManager) {
        uiManager.updateAimState(engine);
      }
    });
  }
}

const app = new Application();
app.bootstrap();

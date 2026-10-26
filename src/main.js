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
      audioManager.init(storageManager.getMuted());

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
      console.error(t('errors.config.loadFailed'), err);
    }
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
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    };

    const isSwapClick = (x, y) => {
      const canvasCfg = gameConfig.canvas;
      const nx = canvasCfg.launcherX + canvasCfg.nextBallOffsetX;
      const ny = canvasCfg.launcherY + canvasCfg.nextBallOffsetY;
      return Math.hypot(x - nx, y - ny) <= canvasCfg.swapClickRadius;
    };

    canvas.addEventListener('pointermove', (e) => {
      if (uiManager && uiManager.isAnyModalOpen()) {
        return;
      }
      const pos = toLogicalCoords(e.clientX, e.clientY);
      engine.updateAim(pos.x, pos.y);
      if (uiManager) {
        uiManager.updateAimState(engine);
      }
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (uiManager && uiManager.isAnyModalOpen()) {
        return;
      }
      const pos = toLogicalCoords(e.clientX, e.clientY);
      engine.updateAim(pos.x, pos.y);
      if (uiManager) {
        uiManager.updateAimState(engine);
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (uiManager && uiManager.isAnyModalOpen()) {
        return;
      }
      const pos = toLogicalCoords(e.clientX, e.clientY);
      if (isSwapClick(pos.x, pos.y)) {
        engine.isAimCancelled = false;
        engine.swapLauncherBalls();
        if (uiManager) {
          uiManager.updateAimState(engine);
        }
        return;
      }
      engine.updateAim(pos.x, pos.y);
      engine.shoot();
      if (uiManager) {
        uiManager.updateAimState(engine);
      }
    });

    canvas.addEventListener('pointercancel', () => {
      engine.isAimCancelled = false;
      if (uiManager) {
        uiManager.updateAimState(engine);
      }
    });
  }
}

const app = new Application();
app.bootstrap();

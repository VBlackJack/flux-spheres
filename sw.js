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

const APP_VERSION = '1.6.0';
const CACHE_NAME = `flux-spheres-cache-v${APP_VERSION}`;

// The service worker cannot read configs/*.json before it has a cache, so its
// tuning lives here as named constants.
const NETWORK_TIMEOUT_MS = 4000;
const NAVIGATION_FALLBACK_URL = './index.html';
const CACHE_MATCH_OPTIONS = Object.freeze({ ignoreSearch: true });
const HTTP_STATUS_OK = 200;
// The host lets browsers reuse files for minutes without asking (GitHub Pages sends
// max-age=600). Right after a deploy that mixes a new page with old scripts, styles and
// texts, so every network request revalidates, and the install skips the HTTP cache.
const NETWORK_FETCH_OPTIONS = Object.freeze({ cache: 'no-cache' });
const PRECACHE_FETCH_OPTIONS = Object.freeze({ cache: 'reload' });

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './styles/main.css',
  './src/main.js',
  './src/core/AudioManager.js',
  './src/core/ConfigRegistry.js',
  './src/core/Constants.js',
  './src/core/I18n.js',
  './src/core/SeededRandom.js',
  './src/core/StorageManager.js',
  './src/core/WorldGeometry.js',
  './src/entities/Ball.js',
  './src/entities/Obstacle.js',
  './src/entities/ParticleSystem.js',
  './src/game/DailyShare.js',
  './src/game/GameEngine.js',
  './src/game/GameLoop.js',
  './src/game/ImpactPreview.js',
  './src/game/Renderer.js',
  './src/game/RunSnapshot.js',
  './src/game/Discovery.js',
  './src/game/LevelCatalog.js',
  './src/game/SpecialBallController.js',
  './src/game/layouts/FluxStageGenerator.js',
  './src/game/layouts/LayoutGenerators.js',
  './src/game/layouts/ShapeGenerator.js',
  './src/physics/PhysicsWorld.js',
  './src/physics/SpatialHashGrid.js',
  './src/ui/UIManager.js',
  './configs/audio.json',
  './configs/balls.json',
  './configs/campaign.json',
  './configs/campaignTuning.json',
  './configs/flux.json',
  './configs/game.json',
  './configs/levels.json',
  './configs/obstacles.json',
  './configs/physics.json',
  './locales/en.json',
  './locales/fr.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS.map((url) => new Request(url, PRECACHE_FETCH_OPTIONS))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

async function matchCached(request) {
  const cached = await caches.match(request, CACHE_MATCH_OPTIONS);
  if (cached) {
    return cached;
  }
  if (request.mode === 'navigate') {
    return caches.match(NAVIGATION_FALLBACK_URL, CACHE_MATCH_OPTIONS);
  }
  return undefined;
}

/**
 * Network first, but a slow network does not hold the page hostage: after
 * NETWORK_TIMEOUT_MS the cached copy is served if there is one.
 */
async function respondNetworkFirst(request, networkFetch) {
  let timeoutId = null;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([networkFetch, timeout]);
    if (response) {
      return response;
    }
  } catch {
    // Offline or network error: fall through to the cache.
  } finally {
    clearTimeout(timeoutId);
  }
  const cached = await matchCached(request);
  if (cached) {
    return cached;
  }
  try {
    return await networkFetch;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }
  const networkFetch = fetch(request, NETWORK_FETCH_OPTIONS);
  // Clone synchronously, before the page can start reading the body, and keep
  // the worker alive until the cache write has finished.
  const cacheUpdate = networkFetch
    .then((response) => {
      if (!response || response.status !== HTTP_STATUS_OK) {
        return undefined;
      }
      const copy = response.clone();
      return caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    })
    .catch(() => undefined);
  event.waitUntil(cacheUpdate);
  event.respondWith(respondNetworkFirst(request, networkFetch));
});

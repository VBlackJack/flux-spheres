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

const APP_VERSION = '1.2.0';
const CACHE_NAME = `flux-spheres-cache-v${APP_VERSION}`;

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/main.css',
  './src/main.js',
  './src/core/AudioManager.js',
  './src/core/ConfigRegistry.js',
  './src/core/Constants.js',
  './src/core/I18n.js',
  './src/core/SeededRandom.js',
  './src/core/StorageManager.js',
  './src/entities/Ball.js',
  './src/entities/Obstacle.js',
  './src/entities/ParticleSystem.js',
  './src/game/GameEngine.js',
  './src/game/Renderer.js',
  './src/game/SpecialBallController.js',
  './src/physics/PhysicsWorld.js',
  './src/physics/SpatialHashGrid.js',
  './src/ui/UIManager.js',
  './configs/audio.json',
  './configs/balls.json',
  './configs/game.json',
  './configs/levels.json',
  './configs/obstacles.json',
  './configs/physics.json',
  './locales/en.json',
  './locales/fr.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

# Changelog

All notable changes to **FluxSpheres** are documented in this file.

## [1.2.0] - 2026-10-26

### Added
- **Daily Challenge Rotor & Turbo Rotors Mutator**: Added a central inertia rotor with anchored ring spheres to Daily Challenge runs and wired `rotorSpeedMultiplier` into pivot motor speed and torque physics.
- **HiDPI / Retina Canvas Rendering**: Automatic `devicePixelRatio` scaling (up to 3x) for crisp rendering on mobile and high-density screens.
- **Modal Accessibility & Focus Management**: Full focus trapping (`Tab` / `Shift+Tab`), background `.app-shell` `inert` state when modals are open, automatic pause when opening Shop or Level Select overlays, and focus restoration on close.
- **Tactical Aiming & Predictive Previews**: Real-time area-of-effect (AOE) preview for Special Balls, live Magnetic Avalanche drop prediction (`findDetachedIfRemoved`), and pulsing proximity warnings near the critical danger line.
- **Magnetic Workshop Extensions**: Special Ammo in-run refill cards and an illustrated **Codex & Guide** tab with keyboard arrow navigation (`role="tab"` / `role="tabpanel"`).
- **CI Workflow & Project Documentation**: Added GitHub Actions automated test workflow (`.github/workflows/ci.yml`), `LICENSE` (Apache 2.0), `CHANGELOG.md`, and architecture overview in `README.md`.

### Changed
- **Service Worker Caching Strategy**: Switched `sw.js` to a network-first strategy with versioned offline cache fallback (`flux-spheres-cache-v1.2.0`) to prevent stale or mismatched ES module loads after deployments.
- **Collision-Free Spatial Hash Grid**: Replaced XOR prime hashing in `SpatialHashGrid` with an injective 2D integer pairing function so negative and positive cell coordinates never collide.
- **In-Memory Upgrade Level Cache**: Cached parsed upgrade levels in `StorageManager` to eliminate `localStorage` + `JSON.parse` calls inside the 60 Hz physics and render loops.
- **Date-Scoped Daily High Score**: Scoped `daily_best` to the active daily seed date key so each Daily Challenge tracks its own daily record.

### Fixed
- **Keyboard Navigation on HUD Buttons**: Ignored global `Enter` / `Space` shot and swap shortcuts when an interactive button or tab holds focus.
- **Campaign Completion Level Cap**: Capped `unlockLevel` at the final campaign level (`16`) so reloading after completing the campaign starts on Level 16 instead of falling back to Level 1.
- **Pointer Input Guards**: Restricted canvas firing to primary mouse/touch button (`e.button === 0`) after a valid `pointerdown` originating on the canvas.
- **Resilient Bootstrap Error Banner**: Added a bilingual DOM fallback alert if configuration files fail to load before `i18n` initialization.

## [1.0.0] - 2026-10-26

### Added
- Initial release of **FluxSpheres — Magnetic Physics Edition** with 16 Campaign levels, Survival mode, Daily Challenge, 5 Special Balls, 6 Cluster Modifiers, 7 Obstacle types, Web Audio synth effects, and FR/EN localization.

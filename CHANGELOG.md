# Changelog

All notable changes to **FluxSpheres** are documented in this file.

## [Unreleased]

### Fixed
- **Round End Idempotence**: A victory can no longer be paid twice in one frame, a lost level can no longer turn into a victory, and the score is frozen once a run ends.
- **Storage Resilience**: A failed `localStorage` write no longer resurrects the previous coin balance, and stored values of the wrong shape no longer crash the game.
- **Economy Guards**: Special Ammo can only be bought during an active run; special shots and all-armored matches that destroy nothing no longer count as matches.
- **Daily Challenge Determinism**: Avalanche drift uses the daily seed, and restarting a Daily Challenge keeps its seed without paying the first-play bonus again.
- **Projectile Physics**: Projectile speed is capped, fast shots no longer pass through barriers, portal loops terminate, and snapping picks the nearest sphere.
- **Rotor Torque**: Rotors are only turned by spheres actually bonded to them.
- **Game Loop**: A runtime error now stops the loop cleanly and shows the error banner instead of freezing silently; spheres no longer jitter during hit-stop or pause.
- **Layout**: Zero-scroll layout on desktop, phones and landscape phones; modals fit the viewport and keep their Close button reachable.
- **Accessibility**: Stable labels with `aria-pressed` on toggles, accessible names for power-ups and level stars, focus trap fixes, polite announcements for achievements and round results, reduced-motion support in CSS, 44 px touch targets and WCAG AA button contrast.
- **Keyboard**: Holding Space, F, Enter or a digit key no longer repeats the action.
- **Offline Mode**: Service Worker cache writes complete reliably, navigations fall back to the cached page, and slow networks fall back to the cache after a timeout.

### Changed
- **First Visit Language**: The interface language follows the browser language until the player picks one.
- **Installable PWA**: New sphere icon with 192 px, 512 px and maskable variants.
- **Performance**: Aim preview, avalanche prediction and cluster searches are cached; the spatial grid is rebuilt once per substep; the static background is pre-rendered; the canvas backing store follows its displayed size.
- **Audio**: Simultaneous voices are capped, effects are throttled behind a limiter, and the audio context is suspended while hidden or muted.
- **High Scores**: Written when a run ends or the page is left instead of on every scoring event.
- **Tooling**: CI runs on Node.js 24 with every test suite, plus guards for typography and offline asset coverage; French README added.

## [1.2.5] - 2026-10-26

### Fixed
- **Rotor Layout Stability**: Spiral and Cross rotor levels no longer collapse on their own before the first shot.
- **Tension Breaks**: Clusters detached by an over-stretched bond now fall as a scored Magnetic Avalanche.

## [1.2.4] - 2026-10-26

### Added
- **Mobile Zero-Scroll Layout**: `100dvh` layout for phones, thumb aiming capture, haptic feedback, and ceiling bounce for projectiles.

## [1.2.3] - 2026-10-26

### Changed
- **Obstacle Deflection**: Stronger repulsor and attractor deflection, and a curved projectile path around singularities.

## [1.2.2] - 2026-10-26

### Changed
- **Renderer Configuration**: Removed the remaining literal fallbacks in the renderer and tuned the Daily Challenge rotor clearance.

## [1.2.1] - 2026-10-26

### Fixed
- **Daily Rotor Placement**: The Daily Challenge rotor now sits below the initial rows; refined `:focus-visible` handling and removed configuration fallbacks.

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
- Initial release of **FluxSpheres: Magnetic Physics Edition** with 16 Campaign levels, Survival mode, Daily Challenge, 5 Special Balls, 6 Cluster Modifiers, 7 Obstacle types, Web Audio synth effects, and FR/EN localization.

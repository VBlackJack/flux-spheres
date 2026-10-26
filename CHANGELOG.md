# Changelog

All notable changes to **FluxSpheres** are documented in this file.

## [Unreleased]

### Added
- **Flux Mode**: A new endless mode that chains procedurally generated shapes under one shot reserve. Each stage picks a parametric shape (pendulum, ring, hexagon, spiral, cross, twin rings), a hanging silhouette from a character mask (heart, diamond, crown, arrow, donut, invader, hourglass) or a pair of small shapes, never repeating the previous family. A per-stage budget buys bumpers, portals, repulsors, attractors and singularities that fit around the shape; palette size and cluster modifiers follow stage tables; every fifth stage has a Boss Core. Clearing a shape pays points and coins and refills shots, and the next shape slides in. Runs are seeded and resume on the same shape after a reload; the best score and the furthest stage are kept separately. Tuning lives in `configs/flux.json`.
- **Layout Registry**: Campaign layouts are now pure geometry generators in `src/game/layouts/LayoutGenerators.js`, shared by the campaign and Flux Mode; all 16 levels produce the same positions, anchors and bonds as before.
- **Slow Motion**: Time slows down while a shot flies close to one of the last three spheres of a level or Flux shape (`juice.slowMotion` in `configs/game.json`); reduced motion keeps normal speed.
- **Victory Reveal**: The victory score rolls up from zero and the earned stars pop in one after another (`victory.countUpMs` and `victory.starRevealStepMs`); reduced motion shows the final values at once.
- **Full-Width Board on Phones**: In portrait, the board spans the screen width under a one-line HUD (menu, score, shots), with a single control row for Swap, Polarity and the five special balls. Navigation, settings, coins, record and overcharge move to a slide-in menu that pauses the run while open. On a 412 px wide phone the board grows from about 300 to 412 px wide.
- **Run Resume**: The run in progress is saved after every shot and when the page is hidden, and resumes paused after a reload or a discarded tab; finishing or starting a run clears it.
- **Input-Aware Hints**: Keyboard shortcuts are shown only to mouse and keyboard players; touch players get tap and drag wording, including how to cancel a shot.

### Fixed
- **Energy Barrier**: The barrier now turns off when the last Lock Core falls in an avalanche, not only when it is destroyed; before, it could stay up for the rest of the level and leave the spheres behind it out of reach.
- **Coins Paid Twice**: Reloading the page while a shot was in flight replayed the shot and paid its coins again. Coins earned during a shot or a Flux shape change are now written once the run is saved.
- **Two Tabs**: With the game open in two tabs, one tab no longer writes stale coins, upgrades or achievements over the progress made in the other.
- **Cleared Colors**: Swapping or putting a special ball back can no longer bring back a color that left the board.
- **Missed Anvil**: An anvil that crushes nothing is a miss: it breaks the combo and counts toward the next Endless or Daily wave.
- **Browser Shortcuts**: Ctrl, Cmd and Alt shortcuts are left to the browser; Ctrl+F no longer flips polarity and Ctrl+1 to 5 no longer equip a special ball.
- **Reduced Motion on the Board**: Field waves, glows and pulses hold still, and trails, bursts, shockwaves and lightning flashes are not drawn. Floating score texts stay.
- **Flux Transition Flicker**: Spheres falling between two Flux shapes no longer flicker.
- **Rotor Boards**: The aim preview is traced once per frame instead of up to six times.
- **License Text**: Restored the NOTICE wording in the Apache license.
- **Mixed Versions After a Deploy**: For up to ten minutes after an update, the page could run with the previous version's texts, styles and scripts (raw keys such as `app.nav.button.flux` on buttons, old layout). The Service Worker and the config and text loaders now revalidate every file with the server instead of trusting the browser cache.
- **Anvil Crash**: An anvil that crushed a dormant bomb (or any sphere whose destruction removes others) stopped the game with a loading error; it now keeps crushing the spheres that are still there.
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
- **Mobile Gestures**: Pull-to-refresh, scroll chaining, double-tap zoom and the tap highlight are disabled outside the board.
- **Tutorial Banner**: Sits above the danger line and lets aiming through, instead of covering the cluster on small screens.
- **Small Screens**: Polarity glyphs grow to stay readable on small boards, HUD labels are larger, the star progress line wraps cleanly, launcher buttons no longer clip their label, and Pause settings show a caption.
- **Locked Levels**: The level select says which level unlocks a locked one.
- **Offline Mode**: Service Worker cache writes complete reliably, navigations fall back to the cached page, and slow networks fall back to the cache after a timeout.

### Changed
- **Desktop Layout**: On landscape desktops the board is centered between two full-height columns of the same width. The left one holds navigation and the round stats, with larger score and shot counts; the right one holds the overcharge gauge and special balls, with Polarity and Swap at the bottom, level with the launcher. Phones are unchanged.
- **Victory Celebration**: Clearing a level no longer cuts straight to the victory window. The last falling spheres and particles keep animating for two seconds under a "Board cleared!" popup, then the window opens; the delay is `victory.celebrationFrames` in `configs/game.json`.
- **Readable Pacing**: Automatic chain reactions now go off one cluster at a time, 0.6 s apart, instead of all in the same frame. Avalanches fall about twice as slowly, special balls hold their impact for a quarter of a second, and running out of shots leaves 1.5 s for the board to settle before the defeat. All delays live in `configs/physics.json` (`chainCheckCooldownFrames`, `dropGravity`, `dropMinVerticalSpeed`, `outOfShotsGraceFrames`) and `configs/game.json` (`juice.hitStopFramesCombo`, `juice.hitStopFramesSpecial`).
- **First Visit Language**: The interface language follows the browser language until the player picks one.
- **Installable PWA**: New sphere icon with 192 px, 512 px and maskable variants.
- **Desktop Layout**: Landscape desktops and tablets put the header and HUD in a side column so the board uses the full window height (about 60 % larger on a 1366x768 laptop).
- **Design Tokens**: Neutral surface, border and text colors are CSS tokens.
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

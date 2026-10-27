# FluxSpheres: Magnetic Physics Edition

*Read this in [French](README.fr.md).*

[![Play Online](https://img.shields.io/badge/Play_Online-GitHub_Pages-38bdf8?style=for-the-badge&logo=github)](https://vblackjack.github.io/flux-spheres/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=for-the-badge)](http://www.apache.org/licenses/LICENSE-2.0)

**Live Game:** [https://vblackjack.github.io/flux-spheres/](https://vblackjack.github.io/flux-spheres/)

**FluxSpheres** is a magnetic physics bubble shooter built with zero external runtime dependencies, featuring dynamic magnetic attraction and repulsion, inertia rotors, quantum portals, singularity vortices, and special power-up spheres.

---

## Features

- **Dynamic Magnetic Physics**: Same-color spheres attract, opposite magnetic poles (`N`/`S`, `+`/`-`, `Ω`/`Φ`) pull, and like poles curve projectile trajectories.
- **Tactical Aiming & Predictive Preview**:
  - Curved laser sight with wall and bumper ricochet prediction.
  - Real-time blast/effect radius preview for Special Balls (Bomb, Lightning, Prism, Anvil, Cryo).
  - Live **Magnetic Avalanche** prediction highlighting unanchored spheres that will drop when upper bonds are severed.
- **Game Modes**:
  - **Campaign**: 24 handcrafted levels introducing pendulums, inertia rotors, repulsors, oscillating barriers, quantum locks, linked portals, Boss Cores, neutral anchors no match can break, chained spheres, bubbles, freeze, lightning and paint cores, rail anchors, thrusters, long tethers and rust.
  - **Survival (Endless)**: Infinite wave defense with Gold Rush waves and Boss anomalies.
  - **Daily Challenge**: Deterministic daily seed with rotating physics mutators (*Hyper Gravity*, *Turbo Rotors*, *Super Magnetism*, *Volatile Cluster*) and a daily coin reward.
  - **Flux Mode**: An endless chain of procedurally generated shapes sharing one shot reserve. Each stage draws a parametric rotor or pendulum, a hanging silhouette (heart, crown, bell, lighthouse, ship anchor...), some held by neutral anchors, or a pair of small shapes, never the same family twice in a row. A difficulty budget adds bumpers, portals, repulsors and singularities as the run goes on, every fifth stage hides a Boss Core, later stages add chains, bubbles and freeze, lightning and paint cores, and clearing a shape refills shots. Runs are seeded, so a reload resumes on the same shape.
- **Game Feel**:
  - Slow motion when a shot flies close to one of the last three spheres of a level or Flux shape.
  - The victory score rolls up and the earned stars pop in one after another; both respect reduced motion.
- **Workshop & Codex**:
  - Permanent upgrades (*Curved Laser Sight*, *Magnetic Amplifier*, *Overcharge Capacitor*, *Projectile Reserve*).
  - In-run Special Ammo refills (an empty special ball opens this tab), Bounties/Achievements, and an illustrated **Codex & Guide**.
- **Accessibility & Comfort**:
  - Bilingual interface (**FR** / **EN**) with zero hardcoded strings; the first visit follows the browser language.
  - **High Contrast** mode with enhanced borders and polarity symbols; buttons meet WCAG AA contrast.
  - **Color Patterns** setting: each color gets its own pattern (stripes, dots, grid, rings) inside the spheres.
  - **Reduced Motion** toggle (`prefers-reduced-motion` aware) and automatic pause on tab switch.
  - Optional **Tilt Control** on phones and tablets: tilting the device leans gravity sideways.
  - Screen reader support: labelled toggles with `aria-pressed`, named power-ups and level stars, and polite announcements for achievements and round results.
  - Full mouse, touch (with vertical finger offset and pull-down shot cancellation), and keyboard controls; held action keys do not auto-repeat.
  - Zero-scroll layout on desktop, phones and landscape phones, with 44 px touch targets. On portrait phones the board spans the full width; navigation and stats live in the slide-in menu (☰), which pauses the run, and a line under the score keeps the round, coins and best score in view. On landscape desktops the board uses the full window height, centered between two columns of the same width: navigation and round stats on the left, overcharge, special balls, Polarity and Swap on the right.
  - The run in progress survives a reload or a discarded tab and resumes paused.
- **Installable & Offline**:
  - Installable Progressive Web App with standard and maskable icons.
  - Network-first Service Worker that falls back to the cached copy when offline or when the network is too slow.

---

## Controls

| Action | Mouse / Touch | Keyboard |
| :--- | :--- | :--- |
| **Aim** | Move pointer / Drag finger | `Left` / `Right` (`+ Shift` for fast aim) |
| **Shoot** | Release pointer / finger | `Enter` |
| **Cancel Aim** | Drag below the launcher ring | - |
| **Swap Ball** | Click secondary ball or **Swap** button | `Space` |
| **Flip Polarity** | Click **Polarity** button | `F` |
| **Equip / Unequip Special Ball** | Click Special Ball slot (click again to stash) | `1` to `6` |
| **Pause / Close Modal** | Click **Pause** or modal backdrop | `Escape` |
| **Settings** | Click **⚙ Settings**, or open **Pause** | - |

---

## Architecture Overview

The codebase follows a modular, zero-dependency ES module architecture with strict data/logic separation (`configs/*.json` and `locales/*.json`):

```text
├── configs/                  # Externalized game, physics, ball, obstacle, audio, level & Flux data
├── icons/                    # PWA icons (SVG, maskable SVG, 192 px and 512 px PNG)
├── locales/                  # Bilingual translation dictionaries (fr.json, en.json)
├── src/
│   ├── main.js               # Application bootstrap, pointer input guards & Service Worker registration
│   ├── core/
│   │   ├── ConfigRegistry.js # Parallel JSON configuration loader
│   │   ├── Constants.js      # Frozen enums and mathematical constants
│   │   ├── I18n.js           # Localization service and DOM attribute translator
│   │   ├── SeededRandom.js   # Deterministic PRNG (Mulberry32) for Daily Challenges and Flux runs
│   │   ├── StorageManager.js # Cached localStorage persistence with in-memory fallback
│   │   └── AudioManager.js   # Procedural Web Audio API synthesizer
│   ├── entities/
│   │   ├── Ball.js           # Magnetic sphere entity (bonds, polarity, armor, modifiers)
│   │   ├── Obstacle.js       # Rotors, bumpers, repulsors, portals, barriers & singularities
│   │   └── ParticleSystem.js # Object-pooled bursts, trails, shockwaves, lightning & popups
│   ├── physics/
│   │   ├── PhysicsWorld.js   # Substepped spring-constraint solver, raycaster & BFS avalanche
│   │   └── SpatialHashGrid.js# Collision-free 2D spatial hash grid for neighbor queries
│   ├── game/
│   │   ├── GameEngine.js     # Game state machine, wave spawner, scoring & achievements
│   │   ├── GameLoop.js       # Fixed-step loop with interpolation, idle throttling and fatal error stop
│   │   ├── Renderer.js       # HiDPI Canvas 2D renderer with alpha interpolation & AOE preview
│   │   ├── SpecialBallController.js # Bomb, Lightning, Prism, Anvil & Cryo impact resolution
│   │   └── layouts/
│   │       ├── LayoutGenerators.js   # Pure shape geometry: pendulum, rings, hexagon, spiral, cross, masks
│   │       └── FluxStageGenerator.js # Seeded Flux stages: shape family, difficulty budget, boss core
│   └── ui/
│       └── UIManager.js      # HUD updates, accessible modals (focus trap + inert) & Codex
├── styles/main.css           # Responsive layout and design tokens
├── index.html                # Application shell and static bootstrap error banner
├── manifest.webmanifest      # PWA manifest
├── sw.js                     # Network-first Service Worker with timeout and versioned offline fallback
└── tests/                    # Automated Node.js test suites
```

---

## Local Development

Requires Node.js 22 or later (CI runs Node.js 24).

```bash
# Run local static server on port 4200
npm start

# Run every automated test suite
npm test
```

The suites in `tests/` cover the game engine, physics, rendering loop, UI helpers, and two repository guards:

- `typography.test.js` rejects typographic look-alikes of ASCII characters (long dashes, curly quotes, ellipsis, special spaces, ligatures) in every text file.
- `pwa.test.js` checks that every file under `src/`, `configs/`, `locales/` and `icons/` is precached by `sw.js`, and that the Service Worker cache version matches `package.json`.

When adding a runtime file, list it in `PRECACHE_ASSETS` in `sw.js`. When releasing, bump `APP_VERSION` in `sw.js` together with `package.json`.

---

## License

Copyright 2026 Julien Bombled. Licensed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0).

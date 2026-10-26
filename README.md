# FluxSpheres — Magnetic Physics Edition

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
  - **Campaign**: 16 handcrafted levels introducing pendulums, inertia rotors, repulsors, oscillating barriers, quantum locks, linked portals, and Boss Cores.
  - **Survival (Endless)**: Infinite wave defense with Gold Rush waves and Boss anomalies.
  - **Daily Challenge**: Deterministic daily seed with rotating physics mutators (*Hyper Gravity*, *Turbo Rotors*, *Super Magnetism*, *Volatile Cluster*) and a daily coin reward.
- **Magnetic Workshop & Codex**:
  - Permanent upgrades (*Curved Laser Sight*, *Magnetic Amplifier*, *Overcharge Capacitor*, *Projectile Reserve*).
  - In-run Special Ammo refills, Bounties/Achievements, and an illustrated **Codex & Guide**.
- **Accessibility & Comfort**:
  - Bilingual interface (**FR** / **EN**) with zero hardcoded strings.
  - **High Contrast** mode with enhanced borders and polarity symbols.
  - **Reduced Motion** toggle (`prefers-reduced-motion` aware) and automatic pause on tab switch.
  - Full mouse, touch (with vertical finger offset and pull-down shot cancellation), and keyboard controls.

---

## Controls

| Action | Mouse / Touch | Keyboard |
| :--- | :--- | :--- |
| **Aim** | Move pointer / Drag finger | `Left` / `Right` (`+ Shift` for fast aim) |
| **Shoot** | Release pointer / finger | `Enter` |
| **Cancel Aim** | Drag below the launcher ring | — |
| **Swap Ball** | Click secondary ball or **Swap** button | `Space` |
| **Flip Polarity** | Click **Polarity** button | `F` |
| **Equip / Unequip Special Ball** | Click Special Ball slot (click again to stash) | `1` – `5` |
| **Pause / Close Modal** | Click **Pause** or modal backdrop | `Escape` |

---

## Local Development

```bash
# Run local static server on port 4200
npm start

# Run automated test suite
npm test
```

---

## License

Copyright 2026 Julien Bombled. Licensed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0).

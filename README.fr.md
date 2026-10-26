# FluxSpheres : édition Physique Magnétique

*Read this in [English](README.md).*

[![Jouer en ligne](https://img.shields.io/badge/Jouer_en_ligne-GitHub_Pages-38bdf8?style=for-the-badge&logo=github)](https://vblackjack.github.io/flux-spheres/)
[![Licence](https://img.shields.io/badge/Licence-Apache_2.0-blue.svg?style=for-the-badge)](http://www.apache.org/licenses/LICENSE-2.0)

**Jeu en ligne :** [https://vblackjack.github.io/flux-spheres/](https://vblackjack.github.io/flux-spheres/)

**FluxSpheres** est un jeu de tir de bulles à physique magnétique, sans aucune dépendance externe à l'exécution : attraction et répulsion magnétiques dynamiques, rotors à inertie, portails quantiques, vortex de singularité et sphères spéciales.

---

## Fonctionnalités

- **Physique magnétique dynamique** : les sphères de même couleur s'attirent, les pôles opposés (`N`/`S`, `+`/`-`, `Ω`/`Φ`) se rapprochent, et les pôles identiques courbent la trajectoire du projectile.
- **Visée tactique et prévisualisation** :
  - Viseur laser courbe avec prédiction des rebonds sur les murs et les bumpers.
  - Prévisualisation en temps réel de la zone d'effet des sphères spéciales (Bombe, Foudre, Prisme, Enclume, Cryo).
  - Prédiction de l'**avalanche magnétique** : les sphères qui tomberont une fois leurs liens supérieurs rompus sont mises en évidence.
- **Modes de jeu** :
  - **Campagne** : 16 niveaux conçus à la main, qui introduisent pendules, rotors à inertie, répulseurs, barrières oscillantes, verrous quantiques, portails liés et Noyaux Boss.
  - **Survie (sans fin)** : défense par vagues infinies, avec vagues de ruée vers l'or et anomalies Boss.
  - **Défi du jour** : graine quotidienne déterministe, mutateurs physiques tournants (*Hyper Gravité*, *Rotors Turbo*, *Super Magnétisme*, *Amas Volatil*) et récompense quotidienne en pièces.
- **Atelier magnétique et Codex** :
  - Améliorations permanentes (*Visée laser courbée*, *Amplificateur magnétique*, *Condensateur de surcharge*, *Réserve de projectiles*).
  - Recharges de munitions spéciales en cours de partie, primes et succès, et un **Codex et guide** illustré.
- **Accessibilité et confort** :
  - Interface bilingue (**FR** / **EN**) sans aucun texte codé en dur.
  - Mode **contraste élevé** avec bordures renforcées et symboles de polarité.
  - Option **réduction des animations** (respecte `prefers-reduced-motion`) et pause automatique au changement d'onglet.
  - Contrôles complets à la souris, au tactile (décalage vertical du doigt et annulation du tir en glissant vers le bas) et au clavier.

---

## Contrôles

| Action | Souris / tactile | Clavier |
| :--- | :--- | :--- |
| **Viser** | Déplacer le pointeur / glisser le doigt | `Gauche` / `Droite` (`+ Maj` pour viser vite) |
| **Tirer** | Relâcher le pointeur / le doigt | `Entrée` |
| **Annuler la visée** | Glisser sous l'anneau du lanceur | - |
| **Échanger la sphère** | Cliquer la sphère secondaire ou le bouton **Échanger** | `Espace` |
| **Inverser la polarité** | Cliquer le bouton **Polarité** | `F` |
| **Équiper / ranger une sphère spéciale** | Cliquer l'emplacement de la sphère spéciale (cliquer à nouveau pour la ranger) | `1` à `5` |
| **Pause / fermer une fenêtre** | Cliquer **Pause** ou le fond de la fenêtre | `Échap` |

---

## Architecture

Le code suit une architecture en modules ES sans dépendance, avec une séparation stricte des données et de la logique (`configs/*.json` et `locales/*.json`) :

```text
├── configs/                  # Données externalisées : jeu, physique, sphères, obstacles, audio et niveaux
├── locales/                  # Dictionnaires de traduction (fr.json, en.json)
├── src/
│   ├── main.js               # Démarrage, boucle à pas fixe et filtrage des entrées pointeur
│   ├── core/
│   │   ├── ConfigRegistry.js # Chargeur parallèle des configurations JSON
│   │   ├── Constants.js      # Énumérations figées et constantes mathématiques
│   │   ├── I18n.js           # Service de traduction et traducteur d'attributs DOM
│   │   ├── SeededRandom.js   # Générateur pseudo-aléatoire déterministe (Mulberry32) du Défi du jour
│   │   ├── StorageManager.js # Persistance localStorage en cache, avec repli en mémoire
│   │   └── AudioManager.js   # Synthétiseur procédural Web Audio API
│   ├── entities/
│   │   ├── Ball.js           # Sphère magnétique (liens, polarité, blindage, modificateurs)
│   │   ├── Obstacle.js       # Rotors, bumpers, répulseurs, portails, barrières et singularités
│   │   └── ParticleSystem.js # Explosions, traînées, ondes de choc, éclairs et textes, en pool d'objets
│   ├── physics/
│   │   ├── PhysicsWorld.js   # Solveur à ressorts en sous-pas, lancer de rayons et avalanche par BFS
│   │   └── SpatialHashGrid.js# Grille de hachage spatial 2D sans collision pour la recherche de voisins
│   ├── game/
│   │   ├── GameEngine.js     # Machine à états, génération des vagues, score et succès
│   │   ├── GameLoop.js       # Boucle à pas fixe avec interpolation, ralenti au repos et arrêt sur erreur fatale
│   │   ├── Renderer.js       # Rendu Canvas 2D HiDPI avec interpolation et prévisualisation de zone
│   │   └── SpecialBallController.js # Résolution des impacts Bombe, Éclair, Prisme, Enclume et Cryo
│   └── ui/
│       └── UIManager.js      # Mise à jour du HUD, fenêtres accessibles (piège de focus + inert) et Codex
├── styles/main.css           # Mise en page adaptative et jetons de design
├── sw.js                     # Service Worker réseau d'abord, avec repli hors ligne versionné
└── tests/                    # Suites de tests automatisés Node.js
```

---

## Développement local

```bash
# Lancer le serveur statique local sur le port 4200
npm start

# Lancer les tests automatisés
npm test
```

---

## Licence

Copyright 2026 Julien Bombled. Distribué sous [licence Apache, version 2.0](http://www.apache.org/licenses/LICENSE-2.0).

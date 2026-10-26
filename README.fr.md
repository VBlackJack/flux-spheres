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
  - **Mode Flux** : un enchaînement sans fin de formes générées, avec une réserve de tirs commune. Chaque forme est un rotor ou un pendule paramétré, une silhouette suspendue (coeur, couronne, sablier...) ou une paire de petites formes, jamais deux fois de suite la même famille. Un budget de difficulté ajoute bumpers, portails, répulseurs et singularités au fil de la partie, une forme sur cinq cache un Noyau Boss, et vider une forme rend des tirs. Chaque partie a sa graine : un rechargement reprend sur la même forme.
- **Sensations de jeu** :
  - Ralenti quand un tir passe près de l'une des trois dernières sphères d'un niveau ou d'une forme Flux.
  - À la victoire, le score défile et les étoiles gagnées apparaissent une par une ; les deux respectent le mode mouvements réduits.
- **Atelier magnétique et Codex** :
  - Améliorations permanentes (*Visée laser courbée*, *Amplificateur magnétique*, *Condensateur de surcharge*, *Réserve de projectiles*).
  - Recharges de munitions spéciales en cours de partie, primes et succès, et un **Codex et guide** illustré.
- **Accessibilité et confort** :
  - Interface bilingue (**FR** / **EN**) sans aucun texte codé en dur ; à la première visite, la langue suit celle du navigateur.
  - Mode **contraste élevé** avec bordures renforcées et symboles de polarité ; les boutons respectent le contraste WCAG AA.
  - Option **réduction des animations** (respecte `prefers-reduced-motion`) et pause automatique au changement d'onglet.
  - Prise en charge des lecteurs d'écran : boutons bascules étiquetés avec `aria-pressed`, sphères spéciales et étoiles des niveaux nommées, annonces discrètes des succès et des fins de manche.
  - Contrôles complets à la souris, au tactile (décalage vertical du doigt et annulation du tir en glissant vers le bas) et au clavier ; une touche d'action maintenue ne se répète pas.
  - Mise en page sans défilement sur ordinateur, téléphone et téléphone en paysage, avec des zones tactiles de 44 px. Sur téléphone en portrait, le plateau occupe toute la largeur ; navigation, réglages et statistiques se trouvent dans le menu coulissant (☰), qui met la partie en pause. Sur un écran d'ordinateur en paysage, le plateau occupe toute la hauteur de la fenêtre, centré entre deux colonnes de même largeur : navigation et statistiques de la manche à gauche, surcharge, billes spéciales, Polarité et Échanger à droite.
  - La partie en cours survit à un rechargement ou à un onglet fermé par le système, et reprend en pause.
- **Installable et hors ligne** :
  - Application web progressive installable, avec icônes standard et adaptatives (maskable).
  - Service Worker réseau d'abord, qui sert la copie en cache hors ligne ou quand le réseau est trop lent.

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
| **Réglages (téléphone)** | Ouvrir **Pause** | - |

---

## Architecture

Le code suit une architecture en modules ES sans dépendance, avec une séparation stricte des données et de la logique (`configs/*.json` et `locales/*.json`) :

```text
├── configs/                  # Données externalisées : jeu, physique, sphères, obstacles, audio, niveaux et Mode Flux
├── icons/                    # Icônes PWA (SVG, SVG maskable, PNG 192 px et 512 px)
├── locales/                  # Dictionnaires de traduction (fr.json, en.json)
├── src/
│   ├── main.js               # Démarrage, filtrage des entrées pointeur et enregistrement du Service Worker
│   ├── core/
│   │   ├── ConfigRegistry.js # Chargeur parallèle des configurations JSON
│   │   ├── Constants.js      # Énumérations figées et constantes mathématiques
│   │   ├── I18n.js           # Service de traduction et traducteur d'attributs DOM
│   │   ├── SeededRandom.js   # Générateur pseudo-aléatoire déterministe (Mulberry32) du Défi du jour et du Mode Flux
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
│   │   ├── SpecialBallController.js # Résolution des impacts Bombe, Éclair, Prisme, Enclume et Cryo
│   │   └── layouts/
│   │       ├── LayoutGenerators.js   # Géométrie pure des formes : pendule, anneaux, hexagone, spirale, croix, masques
│   │       └── FluxStageGenerator.js # Formes Flux à graine : famille, budget de difficulté, Noyau Boss
│   └── ui/
│       └── UIManager.js      # Mise à jour du HUD, fenêtres accessibles (piège de focus + inert) et Codex
├── styles/main.css           # Mise en page adaptative et jetons de design
├── index.html                # Squelette de l'application et bandeau d'erreur de démarrage statique
├── manifest.webmanifest      # Manifeste PWA
├── sw.js                     # Service Worker réseau d'abord, avec délai d'attente et repli hors ligne versionné
└── tests/                    # Suites de tests automatisés Node.js
```

---

## Développement local

Nécessite Node.js 22 ou plus récent (la CI utilise Node.js 24).

```bash
# Lancer le serveur statique local sur le port 4200
npm start

# Lancer toutes les suites de tests automatisés
npm test
```

Les suites de `tests/` couvrent le moteur de jeu, la physique, la boucle de rendu, les utilitaires d'interface, et deux gardes du dépôt :

- `typography.test.js` refuse, dans tous les fichiers texte, les variantes typographiques des caractères ASCII (tirets longs, guillemets courbes, points de suspension, espaces spéciales, ligatures).
- `pwa.test.js` vérifie que chaque fichier de `src/`, `configs/`, `locales/` et `icons/` est mis en cache par `sw.js`, et que la version du cache du Service Worker correspond à `package.json`.

Tout nouveau fichier chargé à l'exécution doit être ajouté à `PRECACHE_ASSETS` dans `sw.js`. À chaque version, `APP_VERSION` dans `sw.js` s'incrémente avec `package.json`.

---

## Licence

Copyright 2026 Julien Bombled. Distribué sous [licence Apache, version 2.0](http://www.apache.org/licenses/LICENSE-2.0).

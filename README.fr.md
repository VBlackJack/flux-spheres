# FluxSpheres : édition Physique Magnétique

*Read this in [English](README.md).*

[![Jouer en ligne](https://img.shields.io/badge/Jouer_en_ligne-GitHub_Pages-38bdf8?style=for-the-badge&logo=github)](https://vblackjack.github.io/flux-spheres/)
[![Licence](https://img.shields.io/badge/Licence-Apache_2.0-blue.svg?style=for-the-badge)](http://www.apache.org/licenses/LICENSE-2.0)

**Jeu en ligne :** [https://vblackjack.github.io/flux-spheres/](https://vblackjack.github.io/flux-spheres/)

**FluxSpheres** est un jeu de tir de bulles à physique magnétique, sans aucune dépendance externe à l'exécution : attraction et répulsion magnétiques dynamiques, rotors à inertie, portails quantiques, vortex de singularité et sphères spéciales.

---

## Fonctionnalités

- **Physique magnétique dynamique** : les sphères de même couleur s'attirent, les pôles opposés (`N`/`S`, `+`/`-`, `Ω`/`Φ`) se rapprochent, et les pôles identiques courbent la trajectoire du projectile. Répulseurs et attracteurs courbent les tirs et font aussi pencher les amas suspendus, à l'écart ou vers eux.
- **Visée tactique et prévisualisation** :
  - Viseur laser courbe avec prédiction des rebonds sur les murs et les bumpers.
  - Prévisualisation en temps réel de la zone d'effet des sphères spéciales (Bombe, Foudre, Prisme, Enclume, Cryo).
  - Prédiction de l'**avalanche magnétique** : les sphères qui tomberont une fois leurs liens supérieurs rompus sont mises en évidence.
- **Modes de jeu** :
  - **Campagne** : 24 niveaux conçus à la main, qui introduisent pendules, rotors à inertie, répulseurs, barrières oscillantes, verrous quantiques, portails liés, Noyaux Boss, ancres neutres qu'aucun groupe ne brise, sphères enchaînées, bulles, coeurs de givre, de foudre et de peinture, ancres sur rail, propulseurs, longues amarres et rouille. Puis 800 niveaux générés (25 à 824), en 20 chapitres de 40, chacun autour d'une de ces mécaniques : plus de couleurs, de sphères et de modificateurs, et moins de tirs en réserve au fil des niveaux, avec un niveau marquant tous les 10 niveaux (une forme dessinée ou une paire, et un Noyau Boss). Chaque niveau se reconstruit depuis son seul numéro.
  - **Survie (sans fin)** : défense par vagues infinies, avec vagues de ruée vers l'or et anomalies Boss.
  - **Défi du jour** : graine quotidienne déterministe, mutateurs physiques tournants (*Hyper Gravité*, *Rotors Turbo*, *Super Magnétisme*, *Amas Volatil*) et récompense quotidienne en pièces.
  - **Mode Flux** : un enchaînement sans fin de formes générées, avec une réserve de tirs commune. Trois formes sur quatre sont des silhouettes générées, parmi plus de 1 200 formes distinctes : étoiles, fleurs, engrenages, polygones, croissants et coeurs, pleins ou creux, de plusieurs tailles et proportions, nommés d'après leur forme ("Étoile à 7 branches", "Fleur creuse à 5 pétales"). Les autres sont un rotor ou un pendule paramétré, une silhouette dessinée (coeur, couronne, cloche, phare, ancre marine...), parfois tenue par des ancres neutres, ou une paire de petites formes, jamais deux fois de suite la même famille. Un budget de difficulté ajoute bumpers, portails, répulseurs et singularités au fil de la partie, une forme sur cinq cache un Noyau Boss, les formes avancées ajoutent chaînes, bulles et coeurs de givre, de foudre et de peinture, et vider une forme rend des tirs. Chaque partie a sa graine : un rechargement reprend sur la même forme.
- **Prise en main** :
  - Un indice de première rencontre explique chaque mécanique la première fois qu'elle arrive sur le plateau, dans tous les modes : le tutoriel du niveau quand il existe, sinon son entrée du Codex. Chaque indice ne s'affiche qu'une fois ; laissé ouvert, il cède la place au suivant après trois tours, et les **Réglages** permettent de tous les revoir. En campagne, ce autour de quoi le niveau est construit est expliqué en premier.
  - Le niveau 1 s'en tient aux groupes et aux avalanches : trois couleurs, aucune sphère spéciale, aucun modificateur ; les emplacements des sphères spéciales apparaissent dès qu'il y en a une à utiliser.
  - Un niveau qui enseigne un modificateur en montre toujours le même nombre, fixé dans sa définition.
- **Sensations de jeu** :
  - Ralenti quand un tir passe près de l'une des trois dernières sphères d'un niveau ou d'une forme Flux.
  - Chaque sphère qui se pose envoie une onde qui fait gonfler l'amas, de lien en lien et plus faiblement à chaque pas, avec un léger tremblement d'écran. L'onde ne change que le dessin des sphères ; le mode mouvements réduits coupe les deux.
  - À la victoire, le score défile et les étoiles gagnées apparaissent une par une ; les deux respectent le mode mouvements réduits.
- **Atelier et Codex** :
  - Améliorations permanentes (*Visée laser courbée*, *Amplificateur magnétique*, *Condensateur de surcharge*, *Réserve de projectiles*).
  - Recharges de munitions spéciales en cours de partie (une bille spéciale épuisée ouvre cet onglet), primes et succès, et un **Codex et guide** illustré.
- **Accessibilité et confort** :
  - Interface bilingue (**FR** / **EN**) sans aucun texte codé en dur ; à la première visite, la langue suit celle du navigateur.
  - Mode **contraste élevé** avec bordures renforcées et symboles de polarité ; les boutons respectent le contraste WCAG AA.
  - Option **motifs de couleur** : chaque couleur reçoit son propre motif (rayures, points, grille, anneaux) à l'intérieur des sphères.
  - Option **réduction des animations** (respecte `prefers-reduced-motion`) et pause automatique au changement d'onglet.
  - **Contrôle par inclinaison** sur téléphone et tablette, activé par défaut : incliner l'appareil penche la gravité sur le côté. Sur iPhone et iPad, le premier appui sur le plateau demande l'autorisation des mouvements. Il se désactive dans les **Réglages**.
  - Prise en charge des lecteurs d'écran : boutons bascules étiquetés avec `aria-pressed`, sphères spéciales et étoiles des niveaux nommées, annonces discrètes des succès et des fins de manche.
  - Contrôles complets à la souris, au tactile (décalage vertical du doigt et annulation du tir en glissant vers le bas) et au clavier ; une touche d'action maintenue ne se répète pas. Les flèches affinent une visée à la souris : après une flèche, les petits mouvements de souris laissent la visée en place et un clic tire dans cette direction.
  - Mise en page sans défilement sur ordinateur, téléphone et téléphone en paysage, avec des zones tactiles de 44 px. Sur téléphone en portrait, le plateau occupe toute la largeur ; navigation et statistiques se trouvent dans le menu coulissant (☰), qui met la partie en pause, et une ligne sous le score garde en vue la manche, les pièces et le record. Le plateau prend la forme du monde, 470 x 820. Sur un écran d'ordinateur en paysage, le plateau occupe toute la hauteur de la fenêtre, centré entre deux colonnes de même largeur : navigation et statistiques de la manche à gauche, surcharge, billes spéciales, Polarité et Échanger à droite.
  - La partie en cours survit à un rechargement ou à un onglet fermé par le système, et reprend en pause.
- **Installable et hors ligne** :
  - Application web progressive installable, avec icônes standard et adaptatives (maskable).
  - Service Worker réseau d'abord, qui sert la copie en cache hors ligne ou quand le réseau est trop lent.

---

## Contrôles

| Action | Souris / tactile | Clavier |
| :--- | :--- | :--- |
| **Viser** | Déplacer le pointeur / glisser le doigt | `Gauche` / `Droite` par petits pas (`+ Maj` pour de plus grands) |
| **Tirer** | Relâcher le pointeur / le doigt | `Entrée` |
| **Annuler la visée** | Glisser sous l'anneau du lanceur | - |
| **Échanger la sphère** | Cliquer la sphère secondaire ou le bouton **Échanger** | `Espace` |
| **Inverser la polarité** | Cliquer le bouton **Polarité** | `F` |
| **Équiper / ranger une sphère spéciale** | Cliquer l'emplacement de la sphère spéciale (cliquer à nouveau pour la ranger) | `1` à `6` |
| **Pause / fermer une fenêtre** | Cliquer **Pause** ou le fond de la fenêtre | `Échap` |
| **Réglages** | Cliquer **⚙ Réglages**, ou ouvrir **Pause** | - |

---

## Architecture

Le code suit une architecture en modules ES sans dépendance, avec une séparation stricte des données et de la logique (`configs/*.json` et `locales/*.json`) :

```text
├── configs/                  # Données externalisées : jeu, physique, sphères, obstacles, audio, niveaux, campagne et Mode Flux
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
│   │   ├── WorldGeometry.js  # Lanceur, ligne de danger et décalage du contenu calculés depuis la taille du monde
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
│   │   ├── Discovery.js      # Indices de première rencontre : mécaniques du plateau, prochaine inconnue, texte
│   │   └── layouts/
│   │       ├── LayoutGenerators.js   # Géométrie pure des formes : pendule, anneaux, hexagone, spirale, croix, masques
│   │       ├── ShapeGenerator.js     # Silhouettes Flux générées : courbes polaires sur la grille, filtre de qualité
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

# Lancer les suites du moteur, des utilitaires d'interface et des gardes du dépôt
npm test

# Lancer les tests de fumée dans le navigateur (la première fois : npm install, puis npx playwright install chromium)
npm run test:browser
```

Les suites de `tests/` couvrent le moteur de jeu, la physique, la boucle de rendu, les utilitaires d'interface, et six gardes du dépôt :

- `typography.test.js` refuse, dans tous les fichiers texte, les variantes typographiques des caractères ASCII (tirets longs, guillemets courbes, points de suspension, espaces spéciales, ligatures).
- `pwa.test.js` vérifie que chaque fichier de `src/`, `configs/`, `locales/` et `icons/` est mis en cache par `sw.js`, et que la version du cache du Service Worker correspond à `package.json`.
- `onboarding.test.js` vérifie que chaque mécanique a un indice dans les deux langues, qu'un niveau dont le tutoriel enseigne une mécanique l'affiche toujours, et que le niveau 1 ne montre que les bases.
- `fluxGenerator.test.js` vérifie que le générateur produit au moins 1 000 formes distinctes, chacune tenant entre les murs et suspendue à ses ancres, nommée dans les deux langues.
- `campaign.test.js` vérifie que les 800 niveaux générés sont des plateaux jouables, reconstruits à l'identique depuis leur numéro, que la difficulté monte d'un chapitre à l'autre, qu'un niveau marquant revient tous les 10 niveaux, et que chaque niveau est nommé dans les deux langues.
- `world.test.js` vérifie que chaque niveau (niveaux générés compris), chaque étape Flux (1 à 60) et la grille de Survie tiennent entre les murs, et qu'un monde de la largeur de conception construit chaque niveau à ses positions d'origine.

`tests/browser/smoke.test.js` ouvre la vraie page dans Chromium sans interface, aux quatre mises en page prises en charge (ordinateur, tablette en portrait, téléphone en paysage et en portrait). Il échoue sur toute erreur de console, tout défilement horizontal ou tout libellé de bouton coupé, vérifie la mise en page au niveau 1 (sans sphère spéciale) et au niveau 2 (avec), vérifie que les fenêtres Réglages, Niveaux, Atelier et Pause mettent la partie en pause puis la reprennent, parcourt la victoire, la défaite et la reprise après rechargement, et vérifie qu'un tremblement de souris garde une visée affinée au clavier. La CI le lance dans une tâche séparée.

Tout nouveau fichier chargé à l'exécution doit être ajouté à `PRECACHE_ASSETS` dans `sw.js`. À chaque version, `APP_VERSION` dans `sw.js` s'incrémente avec `package.json`.

---

## Licence

Copyright 2026 Julien Bombled. Distribué sous [licence Apache, version 2.0](http://www.apache.org/licenses/LICENSE-2.0).

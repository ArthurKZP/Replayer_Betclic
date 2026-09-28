# Replayer_Betclic

Replayer de mains de poker pour les historiques **Betclic Poker**, aux couleurs de Betclic
(rouge `#E10014`, noir, blanc et une touche de jaune pour les gains).
La table est toujours tournée pour que **le joueur soit assis en bas, à sa place** :
il revoit la main comme il l'a jouée.

## Fonctionnalités

- **Import** : coller l'historique, déposer un ou plusieurs fichiers `.txt`, ou coller directement
  sur la page (Ctrl/Cmd + V). Un export contenant plusieurs mains affiche la liste des mains.
- **Lecture action par action** : lecture / pause, action précédente / suivante, début / fin,
  barre de progression, accès direct à Préflop / Flop / Turn / River / Abattage, vitesse 0,5× à 2×.
  Sur téléphone, un tap sur la table avance d'une action.
- **Vue depuis votre siège** : le héros (`[Hero]` dans l'historique) est en bas, avec ses cartes en grand
  et la force de sa main (« Paire de 9 », « Deux paires, 10 et 9 »…).
  Un clic sur un autre joueur (ou le menu « Voir depuis le siège de ») tourne la table vers son siège.
- **Mode décision** : la lecture s'arrête avant chacune de vos actions (« Se coucher / Suivre / Relancer »),
  puis compare votre choix avec l'action réellement jouée.
- **Table animée** : distribution, mises qui partent vers le pot, cartes du tableau, abattage avec
  les 5 cartes gagnantes surlignées, pot envoyé au gagnant, rake affiché.
- **Positions** calculées (UTG, HJ, CO, BTN, SB, BB), pots annexes en cas de tapis, mises non suivies rendues.
- **Montants en € ou en BB**, cartes 4 couleurs, tapis rouge / graphite / vert.
- **Partage par lien web** : « Partager » crée un lien vers la version en ligne
  (`https://arthurkzp.github.io/Replayer_Betclic/#m=…`) qui contient toute la main, compressée.
  Il suffit de l'envoyer (WhatsApp, Discord, e-mail…) : la personne qui l'ouvre rejoue la main,
  sans compte ni fichier. Options : démarrer à l'action affichée, garder le siège choisi.
  Sur téléphone, le bouton « Envoyer… » ouvre le partage du système. Le lien s'affiche avec un aperçu
  de la table dans les messageries.
- **Déroulé** de la main dans la barre latérale (cliquable) et **résultat** de chaque joueur en fin de main.
- Fonctionne sur ordinateur (table en paysage) et sur téléphone (table en portrait).

## Utilisation

Aucune installation n'est nécessaire : ouvrez `index.html` dans un navigateur.
La main d'exemple (`samples/betclic-exemple.txt`) est chargée au démarrage.

Pour servir le dossier en local :

```bash
npm start          # http://localhost:8080
```

### Mise en ligne (GitHub Pages)

Le workflow `.github/workflows/pages.yml` lance les tests puis publie le site à chaque mise à jour de `main`.
Réglage à faire **une seule fois** : *Settings → Pages → Build and deployment → Source : GitHub Actions*.

Le replayer est ensuite en ligne sur **https://arthurkzp.github.io/Replayer_Betclic/**.
Les liens « Partager » pointent toujours vers cette adresse, même si vous utilisez l'appli en local.

Rien n'est stocké sur un serveur : la main est dans la partie `#…` du lien, que le navigateur n'envoie pas
au serveur. Un lien fait environ 1 000 caractères pour une main de cash game.

Pour héberger le replayer ailleurs, modifiez `PUBLIC_URL` dans `js/share.js`.

### Version en un seul fichier

```bash
node scripts/build-standalone.js   # crée dist/replayer.html (CSS et JS intégrés)
```

## Format pris en charge

Export texte Betclic (`*** HEADER ***`, `*** PLAYERS ***`, `*** HOLE CARDS ***`, `*** PRE-FLOP ***`,
`*** FLOP ***`, `*** TURN ***`, `*** RIVER ***`, `*** SHOWDOWN ***`, `*** SUMMARY ***`), par exemple :

```
Seat 4: VlCTORlOUS (€500.00) [SB Hero]
21:08:17 - VlCTORlOUS: Raises to €50.00
*** FLOP *** [Th Ts 6c]
VlCTORlOUS shows [9s 9h] (Two Pair) [Ts Th 9s 9h 7c]
VlCTORlOUS wins main pot of €206.00
```

Actions reconnues : `Posts SB/BB/ante/straddle`, `Folds`, `Checks`, `Calls`, `Bets`, `Raises to`, tapis
(`all-in`), `shows`, `mucks`, `wins … pot`, mises rendues. Les lignes `Sits in` sont ignorées.
Les montants en jetons (tournois) sont aussi acceptés.

## Structure

| Fichier | Rôle |
| --- | --- |
| `index.html` | Page de l'application |
| `css/replayer.css` | Thème (couleurs Betclic, table, cartes, jetons, responsive) |
| `js/parser.js` | Lecture de l'historique Betclic → objet « main » |
| `js/engine.js` | Chronologie des états de table (stacks, mises, pot, positions, pots annexes) |
| `js/evaluator.js` | Évaluation des mains et descriptions en français |
| `js/render.js` | Rendu de la table et animations |
| `js/share.js` | Liens de partage (main compressée dans l'adresse, action de départ, siège) |
| `assets/apercu-partage.jpg` | Image d'aperçu affichée quand un lien est partagé |
| `.github/workflows/pages.yml` | Tests puis mise en ligne sur GitHub Pages |
| `js/app.js` | Interface : lecture, import, réglages, mode décision |
| `js/sample.js` | Main d'exemple intégrée |
| `tests/` | Tests du parseur, du moteur et de l'évaluateur |

## Tests

```bash
npm test
```

---

Outil indépendant, non affilié à Betclic.

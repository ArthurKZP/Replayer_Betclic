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
- **Partage** : « Partager » copie un lien qui contient la main compressée dans l'adresse (`#m=…`).
  Rien n'est envoyé à un serveur : la main reste dans le lien et dans votre navigateur.
- **Déroulé** de la main dans la barre latérale (cliquable) et **résultat** de chaque joueur en fin de main.
- Fonctionne sur ordinateur (table en paysage) et sur téléphone (table en portrait).

## Utilisation

Aucune installation n'est nécessaire : ouvrez `index.html` dans un navigateur.
La main d'exemple (`samples/betclic-exemple.txt`) est chargée au démarrage.

Pour servir le dossier en local :

```bash
npm start          # http://localhost:8080
```

### Héberger sur GitHub Pages

Le projet est 100 % statique. Dans *Settings → Pages* du dépôt, choisissez la branche et le dossier racine :
le replayer est alors en ligne, et les liens « Partager » fonctionnent pour tout le monde.

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
| `js/share.js` | Liens de partage (compression dans l'adresse) |
| `js/app.js` | Interface : lecture, import, réglages, mode décision |
| `js/sample.js` | Main d'exemple intégrée |
| `tests/` | Tests du parseur, du moteur et de l'évaluateur |

## Tests

```bash
npm test
```

---

Outil indépendant, non affilié à Betclic.

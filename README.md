# PlanFest

Application de gestion des tables du festival de jeux de **La Jurande des Conte-Brumes** (Fécamp, début octobre).

**App 100 % statique** : un seul fichier `index.html` (plan en SVG, JS sans framework),
hébergeable tel quel sur **GitHub Pages**. `PLANFEST-BRIEF.md` décrit le comportement et le reste à faire.

## Utiliser

- **En local** : ouvrir `index.html` dans un navigateur. C'est tout.
- **En ligne (GitHub Pages)** : pousser ce dossier sur un dépôt GitHub →
  *Settings → Pages → Build and deployment → Deploy from a branch → `main` / root*.
  `index.html` est servi directement, rien à builder.

## Fait

- **Annuler / refaire** : pile d'instantanés JSON **par festival** (~100 pas), coalescés
  (un glisser = un pas ; frappes regroupées après ~550 ms). Boutons dans la barre du haut
  + **Ctrl+Z / Ctrl+Y / Ctrl+Maj+Z**.
- **Vrais téléchargements** : les PDF/PNG (plans, planning) se téléchargent normalement
  (lien + Blob) — plus de dépendance au visualiseur de claude.ai.
- **Bénévoles & permanences** (bouton « Bénévoles ») : gestion des bénévoles et des postes
  (Accueil, Buvette, Repas, Animation, Logistique, Volant), affectation de **permanences**
  (poste × jour × horaire × durée), détection des chevauchements. Les **animateurs des
  tables Jurande** (champ « Mené par ») sont repris automatiquement par leur nom.
  Deux exports PDF : **planning des tables** (chaque table → qui l'anime, quand) et
  **feuilles des bénévoles** (chacun → ses permanences + ses animations, et où).
  Les données (`benevoles`, `postes`, `shifts`) vivent dans le JSON du festival
  (donc versionnées, annulables, exportées avec le reste).
- **Couverture des tables Jurande** : réglage des **jours actifs + horaires d'ouverture**
  (fenêtre « Festivals »). Toute table Jurande ayant un **créneau vide** (ni partie ni
  permanence) dans ces horaires est signalée par un **anneau orange** sur le plan, et le
  détail des trous apparaît dans sa fiche (`data.jours`, `data.horaires`).

## Stockage

- **Aujourd'hui** : `localStorage` du navigateur + **export / import** en copier-coller du
  JSON (bouton « Exporter / Importer »). Simple, hors-ligne, mais lié à un navigateur.
- **Objectif « données dans GitHub » sans serveur** : comme l'app est statique, l'écriture
  dans un dépôt se fait **côté navigateur via l'API GitHub**, avec un **jeton personnel
  (fine-grained PAT)** que tu saisis une fois dans l'app (gardé en `localStorage`, **jamais
  commité**), limité à **un dépôt de données privé** (les fiches partenaires contiennent des
  contacts). À implémenter — voir questions ci-dessous.

## Questions ouvertes (avant d'ajouter le stockage GitHub)

1. **Un seul organisateur, ou plusieurs ?** → gestion des écritures concurrentes (le `sha`
   de l'API Contents permet de refuser un écrasement).
2. **Un dépôt de données par festival, ou un seul pour tous ?** (défaut proposé : un seul
   dépôt privé, `festivals/<id>.json`.)
3. **Jeton côté navigateur** : OK pour toi ? (seul moyen sans backend ; PAT fine-grained
   restreint au seul dépôt de données, stocké localement, révocable à tout moment.)

## Dette connue

- **Vendoriser** jsPDF (CDN 2.5.1) et les polices (Space Grotesk / Inter / Space Mono,
  via Google Fonts) pour une app vraiment autonome et hors-ligne.
- Retirer le `seed()` d'exemple quand un vrai jeu de données existe.
- Reste du backlog : voir `PLANFEST-BRIEF.md`.

# PlanFest — consignes pour Claude Code

Lire `README.md` pour l'architecture et l'installation. Ce fichier liste les règles du
projet : les respecter dans chaque session.

## Contexte

- Application de gestion d'un festival de jeux associatif (Fécamp). Utilisateurs :
  organisateurs sur Mac/Safari, bénévoles sur téléphone le jour J (wifi médiocre).
- L'organisateur n'est pas développeur de métier : expliquer en français, simplement.
- **Tout est en français** : interface, commentaires, messages de commit, noms SQL.

## Façon de travailler

- On travaille **directement sur `main`**, mais **par vagues** : committer chaque
  correction en local, **ne pousser que quand l'utilisateur dit d'envoyer la vague**.
  Rappeler que rien n'est en ligne tant que ce n'est pas poussé.
- Une migration ou une Edge Function modifiée doit être appliquée **à la main** par
  l'utilisateur dans le tableau de bord Supabase (pas de CLI Supabase, pas de Node ni de
  Deno sur la machine). Donner l'ordre : migration → fonctions → push du code.
  Pour lui transmettre le code d'une fonction : `pbcopy < supabase/functions/<nom>/index.ts`.
- Vérifier la syntaxe JS avant chaque commit (voir README) :
  `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m js/app.js`
  → `ReferenceError` = OK, `SyntaxError` = à corriger.
- Être honnête sur ce qui n'a pas été testé (pas de navigateur ni d'accès à la base ici).

## Sécurité (non négociable)

- La clé Supabase est publique : **chaque table a la RLS activée** et chaque règle
  vérifie le rôle (`est_admin()`, `est_responsable('<pôle>')`, `est_actif()`,
  `gere_benevoles()`, `benevole_courant()`). Ces fonctions exigent un compte **actif**.
- Fonctions `security definer` : toujours `set search_path = public` et un contrôle de
  droits en première ligne ; `revoke … from public, anon` si elles ne sont pas publiques.
- Ne jamais faire confiance au client : formulaires publics (anon) filtrés en base
  (triggers), Edge Functions qui vérifient l'utilisateur (`auth.getUser()` + RPC de rôle).
- Côté JS : **tout texte venant de la base passe par `esc()`** dans les gabarits HTML ;
  tout lien externe saisi par un tiers passe par `safeUrl()` (http/https seulement).
- Aucun secret dans le dépôt (jetons BGG, clés SMTP, service_role : secrets Supabase).

## Base de données

- Migrations numérotées `NNN_nom.sql`, **jamais modifier une migration déjà appliquée** :
  en créer une nouvelle. Prochaine : `039_…`.
- `create or replace function` ne peut pas changer le type de retour : `drop function`
  d'abord. Pour une policy : `drop policy if exists` puis `create policy`.
- Avant de redéfinir une fonction ou une policy, chercher sa **dernière** définition
  (`grep -rn "function public.<nom>" supabase/migrations`) pour ne pas perdre un contrôle
  ajouté entre-temps.
- Une migration qui retire des droits doit prévoir un garde-fou (ex. 031 refuse de
  s'exécuter s'il n'y a aucun admin actif).

## Interface (CSS / HTML)

- Boutons : **toujours une classe `btn`** (+ `primary`, `danger`, `small`, `big`, `block`),
  sinon Safari affiche son style natif.
- `select`, cases à cocher, radios, fichiers : déjà stylés globalement, ne pas réécrire.
- **Jamais de `display:flex`/`grid` sur un `<td>`/`<tr>`** : mettre un `<div>` dedans.
- Tableaux larges : les envelopper dans `<div class="scroll">`.
- Couleurs : utiliser les variables CSS (`var(--ok)`, `--alert`, `--warn`, `--muted`…),
  pas de couleurs en dur.
- Messages : `toast()` (non bloquant) plutôt qu'`alert()` ; `confirm()` seulement pour
  une action destructive.
- Un `<label>` ne contient qu'un seul champ et jamais un autre `<label>`.
- Penser au téléphone (largeur 360 px) et au clavier (`aria-label` sur les boutons à
  icône seule).

## JavaScript

- Modules ES sans build ; imports relatifs avec extension `.js`.
- Chaque écran (`js/ecrans/*.js`) exporte `render(container, sub)` et, s'il pose des
  écouteurs sur `window`/`document`, des minuteries ou du temps réel, **`unmount()`** qui
  les retire (appelé par le routeur en quittant l'écran).
- Toujours traiter `error` des appels Supabase (`const { data, error } = …`) et
  l'afficher ; ne jamais faire comme si l'opération avait réussi.
- Dates « du jour » : `aujourdhui()` (heure locale), jamais `toISOString().slice(0,10)`.
- Réutiliser `js/ui/util.js` (et `js/ui/csv.js`) avant d'écrire un nouvel utilitaire.
- Téléphone : la consultation passe par `js/ecrans/terrain.js` (lecture seule, données
  de la RPC `terrain()`) ; pour afficher un plan en lecture, `js/plan/svg-lecture.js`.

# PlanFest

Application d'organisation du festival de jeux de société de **La Jurande des Conte-Brumes**
(Fécamp, début octobre) : partenaires et éditeurs, ludothèque et sélection des jeux,
bénévoles et animations, plan des salles, buvette et repas, communication, journée
intergénérationnelle du vendredi, accueil et présences le jour J, bilan.

## Architecture

- **Application statique** : HTML + JavaScript en modules ES, **sans framework ni étape
  de build**. Servie telle quelle par **GitHub Pages** depuis la branche `main`.
- **Supabase** pour tout le reste : base Postgres, authentification, temps réel (plan des
  salles), Edge Functions (Deno).
- **La sécurité repose entièrement sur la base** : la clé Supabase de `config.js` est
  publique par conception ; ce sont les règles RLS et les fonctions SQL qui décident qui
  lit et écrit quoi. L'interface ne fait qu'adapter l'affichage.
- **Bibliothèques embarquées** dans `vendor/` (aucun CDN) : `@supabase/supabase-js` 2.119.0,
  `jspdf` 2.5.1, `qrcode-generator` 1.4.4, police Inter.
- **Hors-ligne** : `sw.js` (service worker « réseau d'abord », repli sur le cache après 4 s)
  garde l'application ouvrable sans réseau ; les écrans Accueil et Présences mettent les
  saisies en file (IndexedDB, `js/offline/idb.js`) et les envoient dès que possible.

```
index.html          point d'entrée (charge js/app.js)
config.js           URL et clé publique du projet Supabase
sw.js               service worker (hors-ligne)
css/                app.css (styles), fonts.css (police Inter)
js/app.js           routeur (#/…), barre latérale, cycle de vie des écrans
js/auth.js          session, profil, rôles ; invitations ; mot de passe
js/store.js         édition courante
js/ecrans/          un fichier par écran (render / unmount)
js/public/          pages publiques sans compte (programme, plan, exposants, inscription)
js/plan/            éditeur de plan (modèle, rendu, annuler/refaire, autosave, temps réel)
                    + svg-lecture.js : plan en lecture seule (page publique, « Sur le terrain »)
js/export/          PDF (plan, montage, étiquettes, fiches, permanences), QR codes
js/offline/         files IndexedDB du jour J
js/ui/util.js       utilitaires partagés (esc, safeUrl, toast, dates…)
supabase/migrations 001 → 043, à exécuter dans l'ordre
supabase/functions  Edge Functions : inviter, bgg-import
supabase/seed_demo.sql  données fictives de démonstration (facultatif)
docs/archive/       ancien brief et maquette d'origine (historique, non utilisés)
```

## Sur téléphone

L'écran **« Sur le terrain »** (`#/terrain`, ouvert par défaut sur téléphone) sert à
consulter le jour J, en lecture seule : **Mon planning** (mes parties et mes
permanences, « en cours » / « ensuite »), **Programme** (recherche, en cours et à venir)
et **Plan** (recherche d'une table, détail de ce qui s'y passe). Les données viennent
d'un seul appel (`terrain()`, migration 034) et restent consultables hors ligne.
Les écrans d'édition sont faits pour l'ordinateur.

## Comptes et droits

- **On rejoint PlanFest uniquement par invitation e-mail** (écran Administration, ou
  « Inviter » sur une fiche bénévole). L'inscription libre est désactivée dans Supabase.
- **Rôles** : `admin` (tout) ou `membre`. Un compte **désactivé** perd tous ses droits.
- **Pôles** : un membre peut être responsable d'un ou plusieurs pôles (partenaires,
  jeux et éditeurs, animateurs et bénévoles, buvette et catering, communication,
  sponsors, logistique et sécurité, intergénérationnelle), ce qui lui donne l'écriture
  sur les écrans du pôle. Tout compte actif peut consulter les écrans opérationnels.
- Un responsable du pôle bénévoles peut inviter de simples membres (sans pôle).

## Lancer en local

Les modules ES ne fonctionnent pas en `file://` : il faut un petit serveur HTTP.

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

Pour que les liens des e-mails (invitation, mot de passe) reviennent en local, ajouter
`http://localhost:8000/` dans Supabase → Authentication → URL Configuration → Redirect URLs.

## Installer un projet Supabase

1. **Migrations** : SQL Editor → exécuter `supabase/migrations/001_socle.sql` à
   `043_ajouter_organisme.sql`, **dans l'ordre**, une seule fois chacune (elles ne sont pas
   toutes rejouables). Le premier compte admin se crée à la main (Authentication → Users,
   puis `update profils set role = 'admin', actif = true where email = '…'`).
2. **Edge Functions** (Edge Functions → Deploy a new function → Via Editor, ou
   `supabase functions deploy <nom>`) :
   - `inviter` : envoie les e-mails d'invitation (utilise la clé service_role, fournie
     automatiquement par Supabase à la fonction) ;
   - `bgg-import` : recherche de jeux sur BoardGameGeek, réservée aux comptes actifs.
3. **Secrets** (Edge Functions → Secrets) : `BGG_TOKEN` = jeton d'application BGG
   (géré sur boardgamegeek.com/applications ; un jeton peut expirer).
4. **Authentication** :
   - Sign In / Providers : **désactiver « Allow new users to sign up »** ; laisser
     « Confirm email » activé.
   - URL Configuration : *Site URL* = adresse GitHub Pages de l'app ; la même adresse
     dans *Redirect URLs*.
   - Emails → SMTP Settings : serveur d'envoi **Brevo** (`smtp-relay.brevo.com`, port 587,
     identifiant `…@smtp-brevo.com`, clé SMTP Brevo), expéditeur `contact@jurande.fr`.
     Sans SMTP personnalisé, Supabase n'envoie qu'aux membres de l'organisation Supabase.
   - Emails → Templates : modèles traduits en français (*Invite user*, *Reset password*).
     Une modification met une à deux minutes à s'appliquer.
   - Rate Limits : relever la limite d'e-mails par heure avant une vague d'invitations.
5. `config.js` : URL du projet et clé publique (*publishable*).

## Déployer

Pousser sur `main` : GitHub Pages publie en une à deux minutes (Settings → Pages →
Deploy from a branch → `main` / root). Une **migration** ou une **Edge Function** modifiée
doit en plus être appliquée à la main dans Supabase (SQL Editor / redéploiement de la
fonction) — de préférence **avant** de pousser le code qui en dépend.

Après un push, le service worker sert la nouvelle version dès que le réseau répond ;
`VERSION` dans `sw.js` ne se change que pour forcer le vidage complet des caches.

## Vérifier la syntaxe sans Node

macOS fournit JavaScriptCore :

```sh
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m js/app.js
```

`app.js` importe tous les modules : une `ReferenceError` (ex. `URLSearchParams`) à
l'exécution signifie que **tout a été lu sans erreur de syntaxe** ; une `SyntaxError`
signale un vrai problème (fichier et ligne indiqués).

## Données personnelles

- Écran **Bilan → purger** (admin), après le festival : efface régimes, présences,
  disponibilités, formulaires publics reçus, noms des inscrits aux parties, et les
  coordonnées des bénévoles qui n'ont pas accepté d'être recontactés. Irréversible.
- Fiche bénévole → **Effacer la personne** (admin) : droit à l'effacement complet
  (fiche, inscriptions, formulaires, invitation, compte).
- Le carnet de contacts n'est visible que des pôles communication et intergénérationnel.

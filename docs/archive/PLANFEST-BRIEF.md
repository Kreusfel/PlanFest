# PlanFest : brief pour Claude Code

Application de gestion des tables du festival de jeux de société de La Jurande des Conte-Brumes (Fécamp, début octobre). Ce document accompagne la maquette `planfest.html`, qui fait office de spécification de comportement. Il liste ce qui existe, ce qui est décidé et ce qui reste à faire.

## Contexte

- Le vendredi est une journée intergénérationnelle (classes de primaire, CCAS). **Hors périmètre pour l'instant** : pas besoin d'une grosse organisation, ne pas le modéliser.
- Le samedi et le dimanche, festival ouvert au public (environ 1000 personnes), avec des associations et des boutiques partenaires qui animent des tables.
- Utilisateur : l'organisateur (Romain), trésorier de l'association. Stack habituelle : Python/Flask, Docker, Nginx.

## Décisions prises

1. **Annuler / refaire** : à faire (voir plus bas).
2. **Stockage** : des fichiers JSON dans un dépôt GitHub (voir plus bas).
3. **Vendredi** : hors périmètre.
4. **Tables Jurande** : à définir plus tard. Aujourd'hui un type de table et un champ de notes, rien d'autre.

## Ce que fait la maquette

Fichier unique, HTML + JS sans framework, plan dessiné en SVG. Une case = 1 m (`CELL = 40` px).

- **Festivals multiples** : sélecteur dans la barre du haut, création d'un festival vide, duplication complète d'un festival existant, renommage, suppression en deux clics.
- **Une salle = un onglet** : chaque salle a son quadrillage, en paysage ou en portrait, avec largeur et longueur en mètres. Changer l'orientation fait pivoter la salle et son contenu. Règles en mètres sur les bords.
- **Éléments du plan** : tables (rectangulaires, redimensionnables, pivot de 90°, touche R), repères (accueil, buvette, zone repas, scène, boutique, entrée, WC, mur, texte libre). Glisser-déposer aligné sur la grille, sélection multiple avec Maj+clic, flèches pour décaler, Suppr pour supprimer, duplication, détection des tables qui se chevauchent.
- **Types de table** : Partenaire, Jurande, Libre. Les tables « Libre » ou sans partenaire sont comptées « à assigner ».
- **Fiche partenaire partagée** : un partenaire est une entité (nom, contact, site, repas samedi et dimanche, personnes présentes, couleur). Toutes ses tables pointent vers la même fiche. La modifier depuis n'importe laquelle de ses tables (ou depuis la liste à gauche) la modifie partout, y compris dans les autres salles. Ses tables sont colorées de la même couleur sur le plan.
- **Parties et animations** : chaque table peut avoir plusieurs créneaux (jour, début, durée, titre, animateur, places) avec détection des chevauchements sur une même table. Pastille avec le nombre de parties sur la table.
- **Planning imprimable** : par jour (samedi / dimanche), par salle ou toutes, trié par heure ou par table, A4 ou A3. Chaque ligne donne l'heure, le numéro de table, la salle et un mini-plan où la table est entourée en rouge.
- **Export du plan d'une salle** en PDF ou PNG, avec légende et repère « Vous êtes ici » placé d'un clic (un repère par salle, par défaut sur l'entrée). Options : numéros, noms de partenaires ou couleurs seules sur les tables.
- **Export / import** : copier-coller de tout le JSON du festival courant.

## Modèle de données actuel

Clé `localStorage` : `planfest5` (l'ancienne `planfest4`, un seul festival, est migrée à l'ouverture).

```
root     = { cur: <id festival>, festivals: [ { id, nom, data } ] }
data     = { active: <id salle>, salles: [], partners: [], items: [] }
salle    = { id, nom, cols, rows, here?: {x, y} }          // cols x rows en cases (1 case = 1 m)
partner  = { id, nom, couleur, contact, site, repasSam, repasDim, noms }
item     = table | bloc
table    = { id, kind:"table", salle, x, y, w, h, numero, type:"partenaire"|"jurande"|"libre",
             partner: <id>|null, chaises, notes, sessions: [] }
session  = { id, jour:"sam"|"dim", debut:"HH:MM", duree:<minutes>, titre, anim, places }
bloc     = { id, kind:"bloc", salle, sous, x, y, w, h, label, assigne }
```

Positions et tailles sont en cases (entiers), les ids sont générés par `uid()`.

## À faire

### 1. Annuler / refaire

- Pile d'états : instantanés JSON du contenu d'un festival (`data`), sans la sélection ni le zoom.
- Raccourcis Ctrl+Z, Ctrl+Y et Ctrl+Maj+Z, plus deux boutons dans la barre du haut.
- Un glisser-déposer ou un redimensionnement = un seul pas. Les saisies de texte sont regroupées (par exemple en attendant 600 ms sans frappe). Chaque action de la fiche (changer le type, assigner un partenaire, pivoter, dupliquer, supprimer) = un pas.
- Limite d'environ 100 pas. Une pile par festival, vidée au changement de festival ou conservée, à toi de trancher.
- Dans la maquette, toutes les modifications passent par `save()` : c'est le bon point d'accroche pour enregistrer un pas.

### 2. Stockage JSON dans GitHub

Proposition, à valider :

- **Un fichier JSON par festival** dans un dépôt dédié, par exemple `festivals/<slug>.json`, contenant le `data` d'un festival. L'historique Git sert de sauvegarde et de versions.
- **Dépôt privé** : les fiches partenaires contiennent des contacts (données personnelles).
- **Petit backend Flask** (cohérent avec la stack habituelle) plutôt qu'un jeton GitHub dans le navigateur : `GET /api/festivals`, `GET /api/festivals/<id>`, `PUT /api/festivals/<id>`. Le backend lit et écrit le fichier puis fait le commit avec un message (« Plan : déplacement de la table 12 » ou plus simple, horodatage). Le jeton ou la clé de déploiement reste côté serveur.
- **Conflits** : envoyer le `sha` du fichier avec chaque écriture (API Contents de GitHub) et refuser si le fichier a changé entre-temps. À prévoir : afficher « quelqu'un a modifié le plan » et proposer de recharger.
- **Enregistrement** : automatique après une courte pause (par exemple 2 s) plutôt qu'à chaque action, pour ne pas multiplier les commits. Indicateur « enregistré / en cours / erreur ».
- Garder l'export / import en copier-coller comme secours.

Questions ouvertes : un seul organisateur ou plusieurs en même temps ? Un dépôt par festival ou un dépôt pour tous ? Où héberger le backend ?

## Backlog non décidé (idées, pas des engagements)

À prioriser avec l'organisateur, rien ci-dessous n'a été validé.

- Suivi des partenaires : statut (invité, confirmé, relancé), participation financière, payé oui / non, convention, assurance.
- Matériel par partenaire : tables et chaises à installer, prises électriques, wifi. Liste de montage par salle.
- Impressions : étiquettes de table (numéro et nom du partenaire), fiche d'accueil par partenaire.
- Bénévoles : planning de permanences (buvette, accueil, repas).
- Repas : détail pour le traiteur en plus des totaux.
- Parties : détection d'un animateur placé sur deux tables au même moment, inscription des joueurs, affichage écran ou QR code.
- Sécurité : issues, extincteurs, largeur des allées, contrôle de l'espace entre tables. À vérifier avec la mairie ou la commission de sécurité.
- Mode terrain : vue en lecture seule pour tablette, état « installée / vérifiée » par table.
- Plan : tables rondes (présentes dans une première version, retirées), accessibilité PMR, notes libres sur une table, historique des changements.
- Échanges : export CSV des partenaires et des repas, import de partenaires depuis un tableur, duplication d'un festival en gardant partenaires et plan mais en effaçant parties, repas et statuts.
- Jours configurables par festival : `sam` et `dim` sont écrits en dur (`JOURS`, repas samedi / dimanche, sélecteurs du planning).

## Points techniques à connaître

- **Exports** : la maquette produit les PDF avec jsPDF 2.5.1 (CDN) à partir d'un SVG converti en image. Les téléchargements passent par une fonction propre aux pages hébergées dans Claude. Dans une vraie application, remplacer par un lien de téléchargement classique ; le rendu SVG est prêt (`buildExport` pour le plan, `buildPlanning` pour le planning, pages de 1240 × 1754 px, soit A4 à 150 dpi, rendues en double résolution).
- **Polices** : Space Grotesk, Inter et Space Mono via Google Fonts. À héberger soi-même dans une vraie application. Les exports utilisent Helvetica / Arial.
- **Non testé** : le téléchargement effectif des PDF et PNG sur la page publiée, l'affichage sur téléphone, l'usage tactile, de gros volumes (plusieurs centaines de tables).
- **Seed** : `seed()` crée un festival d'exemple (« Fécamp 2028 », deux salles, partenaires et parties fictifs). À supprimer ou à remplacer par un vrai jeu de données.
- **Fichier de référence** : `planfest.html` (environ 1250 lignes). Tout le JavaScript est dans une seule fonction en bas du fichier, découpée par sections commentées.

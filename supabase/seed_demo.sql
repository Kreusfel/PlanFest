-- seed_demo.sql — PlanFest : données fictives pour une démo.
-- À LANCER UNE SEULE FOIS dans le SQL Editor Supabase (après toutes les migrations).
-- Crée une édition « Fécamp 2027 (démo) » et la remplit. Rejouable = crée une 2e édition
-- + des doublons d'organismes/jeux/bénévoles (persistants). Pour repartir à zéro, supprimer
-- l'édition démo (cascade) et les organismes/jeux/bénévoles créés ci-dessous.
do $$
declare
  v_ed uuid;
  v_s1 uuid; v_s2 uuid;
  v_cat_fam uuid; v_cat_enf uuid; v_cat_exp uuid; v_cat_amb uuid;
  v_oe_a uuid; v_oe_b uuid; v_oe_ed1 uuid; v_oe_ed2 uuid; v_oe_sp uuid;
  v_org uuid;
  v_j uuid; v_je_catan uuid; v_je_dixit uuid; v_je_gloom uuid;
  v_b1 uuid; v_be1 uuid; v_b2 uuid; v_be2 uuid; v_b3 uuid; v_be3 uuid; v_b4 uuid; v_be4 uuid;
  v_t10 uuid; v_t11 uuid; v_t20 uuid;
begin
  -- ----- Édition -----
  insert into editions (nom, date_samedi, jours_actifs, etat, ouverture_debut, ouverture_fin)
  values ('Fécamp 2027 (démo)', date '2027-03-20', array['sam','dim']::text[], 'preparation', time '10:00', time '19:00')
  returning id into v_ed;

  select id into v_cat_fam from categories_jeux where nom = 'Familial' limit 1;
  select id into v_cat_enf from categories_jeux where nom = 'Enfant 6+' limit 1;
  select id into v_cat_exp from categories_jeux where nom = 'Expert' limit 1;
  select id into v_cat_amb from categories_jeux where nom = 'Ambiance' limit 1;

  -- ----- Salles -----
  insert into salles (edition_id, nom, cols, rows) values (v_ed, 'Grande salle', 32, 22) returning id into v_s1;
  insert into salles (edition_id, nom, cols, rows) values (v_ed, 'Espace enfants', 18, 16) returning id into v_s2;

  -- ----- Organismes (persistants) + déclinaison par édition -----
  insert into organismes (nom, site, contact_nom, contact_email, contact_tel)
    values ('Ludothèque La Pioche', 'https://lapioche.fr', 'Marie Dupont', 'marie@example.org', '0612345678') returning id into v_org;
  insert into organisme_editions (organisme_id, edition_id, roles, statut, couleur, personnes_sam, personnes_dim, tables_souhaitees, electricite, convention_recue, assurance_recue)
    values (v_org, v_ed, array['partenaire']::text[], 'confirme', '#a9c6e8', 3, 2, 2, true, true, true) returning id into v_oe_a;

  insert into organismes (nom, contact_nom, contact_email)
    values ('Association Jeux & Co', 'Karim Haddad', 'contact@example.org') returning id into v_org;
  insert into organisme_editions (organisme_id, edition_id, roles, statut, couleur, personnes_sam, personnes_dim, tables_souhaitees)
    values (v_org, v_ed, array['partenaire']::text[], 'relance', '#f7b2b2', 2, 2, 1) returning id into v_oe_b;

  insert into organismes (nom, site, contact_nom, contact_email)
    values ('Éditions Gigamic', 'https://gigamic.com', 'Paul Martin', 'pro@example.org') returning id into v_org;
  insert into organisme_editions (organisme_id, edition_id, roles, statut, couleur)
    values (v_org, v_ed, array['editeur']::text[], 'confirme', '#bfe3b4') returning id into v_oe_ed1;

  insert into organismes (nom, contact_nom, contact_email)
    values ('Asmodee', 'Sophie Leroy', 'events@example.org') returning id into v_org;
  insert into organisme_editions (organisme_id, edition_id, roles, statut, couleur)
    values (v_org, v_ed, array['editeur']::text[], 'invite', '#c9b7e8') returning id into v_oe_ed2;

  insert into organismes (nom, contact_nom, contact_email)
    values ('Banque Populaire', 'Service Mécénat', 'mecenat@example.org') returning id into v_org;
  insert into organisme_editions (organisme_id, edition_id, roles, statut, couleur, nature_aide, logo_url)
    values (v_org, v_ed, array['sponsor']::text[], 'confirme', '#f7d8a0', 'Dotation 1500 € + lots tombola', 'https://exemple.fr/logo-bp.png') returning id into v_oe_sp;

  -- ----- Plan : tables + repères -----
  -- Grande salle : repères
  insert into elements (edition_id, salle_id, kind, x, y, w, h, sous, label) values
    (v_ed, v_s1, 'bloc', 0, 0, 4, 3, 'accueil', 'Accueil'),
    (v_ed, v_s1, 'bloc', 27, 0, 5, 3, 'buvette', 'Buvette');
  -- Grande salle : tables partenaire (dont 2 attribuées) + une à attribuer
  insert into elements (edition_id, salle_id, kind, x, y, w, h, numero, type_table, organisme_edition_id, chaises) values
    (v_ed, v_s1, 'table', 2, 5, 2, 1, '1', 'partenaire', v_oe_a, 4),
    (v_ed, v_s1, 'table', 6, 5, 2, 1, '2', 'partenaire', v_oe_b, 4),
    (v_ed, v_s1, 'table', 10, 5, 2, 1, '3', 'non_attribuee', null, 4);
  -- Grande salle : tables Jurande (2 animées + 1 libre)
  insert into elements (edition_id, salle_id, kind, x, y, w, h, numero, type_table, chaises, mode, categorie_id)
    values (v_ed, v_s1, 'table', 2, 9, 2, 1, '10', 'jurande', 6, 'animee', v_cat_fam) returning id into v_t10;
  insert into elements (edition_id, salle_id, kind, x, y, w, h, numero, type_table, chaises, mode, categorie_id)
    values (v_ed, v_s1, 'table', 6, 9, 2, 1, '11', 'jurande', 6, 'animee', v_cat_exp) returning id into v_t11;
  insert into elements (edition_id, salle_id, kind, x, y, w, h, numero, type_table, chaises, mode)
    values (v_ed, v_s1, 'table', 10, 9, 2, 1, '12', 'jurande', 4, 'libre');
  -- Espace enfants : 1 table Jurande animée + repère scène
  insert into elements (edition_id, salle_id, kind, x, y, w, h, numero, type_table, chaises, mode, categorie_id)
    values (v_ed, v_s2, 'table', 2, 2, 2, 1, '20', 'jurande', 6, 'animee', v_cat_enf) returning id into v_t20;
  insert into elements (edition_id, salle_id, kind, x, y, w, h, sous, label)
    values (v_ed, v_s2, 'bloc', 0, 12, 6, 3, 'scene', 'Scène');

  -- ----- Jeux (persistants) + déclinaison -----
  insert into jeux (titre, annee, joueurs_min, joueurs_max, duree_min, age_min, categorie_id, editeur_id)
    values ('Catan', 1995, 3, 4, 75, 10, v_cat_fam,
            (select organisme_id from organisme_editions where id = v_oe_ed1)) returning id into v_j;
  insert into jeux_editions (jeu_id, edition_id, statut, usage, emplacement) values (v_j, v_ed, 'recu', 'animation', 'Table 10') returning id into v_je_catan;

  insert into jeux (titre, annee, joueurs_min, joueurs_max, duree_min, age_min, categorie_id, editeur_id)
    values ('Dixit', 2008, 3, 6, 30, 8, v_cat_amb,
            (select organisme_id from organisme_editions where id = v_oe_ed2)) returning id into v_j;
  insert into jeux_editions (jeu_id, edition_id, statut, usage) values (v_j, v_ed, 'recu', 'animation') returning id into v_je_dixit;

  insert into jeux (titre, annee, joueurs_min, joueurs_max, duree_min, age_min, categorie_id)
    values ('Gloomhaven', 2017, 1, 4, 120, 14, v_cat_exp) returning id into v_j;
  insert into jeux_editions (jeu_id, edition_id, statut, usage) values (v_j, v_ed, 'demande', 'animation') returning id into v_je_gloom;

  insert into jeux (titre, annee, joueurs_min, joueurs_max, duree_min, age_min, categorie_id)
    values ('Dobble', 2009, 2, 8, 15, 6, v_cat_enf) returning id into v_j;
  insert into jeux_editions (jeu_id, edition_id, statut, usage) values (v_j, v_ed, 'deja_asso', 'animation');

  insert into jeux (titre, annee, joueurs_min, joueurs_max, duree_min, age_min, categorie_id)
    values ('Les Aventuriers du Rail', 2004, 2, 5, 60, 8, v_cat_fam) returning id into v_j;
  insert into jeux_editions (jeu_id, edition_id, statut, usage) values (v_j, v_ed, 'souhaite', 'tournoi');

  -- ----- Bénévoles + déclinaison + disponibilités + compétences -----
  insert into benevoles (nom, email, telephone) values ('Alice Bernard', 'alice@example.fr', '0601020304') returning id into v_b1;
  insert into benevoles_editions (benevole_id, edition_id, equipes, est_animateur, statut, repas_sam, repas_dim)
    values (v_b1, v_ed, array['animation','accueil']::text[], true, 'confirme', true, true) returning id into v_be1;
  insert into disponibilites (benevole_edition_id, jour, demi_journee, disponible) values
    (v_be1, 'sam', 'matin', true), (v_be1, 'sam', 'aprem', true), (v_be1, 'dim', 'matin', true), (v_be1, 'dim', 'aprem', false);
  insert into competences (benevole_id, categorie_id, niveau) values (v_b1, v_cat_fam, 'anime'), (v_b1, v_cat_amb, 'anime'), (v_b1, v_cat_exp, 'apprendre');

  insert into benevoles (nom, email, telephone) values ('Hugo Lefèvre', 'hugo@example.fr', '0605060708') returning id into v_b2;
  insert into benevoles_editions (benevole_id, edition_id, equipes, est_animateur, statut, repas_sam)
    values (v_b2, v_ed, array['animation']::text[], true, 'inscrit', true) returning id into v_be2;
  insert into disponibilites (benevole_edition_id, jour, demi_journee, disponible) values
    (v_be2, 'sam', 'matin', true), (v_be2, 'sam', 'aprem', true), (v_be2, 'dim', 'matin', false), (v_be2, 'dim', 'aprem', false);
  insert into competences (benevole_id, categorie_id, niveau) values (v_b2, v_cat_exp, 'anime'), (v_b2, v_cat_enf, 'anime');

  insert into benevoles (nom, email) values ('Camille Roy', 'camille@example.fr') returning id into v_b3;
  insert into benevoles_editions (benevole_id, edition_id, equipes, statut, repas_sam, repas_dim)
    values (v_b3, v_ed, array['accueil','buvette']::text[], 'confirme', true, true) returning id into v_be3;
  insert into disponibilites (benevole_edition_id, jour, demi_journee, disponible) values
    (v_be3, 'sam', 'matin', true), (v_be3, 'sam', 'aprem', true);

  insert into benevoles (nom, email) values ('Léa Moreau', 'lea@example.fr') returning id into v_b4;
  insert into benevoles_editions (benevole_id, edition_id, equipes, statut)
    values (v_b4, v_ed, array['montage']::text[], 'inscrit') returning id into v_be4;

  -- ----- Parties (tables Jurande animées) -----
  insert into parties (edition_id, element_id, jeu_edition_id, benevole_edition_id, jour, debut, duree_min, places, titre) values
    (v_ed, v_t10, v_je_catan, v_be1, 'sam', time '14:00', 75, 4, 'Découverte Catan'),
    (v_ed, v_t11, v_je_gloom, v_be2, 'sam', time '15:00', 120, 4, 'Initiation Gloomhaven'),
    (v_ed, v_t20, v_je_dixit, v_be1, 'dim', time '11:00', 30, 6, 'Dixit en famille');
  -- une partie sans animateur (pour illustrer une alerte du tableau de bord)
  insert into parties (edition_id, element_id, jeu_edition_id, jour, debut, duree_min, places)
    values (v_ed, v_t10, v_je_dixit, 'sam', time '16:00', 30, 4);

  -- ----- Subventions -----
  insert into subventions (edition_id, financeur, echeance, statut) values
    (v_ed, 'Mairie de Fécamp', current_date + 20, 'depose'),
    (v_ed, 'Région Normandie', current_date + 12, 'a_faire'),
    (v_ed, 'CAF Seine-Maritime', current_date - 5, 'accorde'),
    (v_ed, 'Département 76', current_date + 40, 'refuse');

  -- ----- Régimes -----
  insert into regimes (benevole_edition_id, texte) values (v_be1, 'Végétarien'), (v_be3, 'Sans gluten');
  insert into regimes (organisme_edition_id, texte) values (v_oe_a, 'Sans gluten (1 personne)');

  -- ----- Présences (jour J, samedi) -----
  insert into presences (benevole_edition_id, jour, etat) values
    (v_be1, 'sam', 'present'), (v_be2, 'sam', 'retard'), (v_be3, 'sam', 'present');

  -- ----- Entrées (comptage anonyme) : distribution par jour et tranche -----
  insert into entrees (id, edition_id, jour, tranche_age, saisi_le)
  select gen_random_uuid(), v_ed, j.jour, d.tr, now()
  from (values ('sam'), ('dim')) as j(jour)
  cross join (values ('3+', 8), ('6+', 12), ('8+', 10), ('13+', 6), ('adulte', 15)) as d(tr, cnt)
  cross join lateral generate_series(1, d.cnt) g;

  -- ----- (option) relier le compte admin à Alice pour voir « Mon planning » / « Compétences » -----
  update benevoles b set profil_id = p.id
    from profils p
   where p.email = 'admin@example.org' and b.id = v_b1  -- remplacer par l'e-mail de VOTRE compte admin
     and not exists (select 1 from benevoles x where x.profil_id = p.id);

  raise notice 'Seed démo OK : édition %', v_ed;
end $$;

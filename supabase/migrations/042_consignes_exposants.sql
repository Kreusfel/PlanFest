-- 042_consignes_exposants.sql — PlanFest
-- (+ dupliquer_edition reprend lieu et consignes)
-- Consignes imprimées sur les fiches d'accueil des partenaires : propres à chaque
-- édition (une consigne par ligne), modifiables par le pôle Partenaires et les admins
-- depuis l'écran Répartition tables. Vide = consignes par défaut de l'application.

alter table public.editions add column if not exists consignes_exposants text;

create or replace function public.maj_consignes_exposants(p_edition uuid, p_texte text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (est_admin() or est_responsable('partenaires')) then raise exception 'acces refuse'; end if;
  update editions set consignes_exposants = nullif(btrim(p_texte), '') where id = p_edition;
end $$;
revoke all on function public.maj_consignes_exposants(uuid, text) from public, anon;
grant execute on function public.maj_consignes_exposants(uuid, text) to authenticated;

-- Dupliquer une édition reprend aussi le lieu et les consignes (dernière définition : 037).
create or replace function public.dupliquer_edition(
  p_source uuid, p_nom text, p_date_samedi date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_new uuid; v_map jsonb := '{}'; r record; v_ns uuid; v_decal int;
begin
  if not est_admin() then raise exception 'acces refuse'; end if;

  insert into editions (
    nom, date_samedi, jours_actifs, pause_repas_min, fenetre_repas_debut,
    fenetre_repas_fin, limite_matin, ouverture_debut, ouverture_fin,
    edition_source_id, etat, programme_publie, lieu, consignes_exposants)
  select p_nom, p_date_samedi, jours_actifs, pause_repas_min, fenetre_repas_debut,
         fenetre_repas_fin, limite_matin, ouverture_debut, ouverture_fin,
         p_source, 'preparation', false, lieu, consignes_exposants
  from editions where id = p_source
  returning id into v_new;

  for r in select * from salles where edition_id = p_source loop
    insert into salles (edition_id, nom, cols, rows, ici_x, ici_y)
    values (v_new, r.nom, r.cols, r.rows, r.ici_x, r.ici_y)
    returning id into v_ns;
    v_map := v_map || jsonb_build_object(r.id::text, v_ns::text);
  end loop;

  insert into elements (
    edition_id, salle_id, kind, x, y, w, h, numero, type_table,
    organisme_edition_id, chaises, mode, zone, categorie_id,
    sous, label, assigne, etat_terrain, notes)
  select v_new, (v_map->>e.salle_id::text)::uuid, e.kind, e.x, e.y, e.w, e.h,
         e.numero, e.type_table, null, e.chaises, e.mode, e.zone, e.categorie_id,
         e.sous, e.label, e.assigne, 'a_installer', e.notes
  from elements e where e.edition_id = p_source;

  insert into organisme_editions (organisme_id, edition_id, roles, couleur, statut)
  select organisme_id, v_new, roles, couleur, 'invite'
  from organisme_editions where edition_id = p_source;

  insert into jeux_editions (jeu_id, edition_id, statut, usages, exemplaires, element_id, emplacement, notes)
  select jeu_id, v_new,
         case when statut = 'deja_asso' then 'deja_asso' else 'souhaite' end,
         usages, exemplaires, null, null, null
  from jeux_editions where edition_id = p_source;

  -- Tri de la ludothèque : recopié tel quel (le déclencheur garde la sélection
  -- cohérente ; les jeux « oui »/« bar » viennent d'être copiés juste au-dessus).
  insert into ludotheque_choix (edition_id, jeu_id, choix)
  select v_new, jeu_id, choix from ludotheque_choix where edition_id = p_source;

  -- Écart en jours entre les deux festivals (pour décaler les échéances).
  select p_date_samedi - date_samedi into v_decal from editions where id = p_source;

  insert into horaires_ouverture (edition_id, jour, debut, fin)
  select v_new, jour, debut, fin from horaires_ouverture where edition_id = p_source;

  insert into subventions (edition_id, financeur, echeance, statut, lien_pieces)
  select v_new, financeur, echeance + v_decal, 'a_faire', lien_pieces
  from subventions where edition_id = p_source;

  insert into buvette_items (edition_id, nom, categorie, prix_achat, prix_vente, notes)
  select v_new, nom, categorie, prix_achat, prix_vente, notes
  from buvette_items where edition_id = p_source;

  -- Créneaux de permanence sans bénévole ; la table est retrouvée dans le plan copié
  -- (même salle, même position).
  insert into permanences (edition_id, poste, jour, debut, fin, element_id, notes)
  select v_new, p.poste, p.jour, p.debut, p.fin,
         (select en.id from elements eo
            join elements en on en.edition_id = v_new and en.kind = eo.kind
             and en.salle_id = (v_map->>eo.salle_id::text)::uuid and en.x = eo.x and en.y = eo.y
           where eo.id = p.element_id limit 1),
         p.notes
  from permanences p where p.edition_id = p_source;

  insert into malle_jeux (edition_id, jeu_id, malle, notes)
  select v_new, jeu_id, malle, notes from malle_jeux where edition_id = p_source;

  return v_new;
end $$;

-- 015_jeux_v2.sql — PlanFest. Jeux : usages multiples (animation/tombola, « tournoi »
-- retiré) + rattachement à une table du plan (element_id) au lieu d'un texte.
-- Met à jour dupliquer_edition. Nécessite 001..014.

-- usages (tableau) : migre depuis usage (tournoi -> animation), puis supprime usage.
alter table public.jeux_editions
  add column if not exists usages text[] not null default '{animation}',
  add column if not exists element_id uuid references public.elements(id) on delete set null;

alter table public.jeux_editions
  add constraint jeux_editions_usages_chk check (usages <@ array['animation','tombola']::text[]);

update public.jeux_editions
  set usages = case when usage = 'tombola' then array['tombola']::text[] else array['animation']::text[] end;

alter table public.jeux_editions drop column if exists usage;

-- ========================================================================
-- dupliquer_edition : re-déclaré avec usages (element_id non copié, plan neuf).
-- ========================================================================
create or replace function public.dupliquer_edition(
  p_source uuid, p_nom text, p_date_samedi date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_new uuid; v_map jsonb := '{}'; r record; v_ns uuid;
begin
  if not est_admin() then raise exception 'acces refuse'; end if;

  insert into editions (
    nom, date_samedi, jours_actifs, pause_repas_min, fenetre_repas_debut,
    fenetre_repas_fin, limite_matin, ouverture_debut, ouverture_fin,
    edition_source_id, etat, programme_publie)
  select p_nom, p_date_samedi, jours_actifs, pause_repas_min, fenetre_repas_debut,
         fenetre_repas_fin, limite_matin, ouverture_debut, ouverture_fin,
         p_source, 'preparation', false
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

  return v_new;
end $$;

-- 036_tri_ludotheque_selection.sql — PlanFest
-- Le tri de la ludothèque (oui / bar à jeux / non) alimente enfin la Sélection Jeux :
--   oui  → le jeu entre dans la sélection de l'édition (statut « Déjà à l'asso »), usage Animation
--   bar  → idem, usage « Bar à jeux » (jeu en libre-service, pas d'animateur)
--   non  → retiré de la sélection s'il y était comme jeu de l'asso ; refusé s'il est
--          programmé dans une partie (pour ne pas casser le planning).
-- Un jeu déjà dans la sélection (ex. prêté par un éditeur, « Reçu ») garde son statut :
-- seuls ses usages changent.
-- Nécessite 015 (usages) et 020 (ludotheque_choix).

-- 1) Nouvel usage « bar » (bar à jeux).
alter table public.jeux_editions drop constraint if exists jeux_editions_usages_chk;
alter table public.jeux_editions
  add constraint jeux_editions_usages_chk check (usages <@ array['animation','tombola','bar']::text[]);

-- 2) Synchronisation choix → sélection. Fonction « invoker » : elle agit avec les droits
--    de la personne qui trie (pôle Jeux & éditeurs / admin), mêmes droits que la sélection.
create or replace function public.sync_tri_ludotheque()
returns trigger language plpgsql set search_path = public as $$
declare v_usage text; v_autre text; v_je uuid; v_parties int;
begin
  if new.choix in ('oui', 'bar') then
    v_usage := case new.choix when 'oui' then 'animation' else 'bar' end;
    v_autre := case new.choix when 'oui' then 'bar' else 'animation' end;
    insert into jeux_editions (jeu_id, edition_id, statut, usages)
    values (new.jeu_id, new.edition_id, 'deja_asso', array[v_usage])
    on conflict (jeu_id, edition_id) do update
      set usages = (select coalesce(array_agg(distinct u), '{}')
                      from unnest(array_remove(jeux_editions.usages, v_autre) || v_usage) u);
  else  -- non
    select id into v_je from jeux_editions
     where jeu_id = new.jeu_id and edition_id = new.edition_id and statut = 'deja_asso';
    if v_je is not null then
      select count(*) into v_parties from parties where jeu_edition_id = v_je;
      if v_parties > 0 then
        raise exception 'Ce jeu est programmé dans % partie(s) : retire-le d''abord des Animations.', v_parties;
      end if;
      delete from jeux_editions where id = v_je;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists t_tri_ludotheque on public.ludotheque_choix;
create trigger t_tri_ludotheque after insert or update of choix on public.ludotheque_choix
  for each row execute function public.sync_tri_ludotheque();

-- 3) Reprise des choix déjà faits (oui / bar seulement : rien n'est supprimé ici).
insert into public.jeux_editions (jeu_id, edition_id, statut, usages)
select c.jeu_id, c.edition_id, 'deja_asso',
       array[case c.choix when 'oui' then 'animation' else 'bar' end]
from public.ludotheque_choix c
where c.choix in ('oui', 'bar')
on conflict (jeu_id, edition_id) do nothing;

-- 4) Dupliquer une édition recopie aussi le tri de la ludothèque.
--    Reprend la dernière définition (015) ; seul l'ajout final change.
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

  -- Tri de la ludothèque : recopié tel quel (le déclencheur garde la sélection
  -- cohérente ; les jeux « oui »/« bar » viennent d'être copiés juste au-dessus).
  insert into ludotheque_choix (edition_id, jeu_id, choix)
  select v_new, jeu_id, choix from ludotheque_choix where edition_id = p_source;

  return v_new;
end $$;

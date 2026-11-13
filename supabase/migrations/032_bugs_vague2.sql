-- ========================================================================
-- 032 — Bugs (revue de code, vague 2). Nécessite 001..031.
--  1. Tableau de bord : les totaux de repas sont visibles par tout compte
--     actif (le tableau de bord échouait « acces refuse » pour les non-admins
--     hors pôle buvette). Les noms et régimes (liste_regimes) restent protégés.
--  2. restaurer_plan conserve les identifiants des salles et des tables :
--     les parties et inscriptions des tables présentes dans la version sont
--     gardées (avant : tout était effacé en cascade, sans avertissement).
--     Une table absente de la version emporte toujours ses parties :
--     restauration_impact() permet de l'annoncer avant de confirmer.
-- ========================================================================

-- 1. Totaux de repas : simples nombres, sans donnée personnelle ------------
create or replace function public.repas_par_jour(
  p_edition uuid, p_inclure_non_confirmes boolean default false)
returns table (j_code text, nb_partenaires int, nb_benevoles int, nb_total int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not est_actif() then
    raise exception 'acces refuse';
  end if;
  return query
  with j(jour) as (values ('sam'), ('dim')),
  p as (select j.jour, coalesce(sum(case j.jour when 'sam' then oe.personnes_sam
                                     else oe.personnes_dim end), 0)::int as n
          from j left join organisme_editions oe
            on oe.edition_id = p_edition and 'partenaire' = any (oe.roles)
           and (p_inclure_non_confirmes or oe.statut = 'confirme')
         group by j.jour),
  b as (select j.jour, count(be.id)::int as n
          from j left join benevoles_editions be
            on be.edition_id = p_edition and be.statut <> 'annule'
           and case j.jour when 'sam' then be.repas_sam else be.repas_dim end
         group by j.jour)
  select p.jour, p.n, b.n, p.n + b.n from p join b using (jour);
end $$;

-- 2a. Ce que la restauration ferait perdre ----------------------------------
create or replace function public.restauration_impact(p_version uuid)
returns table (tables_retirees int, parties_perdues int)
language plpgsql stable security definer set search_path = public as $$
declare vp versions_plan%rowtype;
begin
  if not (est_admin() or est_responsable('logistique_securite')) then raise exception 'acces refuse'; end if;
  select * into vp from versions_plan where id = p_version;
  if not found then raise exception 'version introuvable'; end if;
  return query
  with gardes as (select (x->>'id')::uuid as id from jsonb_array_elements(vp.instantane->'elements') x),
       retires as (select e.id from elements e
                    where e.edition_id = vp.edition_id and e.id not in (select id from gardes))
  select (select count(*)::int from retires),
         (select count(*)::int from parties p where p.element_id in (select id from retires));
end $$;

-- 2b. Restauration non destructive pour ce qui existe encore ----------------
create or replace function public.restaurer_plan(p_version uuid)
returns void language plpgsql security definer set search_path = public as $$
declare vp versions_plan%rowtype; ed uuid;
begin
  if not (est_admin() or est_responsable('logistique_securite')) then raise exception 'acces refuse'; end if;
  select * into vp from versions_plan where id = p_version;
  if not found then raise exception 'version introuvable'; end if;
  ed := vp.edition_id;

  -- Retirer ce qui n'existe pas dans la version (tables d'abord, puis salles).
  delete from elements
   where edition_id = ed
     and id not in (select (x->>'id')::uuid from jsonb_array_elements(vp.instantane->'elements') x);
  delete from salles
   where edition_id = ed
     and id not in (select (x->>'id')::uuid from jsonb_array_elements(vp.instantane->'salles') x);

  -- Salles : mêmes identifiants, valeurs de la version.
  insert into salles (id, edition_id, nom, cols, rows, ici_x, ici_y)
  select (s->>'id')::uuid, ed, s->>'nom', (s->>'cols')::int, (s->>'rows')::int,
         (s->>'ici_x')::numeric, (s->>'ici_y')::numeric
    from jsonb_array_elements(vp.instantane->'salles') s
  on conflict (id) do update set nom = excluded.nom, cols = excluded.cols, rows = excluded.rows,
    ici_x = excluded.ici_x, ici_y = excluded.ici_y;

  -- Éléments : mêmes identifiants (les parties qui y sont rattachées survivent).
  -- Un organisme ou une catégorie supprimé(e) depuis est simplement détaché(e).
  insert into elements (id, edition_id, salle_id, kind, x, y, w, h, numero, type_table,
    organisme_edition_id, chaises, mode, zone, categorie_id, sous, label, assigne, etat_terrain, notes)
  select (e->>'id')::uuid, ed, (e->>'salle_id')::uuid, e->>'kind',
    (e->>'x')::int, (e->>'y')::int, (e->>'w')::int, (e->>'h')::int, e->>'numero', e->>'type_table',
    (select oe.id from organisme_editions oe where oe.id = nullif(e->>'organisme_edition_id','')::uuid),
    coalesce((e->>'chaises')::int, 0), coalesce(e->>'mode','animee'), e->>'zone',
    (select c.id from categories_jeux c where c.id = nullif(e->>'categorie_id','')::uuid),
    e->>'sous', e->>'label', (e->>'assigne')::boolean,
    coalesce(e->>'etat_terrain','a_installer'), e->>'notes'
    from jsonb_array_elements(vp.instantane->'elements') e
  on conflict (id) do update set salle_id = excluded.salle_id, kind = excluded.kind,
    x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h, numero = excluded.numero,
    type_table = excluded.type_table, organisme_edition_id = excluded.organisme_edition_id,
    chaises = excluded.chaises, mode = excluded.mode, zone = excluded.zone,
    categorie_id = excluded.categorie_id, sous = excluded.sous, label = excluded.label,
    assigne = excluded.assigne, etat_terrain = excluded.etat_terrain, notes = excluded.notes;

  -- Créneaux de table : remplacés par ceux de la version.
  delete from creneaux_table where element_id in (select id from elements where edition_id = ed);
  insert into creneaux_table (element_id, jour, debut, categorie_id)
  select (c->>'element_id')::uuid, c->>'jour', (c->>'debut')::time, (c->>'categorie_id')::uuid
    from jsonb_array_elements(vp.instantane->'creneaux') c
   where exists (select 1 from elements x where x.id = (c->>'element_id')::uuid)
     and exists (select 1 from categories_jeux k where k.id = (c->>'categorie_id')::uuid)
  on conflict do nothing;
end $$;

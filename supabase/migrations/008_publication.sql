-- 008_publication.sql — PlanFest, Phase 3
-- Programme public (anonyme), publication d'une édition, figer/restaurer le plan.
-- Suggestions et exports PDF viennent plus tard. Nécessite 001..007.

-- ========================================================================
-- publier_edition : une seule édition publiée à la fois (§10)
-- ========================================================================
create or replace function public.publier_edition(p_edition uuid, p_publier boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'acces refuse'; end if;
  if p_publier then
    update editions set programme_publie = false where programme_publie and id <> p_edition;
    update editions set programme_publie = true where id = p_edition;
  else
    update editions set programme_publie = false where id = p_edition;
  end if;
end $$;

-- ========================================================================
-- programme_public : parties d'une édition publiée, SANS nom d'animateur (§10).
-- Appelable par le rôle anonyme (security definer : contourne la RLS, ne rend
-- rien si l'édition n'est pas publiée).
-- ========================================================================
create or replace function public.programme_public(p_edition uuid)
returns table (jour text, debut time, fin time, salle text, numero text, jeu text, places int)
language sql stable security definer set search_path = public as $$
  select p.jour, p.debut, p.fin, s.nom, e.numero,
         coalesce(j.titre, p.titre), p.places
  from parties p
  join editions ed on ed.id = p.edition_id and ed.programme_publie
  join elements e on e.id = p.element_id
  join salles s on s.id = e.salle_id
  left join jeux_editions je on je.id = p.jeu_edition_id
  left join jeux j on j.id = je.jeu_id
  where p.edition_id = p_edition
  order by p.jour, p.debut, s.nom;
$$;
grant execute on function public.programme_public(uuid) to anon, authenticated;

-- ========================================================================
-- figer_plan : instantané des salles, éléments et créneaux dans versions_plan
-- ========================================================================
create or replace function public.figer_plan(p_edition uuid, p_nom text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; snap jsonb;
begin
  if not (est_admin() or est_responsable('logistique_securite')) then raise exception 'acces refuse'; end if;
  snap := jsonb_build_object(
    'salles',   coalesce((select jsonb_agg(to_jsonb(s)) from salles s where s.edition_id = p_edition), '[]'),
    'elements', coalesce((select jsonb_agg(to_jsonb(e)) from elements e where e.edition_id = p_edition), '[]'),
    'creneaux', coalesce((select jsonb_agg(to_jsonb(c)) from creneaux_table c
                            join elements e on e.id = c.element_id where e.edition_id = p_edition), '[]'));
  insert into versions_plan (edition_id, nom, cree_par, instantane)
  values (p_edition, p_nom, auth.uid(), snap) returning id into v_id;
  return v_id;
end $$;

-- ========================================================================
-- restaurer_plan : remplace le plan courant de l'édition par l'instantané.
-- Destructif : efface salles/éléments/créneaux actuels puis recrée depuis la copie.
-- ========================================================================
create or replace function public.restaurer_plan(p_version uuid)
returns void language plpgsql security definer set search_path = public as $$
declare vp versions_plan%rowtype; s jsonb; e jsonb; c jsonb;
        v_map jsonb := '{}'; el_map jsonb := '{}'; new_s uuid; new_e uuid;
begin
  if not (est_admin() or est_responsable('logistique_securite')) then raise exception 'acces refuse'; end if;
  select * into vp from versions_plan where id = p_version;
  if not found then raise exception 'version introuvable'; end if;

  delete from elements where edition_id = vp.edition_id;  -- créneaux supprimés en cascade
  delete from salles where edition_id = vp.edition_id;

  for s in select * from jsonb_array_elements(vp.instantane->'salles') loop
    insert into salles (edition_id, nom, cols, rows, ici_x, ici_y)
    values (vp.edition_id, s->>'nom', (s->>'cols')::int, (s->>'rows')::int,
            (s->>'ici_x')::numeric, (s->>'ici_y')::numeric)
    returning id into new_s;
    v_map := v_map || jsonb_build_object(s->>'id', new_s::text);
  end loop;

  for e in select * from jsonb_array_elements(vp.instantane->'elements') loop
    insert into elements (edition_id, salle_id, kind, x, y, w, h, numero, type_table,
      organisme_edition_id, chaises, mode, zone, categorie_id, sous, label, assigne, etat_terrain, notes)
    values (vp.edition_id, (v_map->>(e->>'salle_id'))::uuid, e->>'kind',
      (e->>'x')::int, (e->>'y')::int, (e->>'w')::int, (e->>'h')::int, e->>'numero', e->>'type_table',
      nullif(e->>'organisme_edition_id','')::uuid, coalesce((e->>'chaises')::int, 0),
      coalesce(e->>'mode','animee'), e->>'zone', nullif(e->>'categorie_id','')::uuid,
      e->>'sous', e->>'label', (e->>'assigne')::boolean,
      coalesce(e->>'etat_terrain','a_installer'), e->>'notes')
    returning id into new_e;
    el_map := el_map || jsonb_build_object(e->>'id', new_e::text);
  end loop;

  for c in select * from jsonb_array_elements(vp.instantane->'creneaux') loop
    insert into creneaux_table (element_id, jour, debut, categorie_id)
    values ((el_map->>(c->>'element_id'))::uuid, c->>'jour', (c->>'debut')::time, (c->>'categorie_id')::uuid);
  end loop;
end $$;

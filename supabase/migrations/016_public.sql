-- 016_public.sql — PlanFest. Pages publiques visiteurs (sans compte) :
-- édition publiée, plan des salles, exposants. Tout en RPC security definer
-- limitées à l'édition dont programme_publie = true. Nécessite 001..015.

-- Édition actuellement publiée (pour entrer sur #/public sans id).
create or replace function public.edition_publiee()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'nom', nom, 'date_samedi', date_samedi)
  from editions where programme_publie limit 1;
$$;
grant execute on function public.edition_publiee() to anon, authenticated;

-- Plan des salles (lecture publique) : salles + éléments, nom/couleur du partenaire.
create or replace function public.plan_public(p_edition uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from editions where id = p_edition and programme_publie) then
    jsonb_build_object(
      'salles', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'nom', s.nom, 'cols', s.cols, 'rows', s.rows,
          'ici_x', s.ici_x, 'ici_y', s.ici_y) order by s.cree_le)
        from salles s where s.edition_id = p_edition), '[]'),
      'elements', coalesce((select jsonb_agg(jsonb_build_object(
          'salle_id', e.salle_id, 'kind', e.kind, 'x', e.x, 'y', e.y, 'w', e.w, 'h', e.h,
          'numero', e.numero, 'type_table', e.type_table, 'mode', e.mode,
          'sous', e.sous, 'label', e.label, 'nom', o.nom, 'couleur', oe.couleur))
        from elements e
        left join organisme_editions oe on oe.id = e.organisme_edition_id
        left join organismes o on o.id = oe.organisme_id
        where e.edition_id = p_edition), '[]'))
    else null end;
$$;
grant execute on function public.plan_public(uuid) to anon, authenticated;

-- Exposants confirmés (boutiques, partenaires, éditeurs, sponsors) + emplacement.
create or replace function public.exposants_public(p_edition uuid)
returns table (nom text, roles text[], couleur text, logo_url text, site text, numeros text)
language sql stable security definer set search_path = public as $$
  select o.nom, oe.roles, oe.couleur, oe.logo_url, o.site,
    (select string_agg(e.numero, ', ' order by e.numero)
       from elements e where e.organisme_edition_id = oe.id and e.numero is not null)
  from organisme_editions oe
  join organismes o on o.id = oe.organisme_id
  join editions ed on ed.id = oe.edition_id and ed.programme_publie
  where oe.edition_id = p_edition and oe.statut = 'confirme' and not o.archive
  order by o.nom;
$$;
grant execute on function public.exposants_public(uuid) to anon, authenticated;

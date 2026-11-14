-- 043_ajouter_organisme.sql — PlanFest
-- Ajouter un organisme à une édition SANS créer de doublon : si un organisme du même nom
-- existe déjà (majuscules, espaces et accents ignorés), il est réutilisé et inscrit sur
-- l'édition (ou reçoit le rôle demandé s'il y est déjà). Sinon il est créé.
-- Sert à « Nouvel organisme » (écran Organismes) et à l'ajout d'un éditeur depuis la
-- fiche d'un jeu (Sélection Jeux, éditeurs proposés par BGG).
-- Corrige au passage la création par un responsable non admin : la lecture de la fiche
-- juste créée lui était refusée (elle n'était encore rattachée à aucune édition).
-- Retour : { organisme_id, organisme_edition_id, existait }.

-- Nom « comparable » : minuscules, sans accents, sans ponctuation ni espaces.
create or replace function public.nom_comparable(p text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(lower(translate(coalesce(p, ''),
    'ÀÂÄÁÃÅàâäáãåÇçÉÈÊËéèêëÎÏÍÌîïíìÔÖÓÒÕôöóòõÛÜÚÙûüúùŸÿÑñ',
    'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuYyNn')), '[^a-z0-9]', '', 'g');
$$;

create or replace function public.ajouter_organisme(
  p_edition uuid, p_nom text, p_roles text[], p_infos jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_oe uuid; v_existait boolean := false; v_roles text[];
begin
  if not peut_ecrire_organisme(p_roles) then raise exception 'acces refuse'; end if;
  if coalesce(btrim(p_nom), '') = '' then raise exception 'nom requis'; end if;
  if not (p_roles <@ array['partenaire','editeur','sponsor']::text[]) then raise exception 'role invalide'; end if;
  if not exists (select 1 from editions where id = p_edition) then raise exception 'edition invalide'; end if;

  select id into v_org from organismes
   where nom_comparable(nom) = nom_comparable(p_nom) and nom_comparable(p_nom) <> ''
   order by cree_le limit 1;
  if v_org is null then
    insert into organismes (nom, site, contact_nom, contact_email)
    values (btrim(p_nom),
            case when p_infos->>'site' ~* '^https?://' then p_infos->>'site' end,
            nullif(btrim(p_infos->>'contact_nom'), ''), nullif(btrim(p_infos->>'contact_email'), ''))
    returning id into v_org;
  else
    v_existait := true;
  end if;

  select id, roles into v_oe, v_roles from organisme_editions
   where organisme_id = v_org and edition_id = p_edition;
  if v_oe is null then
    insert into organisme_editions (organisme_id, edition_id, roles, statut, couleur)
    values (v_org, p_edition, p_roles,
            coalesce(nullif(p_infos->>'statut', ''), 'invite'),
            nullif(p_infos->>'couleur', ''))
    returning id into v_oe;
  else
    update organisme_editions
       set roles = (select array_agg(distinct r) from unnest(v_roles || p_roles) r)
     where id = v_oe;
  end if;
  return jsonb_build_object('organisme_id', v_org, 'organisme_edition_id', v_oe, 'existait', v_existait);
end $$;
revoke all on function public.ajouter_organisme(uuid, text, text[], jsonb) from public, anon;
grant execute on function public.ajouter_organisme(uuid, text, text[], jsonb) to authenticated;

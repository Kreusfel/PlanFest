-- 010_bilan.sql — PlanFest, Phase 5
-- Bilan de l'édition + purge RGPD (purger_edition, effacer_benevole). Admin.
-- Nécessite 001..009.

-- ========================================================================
-- bilan : compteurs + entrées par jour et tranche d'âge (pour écran + CSV)
-- ========================================================================
create or replace function public.bilan(p_edition uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not est_admin() then raise exception 'acces refuse'; end if;
  res := jsonb_build_object(
    'entrees', jsonb_build_object(
      'total', (select count(*) from entrees where edition_id = p_edition),
      'detail', coalesce((
        select jsonb_agg(jsonb_build_object('jour', jour, 'tranche', tranche_age, 'n', n)
                 order by jour, tranche_age)
        from (select jour, tranche_age, count(*)::int n
                from entrees where edition_id = p_edition group by jour, tranche_age) t), '[]')),
    'benevoles', jsonb_build_object(
      'total', (select count(*) from benevoles_editions where edition_id = p_edition and statut <> 'annule'),
      'confirmes', (select count(*) from benevoles_editions where edition_id = p_edition and statut = 'confirme'),
      'animateurs', (select count(*) from benevoles_editions where edition_id = p_edition and est_animateur and statut <> 'annule')),
    'organismes', jsonb_build_object(
      'partenaires_confirmes', (select count(*) from organisme_editions where edition_id = p_edition and 'partenaire' = any (roles) and statut = 'confirme'),
      'editeurs', (select count(*) from organisme_editions where edition_id = p_edition and 'editeur' = any (roles)),
      'sponsors', (select count(*) from organisme_editions where edition_id = p_edition and 'sponsor' = any (roles))),
    'jeux', jsonb_build_object(
      'total', (select count(*) from jeux_editions where edition_id = p_edition),
      'recus', (select count(*) from jeux_editions where edition_id = p_edition and statut = 'recu'),
      'demandes', (select count(*) from jeux_editions where edition_id = p_edition and statut = 'demande')),
    'parties', (select count(*) from parties where edition_id = p_edition));
  return res;
end $$;

-- ========================================================================
-- purger_edition : efface les données nominatives/sensibles d'une édition (RGPD)
-- (régimes, présences, disponibilités). Garde l'édition et ses agrégats.
-- ========================================================================
create or replace function public.purger_edition(p_edition uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'acces refuse'; end if;
  delete from regimes r using benevoles_editions be
    where r.benevole_edition_id = be.id and be.edition_id = p_edition;
  delete from regimes r using organisme_editions oe
    where r.organisme_edition_id = oe.id and oe.edition_id = p_edition;
  delete from presences p using benevoles_editions be
    where p.benevole_edition_id = be.id and be.edition_id = p_edition;
  delete from disponibilites d using benevoles_editions be
    where d.benevole_edition_id = be.id and be.edition_id = p_edition;
end $$;

-- ========================================================================
-- effacer_benevole : droit à l'effacement d'une personne (cascade)
-- ========================================================================
create or replace function public.effacer_benevole(p_benevole uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'acces refuse'; end if;
  delete from benevoles where id = p_benevole;
end $$;

-- 038_bilan_enrichi.sql — PlanFest
-- 1) Subventions : montant demandé et montant accordé (pour savoir ce qu'on a obtenu).
-- 2) Bilan : provenance des visiteurs, buvette (CA, coût, marge), subventions,
--    remplissage des parties, présences des bénévoles, journée du vendredi.
--    Les clés existantes sont conservées (entrees, benevoles, organismes, jeux, parties).
-- Reprend la dernière définition de bilan (010) : même contrôle admin.

alter table public.subventions add column if not exists montant_demande numeric(10,2);
alter table public.subventions add column if not exists montant_accorde numeric(10,2);

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
    'parties', (select count(*) from parties where edition_id = p_edition),

    -- Provenance : par code postal + ville (les 20 premiers), et nombre sans provenance.
    'provenance', jsonb_build_object(
      'detail', coalesce((
        select jsonb_agg(jsonb_build_object('cp', cp, 'ville', ville, 'n', n) order by n desc, ville)
        from (select coalesce(nullif(btrim(code_postal), ''), '?') cp,
                     coalesce(nullif(initcap(btrim(ville)), ''), '?') ville, count(*)::int n
                from entrees where edition_id = p_edition
                 and (nullif(btrim(code_postal), '') is not null or nullif(btrim(ville), '') is not null)
               group by 1, 2 order by n desc limit 20) t), '[]'),
      'sans', (select count(*) from entrees where edition_id = p_edition
                and nullif(btrim(code_postal), '') is null and nullif(btrim(ville), '') is null)),

    'buvette', (select jsonb_build_object(
        'ca', coalesce(sum(qte_vendue * prix_vente), 0),
        'cout', coalesce(sum(qte_achetee * prix_achat), 0),
        'marge', coalesce(sum(qte_vendue * prix_vente) - sum(qte_achetee * prix_achat), 0))
      from buvette_items where edition_id = p_edition),

    'subventions', (select jsonb_build_object(
        'dossiers', count(*),
        'accordees', count(*) filter (where statut = 'accorde'),
        'demande', coalesce(sum(montant_demande), 0),
        'accorde', coalesce(sum(montant_accorde) filter (where statut = 'accorde'), 0))
      from subventions where edition_id = p_edition),

    -- Remplissage : seulement les parties avec un nombre de places.
    'animation', (select jsonb_build_object(
        'parties', count(*),
        'places', coalesce(sum(p.places), 0),
        'inscrits', coalesce(sum(least(coalesce(i.nb, 0), p.places)) filter (where p.places is not null), 0),
        'inscrits_total', coalesce(sum(i.nb), 0))
      from parties p
      left join (select partie_id, sum(nb)::int nb from partie_inscriptions group by partie_id) i on i.partie_id = p.id
      where p.edition_id = p_edition),

    'presences', (select jsonb_build_object(
        'present', count(*) filter (where pr.etat = 'present'),
        'retard', count(*) filter (where pr.etat = 'retard'),
        'absent', count(*) filter (where pr.etat = 'absent'))
      from presences pr join benevoles_editions be on be.id = pr.benevole_edition_id
      where be.edition_id = p_edition),

    'vendredi', (select jsonb_build_object(
        'invites', count(*),
        'confirmes', count(*) filter (where statut in ('confirme', 'venu')),
        'venus', count(*) filter (where statut = 'venu'),
        'personnes', coalesce(sum(effectif) filter (where statut in ('confirme', 'venu')), 0))
      from vendredi_participants where edition_id = p_edition));
  return res;
end $$;

-- 045_droits_poles.sql — PlanFest
-- Revue par pôle : chacun doit pouvoir faire son travail avec les bonnes données.
--  1) animateurs_edition() : qui anime quoi (noms + compétences, sans coordonnées), pour
--     tout compte actif — alerte « sans animateur » juste pour le pôle Jeux et les bénévoles.
--  2) Logistique et Communication lisent les organismes et leurs fiches d'édition
--     (liste de montage, export du plan, exposants, logos). Écriture inchangée.
--  3) maj_logo_organisme() : le pôle Communication saisit les logos (lien http/https).
--  4) Entrées (accueil) : tout compte actif compte et lit les entrées (compteurs anonymes) ;
--     chacun peut annuler SES entrées (« Annuler le dernier groupe » ne supprimait rien).
--  5) confirmer_ma_venue() : un bénévole confirme ou annule sa venue lui-même.
--  6) Sponsors : contreparties (texte) et « contreparties faites ».
--  7) Vendredi intergénérationnel : heure de début et de fin de chaque structure.
--  8) Bilan : lisible par les responsables de pôle (la purge reste réservée aux admins).

-- 1 -----------------------------------------------------------------------------
create or replace function public.animateurs_edition(p_edition uuid)
returns table (benevole_id uuid, nom text, jeu_id uuid, categorie_id uuid, niveau text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not est_actif() then raise exception 'acces refuse'; end if;
  return query
  select b.id, b.nom, c.jeu_id, c.categorie_id, c.niveau
  from benevoles_editions be
  join benevoles b on b.id = be.benevole_id
  join competences c on c.benevole_id = b.id
  where be.edition_id = p_edition and be.statut <> 'annule' and c.niveau <> 'non';
end $$;
revoke all on function public.animateurs_edition(uuid) from public, anon;
grant execute on function public.animateurs_edition(uuid) to authenticated;

-- 2 -----------------------------------------------------------------------------
drop policy if exists orged_lecture_poles on public.organisme_editions;
create policy orged_lecture_poles on public.organisme_editions for select to authenticated
  using (est_responsable('logistique_securite') or est_responsable('communication'));
drop policy if exists organismes_lecture_poles on public.organismes;
create policy organismes_lecture_poles on public.organismes for select to authenticated
  using (est_responsable('logistique_securite') or est_responsable('communication'));

-- 3 -----------------------------------------------------------------------------
create or replace function public.maj_logo_organisme(p_organisme_edition uuid, p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare v_roles text[];
begin
  select roles into v_roles from organisme_editions where id = p_organisme_edition;
  if not found then raise exception 'organisme introuvable'; end if;
  if not (est_admin() or est_responsable('communication') or peut_ecrire_organisme(v_roles)) then
    raise exception 'acces refuse';
  end if;
  if coalesce(btrim(p_url), '') <> '' and p_url !~* '^https?://' then raise exception 'lien invalide (http ou https)'; end if;
  update organisme_editions set logo_url = nullif(btrim(p_url), '') where id = p_organisme_edition;
end $$;
revoke all on function public.maj_logo_organisme(uuid, text) from public, anon;
grant execute on function public.maj_logo_organisme(uuid, text) to authenticated;

-- 4 -----------------------------------------------------------------------------
drop policy if exists entrees_lecture on public.entrees;
drop policy if exists entrees_insert on public.entrees;
drop policy if exists entrees_suppr on public.entrees;
create policy entrees_lecture on public.entrees for select to authenticated using (est_actif());
create policy entrees_insert on public.entrees for insert to authenticated
  with check (est_actif() and (saisi_par is null or saisi_par = (select auth.uid())));
create policy entrees_suppr on public.entrees for delete to authenticated
  using (est_admin() or (est_actif() and saisi_par = (select auth.uid())));

-- 5 -----------------------------------------------------------------------------
create or replace function public.confirmer_ma_venue(p_edition uuid, p_vient boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not est_actif() then raise exception 'acces refuse'; end if;
  update benevoles_editions set statut = case when p_vient then 'confirme' else 'annule' end
   where edition_id = p_edition and benevole_id = benevole_courant();
  if not found then raise exception 'tu n''es pas inscrit sur cette édition'; end if;
end $$;
revoke all on function public.confirmer_ma_venue(uuid, boolean) from public, anon;
grant execute on function public.confirmer_ma_venue(uuid, boolean) to authenticated;

-- 6 -----------------------------------------------------------------------------
alter table public.organisme_editions add column if not exists contreparties text;
alter table public.organisme_editions add column if not exists contreparties_faites boolean not null default false;

-- 7 -----------------------------------------------------------------------------
alter table public.vendredi_participants add column if not exists heure_debut time;
alter table public.vendredi_participants add column if not exists heure_fin time;

-- 8 -----------------------------------------------------------------------------
create or replace function public.bilan(p_edition uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not (est_admin() or (est_actif() and exists (select 1 from responsables_pole where profil_id = auth.uid()))) then
    raise exception 'acces refuse';
  end if;
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

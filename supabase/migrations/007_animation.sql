-- 007_animation.sql — PlanFest, Phase 2
-- Parties (tables Jurande animées), alertes de parties, catégorie effective,
-- repas, régimes, tableau de bord. compétences / besoins_equipes sont déjà en 005.
-- Nécessite 001..006.

-- ========================================================================
-- parties (remplace sessions de la maquette ; réservée aux tables Jurande animées)
-- ========================================================================
create table public.parties (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  element_id uuid not null references public.elements(id) on delete cascade,
  jeu_edition_id uuid references public.jeux_editions(id) on delete set null,
  benevole_edition_id uuid references public.benevoles_editions(id) on delete set null,
  jour text not null check (jour in ('ven','sam','dim')),
  debut time not null,
  duree_min int not null check (duree_min > 0),
  fin time generated always as (debut + make_interval(mins => duree_min)) stored,
  titre text,
  places int,
  version int not null default 1,
  maj_le timestamptz not null default now()
);
create index on public.parties (edition_id, jour);
create index on public.parties (benevole_edition_id, jour);
create trigger t_parties_version before update on public.parties
  for each row execute function public.touch_version();

-- Déclencheur : une partie doit porter sur une table Jurande en mode animee.
create or replace function public.parties_table_jurande() returns trigger
language plpgsql set search_path = public as $$
declare ok boolean;
begin
  select (kind = 'table' and type_table = 'jurande' and mode = 'animee')
    into ok from elements where id = new.element_id;
  if not coalesce(ok, false) then
    raise exception 'Une partie doit être sur une table Jurande animée';
  end if;
  return new;
end $$;
create trigger t_parties_jurande before insert or update on public.parties
  for each row execute function public.parties_table_jurande();

alter table public.parties enable row level security;
create policy parties_lecture on public.parties for select to authenticated using (est_actif());
create policy parties_ecriture on public.parties for all to authenticated
  using (est_admin() or est_responsable('animateurs_benevoles'))
  with check (est_admin() or est_responsable('animateurs_benevoles'));

-- ========================================================================
-- Catégorie effective d'une table à une heure (créneau le plus récent, sinon défaut)
-- ========================================================================
create or replace function public.categorie_effective(p_element uuid, p_jour text, p_heure time)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select categorie_id from creneaux_table
      where element_id = p_element and jour = p_jour and debut <= p_heure
      order by debut desc limit 1),
    (select categorie_id from elements where id = p_element));
$$;

-- ========================================================================
-- Compétence d'un animateur pour un jeu (jeu puis catégorie ; le jeu l'emporte)
-- ========================================================================
create or replace function public.animateur_competent(p_benevole uuid, p_jeu uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select niveau = 'anime' from competences
      where benevole_id = p_benevole and jeu_id = p_jeu),
    (select c.niveau = 'anime' from competences c
       join jeux j on j.categorie_id = c.categorie_id
      where c.benevole_id = p_benevole and j.id = p_jeu),
    false);
$$;

-- ========================================================================
-- alertes_parties (une ligne par problème ; ne bloque pas l'enregistrement)
-- ========================================================================
create or replace view public.alertes_parties with (security_invoker = true) as
  select p.edition_id, p.id as partie_id, 'sans_animateur'::text as code
    from parties p where p.benevole_edition_id is null
  union all
  select p.edition_id, p.id, 'sans_competence'
    from parties p
    join benevoles_editions be on be.id = p.benevole_edition_id
    join jeux_editions je on je.id = p.jeu_edition_id
   where not animateur_competent(be.benevole_id, je.jeu_id)
  union all
  select a.edition_id, a.id, 'double_attribution'
    from parties a join parties b
      on a.benevole_edition_id = b.benevole_edition_id and a.id <> b.id
     and a.jour = b.jour and a.debut < b.fin and b.debut < a.fin
   where a.benevole_edition_id is not null
  union all
  select a.edition_id, a.id, 'table_chevauchement'
    from parties a join parties b
      on a.element_id = b.element_id and a.id <> b.id
     and a.jour = b.jour and a.debut < b.fin and b.debut < a.fin
  union all
  select p.edition_id, p.id, 'places'
    from parties p join elements e on e.id = p.element_id
   where p.places is not null and p.places > e.chaises
  union all
  select p.edition_id, p.id, 'jeu_hors_categorie'
    from parties p join jeux_editions je on je.id = p.jeu_edition_id
    join jeux j on j.id = je.jeu_id
   where j.categorie_id is not null
     and j.categorie_id <> categorie_effective(p.element_id, p.jour, p.debut)
  union all
  select p.edition_id, p.id, 'exemplaires'
    from parties p join jeux_editions je on je.id = p.jeu_edition_id
   where p.jeu_edition_id is not null and (
     select count(*) from parties q
      where q.jeu_edition_id = p.jeu_edition_id and q.jour = p.jour
        and q.debut < p.fin and p.debut < q.fin) > je.exemplaires
  union all
  select p.edition_id, p.id, 'indisponible'
    from parties p
    join editions e on e.id = p.edition_id
   where p.benevole_edition_id is not null and (
     (p.debut < e.limite_matin and not exists (
        select 1 from disponibilites d where d.benevole_edition_id = p.benevole_edition_id
          and d.jour = p.jour and d.demi_journee = 'matin' and d.disponible))
     or (p.fin > e.limite_matin and not exists (
        select 1 from disponibilites d where d.benevole_edition_id = p.benevole_edition_id
          and d.jour = p.jour and d.demi_journee = 'aprem' and d.disponible)));
-- note : code 'pause_repas' non implémenté (logique d'intervalles) — à ajouter si besoin.

-- ========================================================================
-- repas_par_jour (§6) : partenaires confirmés + bénévoles ayant coché le repas
-- ========================================================================
create or replace function public.repas_par_jour(
  p_edition uuid, p_inclure_non_confirmes boolean default false)
returns table (j_code text, nb_partenaires int, nb_benevoles int, nb_total int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (est_admin() or est_responsable('buvette_catering')) then
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

-- ========================================================================
-- liste_regimes : régimes des personnes présentes un jour donné
-- ========================================================================
create or replace function public.liste_regimes(p_edition uuid, p_jour text)
returns table (source text, nom text, texte text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (est_admin() or est_responsable('buvette_catering')) then
    raise exception 'acces refuse';
  end if;
  return query
  select 'benevole'::text, b.nom, r.texte
    from regimes r
    join benevoles_editions be on be.id = r.benevole_edition_id
    join benevoles b on b.id = be.benevole_id
   where be.edition_id = p_edition and be.statut <> 'annule'
     and case p_jour when 'sam' then be.repas_sam when 'dim' then be.repas_dim else false end
  union all
  select 'organisme'::text, o.nom, r.texte
    from regimes r
    join organisme_editions oe on oe.id = r.organisme_edition_id
    join organismes o on o.id = oe.organisme_id
   where oe.edition_id = p_edition and 'partenaire' = any (oe.roles) and oe.statut = 'confirme'
     and case p_jour when 'sam' then oe.personnes_sam > 0 when 'dim' then oe.personnes_dim > 0 else false end;
end $$;

-- ========================================================================
-- tableau_de_bord : compteurs par pôle, limités aux pôles de l'appelant
-- ========================================================================
create or replace function public.tableau_de_bord(p_edition uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb := '{}';
begin
  if not est_actif() then raise exception 'acces refuse'; end if;

  if est_admin() or est_responsable('partenaires') then
    res := res || jsonb_build_object('partenaires', jsonb_build_object(
      'confirmes', (select count(*) from organisme_editions where edition_id = p_edition and 'partenaire' = any (roles) and statut = 'confirme'),
      'a_relancer', (select count(*) from organisme_editions where edition_id = p_edition and 'partenaire' = any (roles) and statut in ('invite','relance')),
      'tables_non_attribuees', (select count(*) from elements where edition_id = p_edition and kind = 'table' and type_table = 'non_attribuee')));
  end if;
  if est_admin() or est_responsable('jeux_editeurs') then
    res := res || jsonb_build_object('jeux_editeurs', jsonb_build_object(
      'editeurs_sans_reponse', (select count(*) from organisme_editions where edition_id = p_edition and 'editeur' = any (roles) and statut in ('invite','relance')),
      'jeux_demandes', (select count(*) from jeux_editions where edition_id = p_edition and statut = 'demande'),
      'jeux_recus', (select count(*) from jeux_editions where edition_id = p_edition and statut = 'recu')));
  end if;
  if est_admin() or est_responsable('sponsors') then
    res := res || jsonb_build_object('sponsors', jsonb_build_object(
      'dossiers_attente', (select count(*) from subventions where edition_id = p_edition and statut in ('a_faire','depose')),
      'echeances_30j', (select count(*) from subventions where edition_id = p_edition and statut in ('a_faire','depose') and echeance between current_date and current_date + 30)));
  end if;
  if est_admin() or est_responsable('logistique_securite') then
    res := res || jsonb_build_object('logistique_securite', jsonb_build_object(
      'tables_non_attribuees', (select count(*) from elements where edition_id = p_edition and kind = 'table' and type_table = 'non_attribuee'),
      'tables_non_verifiees', (select count(*) from elements where edition_id = p_edition and kind = 'table' and etat_terrain <> 'verifiee')));
  end if;
  if est_admin() or est_responsable('buvette_catering') then
    res := res || jsonb_build_object('buvette_catering',
      coalesce((select jsonb_object_agg(j_code, nb_total) from repas_par_jour(p_edition, true)), '{}'::jsonb));
  end if;
  if est_admin() or est_responsable('animateurs_benevoles') then
    res := res || jsonb_build_object('animateurs_benevoles', jsonb_build_object(
      'benevoles', (select count(*) from benevoles_editions where edition_id = p_edition and statut <> 'annule'),
      'confirmes', (select count(*) from benevoles_editions where edition_id = p_edition and statut = 'confirme'),
      'animateurs', (select count(*) from benevoles_editions where edition_id = p_edition and est_animateur and statut <> 'annule'),
      'alertes', (select count(*) from alertes_parties where edition_id = p_edition)));
  end if;
  if est_admin() or est_responsable('communication') then
    res := res || jsonb_build_object('communication', jsonb_build_object(
      'confirmes_sans_logo', (select count(*) from organisme_editions where edition_id = p_edition and statut = 'confirme' and (logo_url is null or logo_url = '')),
      'programme_publie', (select programme_publie from editions where id = p_edition)));
  end if;
  if est_admin() or est_responsable('intergenerationnelle') then
    res := res || jsonb_build_object('intergenerationnelle', jsonb_build_object(
      'benevoles_vendredi', (select count(distinct be.id) from benevoles_editions be
        join disponibilites d on d.benevole_edition_id = be.id
        where be.edition_id = p_edition and d.jour = 'ven' and d.disponible)));
  end if;
  return res;
end $$;

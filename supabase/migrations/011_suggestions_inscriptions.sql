-- 011_suggestions_inscriptions.sql — PlanFest, Phase 3 (reliquat) + Phase 1 (reliquat)
-- Suggestions d'animateurs + formulaires publics (inscriptions) et leur intégration.
-- Nécessite 001..010.

-- ========================================================================
-- suggestions_animateurs(p_partie) : candidats compétents, disponibles, sans conflit
-- ========================================================================
create or replace function public.suggestions_animateurs(p_partie uuid)
returns table (benevole_edition_id uuid, nom text, competent boolean, raison text)
language plpgsql stable security definer set search_path = public as $$
declare pr parties%rowtype; e editions%rowtype; v_jeu uuid;
begin
  if not (est_admin() or est_responsable('animateurs_benevoles')) then raise exception 'acces refuse'; end if;
  select * into pr from parties where id = p_partie;
  if not found then return; end if;
  select * into e from editions where id = pr.edition_id;
  select jeu_id into v_jeu from jeux_editions where id = pr.jeu_edition_id;
  return query
  select be.id, b.nom,
         (v_jeu is not null and animateur_competent(b.id, v_jeu)) as competent,
         case when v_jeu is not null and animateur_competent(b.id, v_jeu)
              then 'Compétent et disponible' else 'Disponible (à former sur ce jeu)' end
  from benevoles_editions be
  join benevoles b on b.id = be.benevole_id
  where be.edition_id = pr.edition_id and be.est_animateur and be.statut <> 'annule'
    and not (
      (pr.debut < e.limite_matin and not exists (select 1 from disponibilites d
        where d.benevole_edition_id = be.id and d.jour = pr.jour and d.demi_journee = 'matin' and d.disponible))
      or (pr.fin > e.limite_matin and not exists (select 1 from disponibilites d
        where d.benevole_edition_id = be.id and d.jour = pr.jour and d.demi_journee = 'aprem' and d.disponible)))
    and not exists (select 1 from parties q where q.benevole_edition_id = be.id and q.id <> pr.id
      and q.jour = pr.jour and q.debut < pr.fin and pr.debut < q.fin)
  order by competent desc, b.nom;
end $$;

-- ========================================================================
-- inscriptions publiques (zone d'arrivée des formulaires ; §5)
-- _hp = champ piège (honeypot) ; payload limité en taille.
-- ========================================================================
create table public.inscriptions_partenaires (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid references public.editions(id) on delete cascade,
  recu_le timestamptz not null default now(),
  payload jsonb not null,
  traitee boolean not null default false,
  check (coalesce(payload->>'_hp', '') = '' and length(payload::text) < 8000)
);
create table public.inscriptions_benevoles (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid references public.editions(id) on delete cascade,
  recu_le timestamptz not null default now(),
  payload jsonb not null,
  traitee boolean not null default false,
  check (coalesce(payload->>'_hp', '') = '' and length(payload::text) < 8000)
);

alter table public.inscriptions_partenaires enable row level security;
alter table public.inscriptions_benevoles   enable row level security;

-- Anonyme : insertion seulement, jamais de lecture.
grant insert on public.inscriptions_partenaires to anon, authenticated;
grant insert on public.inscriptions_benevoles   to anon, authenticated;
create policy insc_part_insert on public.inscriptions_partenaires for insert to anon, authenticated with check (true);
create policy insc_benv_insert on public.inscriptions_benevoles   for insert to anon, authenticated with check (true);
-- Lecture / traitement : pôle concerné + admin.
create policy insc_part_gere on public.inscriptions_partenaires for all to authenticated
  using (est_admin() or est_responsable('partenaires'))
  with check (est_admin() or est_responsable('partenaires'));
create policy insc_benv_gere on public.inscriptions_benevoles for all to authenticated
  using (est_admin() or est_responsable('animateurs_benevoles'))
  with check (est_admin() or est_responsable('animateurs_benevoles'));

-- ========================================================================
-- Intégration d'une inscription : crée la fiche et marque traitée
-- ========================================================================
create or replace function public.integrer_inscription_partenaire(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare ins inscriptions_partenaires%rowtype; v_org uuid; v_oe uuid;
begin
  if not (est_admin() or est_responsable('partenaires')) then raise exception 'acces refuse'; end if;
  select * into ins from inscriptions_partenaires where id = p_id;
  if not found then raise exception 'inscription introuvable'; end if;
  insert into organismes (nom, site, contact_nom, contact_email, contact_tel, notes)
  values (coalesce(ins.payload->>'nom', 'Sans nom'), ins.payload->>'site',
          ins.payload->>'contact', ins.payload->>'email', ins.payload->>'tel', ins.payload->>'notes')
  returning id into v_org;
  insert into organisme_editions (organisme_id, edition_id, roles, statut,
    personnes_sam, personnes_dim, tables_souhaitees)
  values (v_org, ins.edition_id, array['partenaire']::text[], 'invite',
    coalesce((ins.payload->>'personnes_sam')::int, 0),
    coalesce((ins.payload->>'personnes_dim')::int, 0),
    coalesce((ins.payload->>'tables')::int, 0))
  returning id into v_oe;
  update inscriptions_partenaires set traitee = true where id = p_id;
  return v_oe;
end $$;

create or replace function public.integrer_inscription_benevole(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare ins inscriptions_benevoles%rowtype; v_b uuid; v_be uuid;
begin
  if not (est_admin() or est_responsable('animateurs_benevoles')) then raise exception 'acces refuse'; end if;
  select * into ins from inscriptions_benevoles where id = p_id;
  if not found then raise exception 'inscription introuvable'; end if;
  insert into benevoles (nom, email, telephone, consentement_le)
  values (coalesce(ins.payload->>'nom', 'Sans nom'), ins.payload->>'email', ins.payload->>'tel', now())
  returning id into v_b;
  insert into benevoles_editions (benevole_id, edition_id, equipes)
  values (v_b, ins.edition_id,
    coalesce(string_to_array(nullif(ins.payload->>'equipes', ''), ','), '{}')::text[])
  returning id into v_be;
  update inscriptions_benevoles set traitee = true where id = p_id;
  return v_be;
end $$;

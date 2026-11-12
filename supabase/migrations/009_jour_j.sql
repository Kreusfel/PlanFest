-- 009_jour_j.sql — PlanFest, Phase 4
-- Jour J : entrées (comptage, sans nominatif), présences des bénévoles,
-- signaler (retard/absence), maj_etat_terrain. Nécessite 001..008.

-- ========================================================================
-- entrees : comptage anonyme. id généré par le CLIENT (idempotence hors-ligne).
-- Une seule entrée (pas de dimension lieu). Tranches = celles des jeux.
-- ========================================================================
create table public.entrees (
  id uuid primary key,
  edition_id uuid not null references public.editions(id) on delete cascade,
  jour text not null check (jour in ('ven','sam','dim')),
  tranche_age text not null check (tranche_age in ('3+','6+','8+','13+','adulte')),
  saisi_le timestamptz not null default now(),
  saisi_par uuid references public.profils(id) on delete set null
);
create index on public.entrees (edition_id, jour);

alter table public.entrees enable row level security;
-- lecture / insertion : admin ou bénévole de l'équipe « accueil » ; jamais de modif/suppression
create policy entrees_lecture on public.entrees for select to authenticated
  using (est_admin() or a_equipe(edition_id, 'accueil'));
create policy entrees_insert on public.entrees for insert to authenticated
  with check (est_admin() or a_equipe(edition_id, 'accueil'));

-- ========================================================================
-- presences : pointage et signalements du jour J (une ligne par bénévole et jour)
-- ========================================================================
create table public.presences (
  id uuid primary key default gen_random_uuid(),
  benevole_edition_id uuid not null references public.benevoles_editions(id) on delete cascade,
  jour text not null check (jour in ('ven','sam','dim')),
  etat text not null default 'attendu' check (etat in ('attendu','present','absent','retard')),
  signale_le timestamptz,
  commentaire text,
  unique (benevole_edition_id, jour)
);
alter table public.presences enable row level security;
create policy presences_lecture on public.presences for select to authenticated
  using (gere_benevoles() or exists (
    select 1 from benevoles_editions be where be.id = benevole_edition_id
      and be.benevole_id = benevole_courant()));
create policy presences_ecriture on public.presences for all to authenticated
  using (gere_benevoles()) with check (gere_benevoles());

-- ========================================================================
-- signaler : un bénévole enregistre son propre retard / absence / présence
-- ========================================================================
create or replace function public.signaler(
  p_edition uuid, p_jour text, p_etat text, p_commentaire text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_be uuid;
begin
  if p_etat not in ('present','absent','retard') then raise exception 'etat invalide'; end if;
  select id into v_be from benevoles_editions
   where benevole_id = benevole_courant() and edition_id = p_edition;
  if v_be is null then raise exception 'non inscrit sur cette édition'; end if;
  insert into presences (benevole_edition_id, jour, etat, signale_le, commentaire)
  values (v_be, p_jour, p_etat, now(), p_commentaire)
  on conflict (benevole_edition_id, jour)
    do update set etat = excluded.etat, signale_le = now(), commentaire = excluded.commentaire;
end $$;

-- ========================================================================
-- maj_etat_terrain : marquer une table installée / vérifiée (tout responsable, admin)
-- ========================================================================
create or replace function public.maj_etat_terrain(p_element uuid, p_etat text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_etat not in ('a_installer','installee','verifiee') then raise exception 'etat invalide'; end if;
  if not (est_admin() or exists (select 1 from responsables_pole where profil_id = auth.uid())) then
    raise exception 'acces refuse';
  end if;
  update elements set etat_terrain = p_etat where id = p_element and kind = 'table';
end $$;

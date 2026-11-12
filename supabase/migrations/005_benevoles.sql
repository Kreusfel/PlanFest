-- 005_benevoles.sql — PlanFest, Phase 1
-- Bénévoles persistants + déclinaison par édition, disponibilités, compétences,
-- besoins d'équipe, régimes. Fonctions benevole_courant()/a_equipe(), liaison
-- invitation→bénévole. RLS §5. Nécessite 001..004.

-- ========================================================================
-- benevoles (la personne, persistante)
-- ========================================================================
create table public.benevoles (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid unique references public.profils(id) on delete set null,
  nom text not null,
  email text,
  telephone text,
  consentement_le timestamptz,
  recontacter boolean not null default false,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create trigger t_benevoles_maj before update on public.benevoles
  for each row execute function public.touch_maj();

-- ========================================================================
-- benevoles_editions
-- ========================================================================
create table public.benevoles_editions (
  id uuid primary key default gen_random_uuid(),
  benevole_id uuid not null references public.benevoles(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  equipes text[] not null default '{}',
  est_animateur boolean not null default false,
  statut text not null default 'inscrit' check (statut in ('inscrit','confirme','annule')),
  repas_sam boolean not null default false,
  repas_dim boolean not null default false,
  notes text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (benevole_id, edition_id)
);
create index on public.benevoles_editions (edition_id);
create trigger t_bened_maj before update on public.benevoles_editions
  for each row execute function public.touch_maj();

-- ========================================================================
-- disponibilites (par demi-journée)
-- ========================================================================
create table public.disponibilites (
  benevole_edition_id uuid not null references public.benevoles_editions(id) on delete cascade,
  jour text not null check (jour in ('ven','sam','dim')),
  demi_journee text not null check (demi_journee in ('matin','aprem')),
  disponible boolean not null default true,
  primary key (benevole_edition_id, jour, demi_journee)
);

-- ========================================================================
-- competences (cible = catégorie OU jeu, exactement une)
-- ========================================================================
create table public.competences (
  id uuid primary key default gen_random_uuid(),
  benevole_id uuid not null references public.benevoles(id) on delete cascade,
  categorie_id uuid references public.categories_jeux(id) on delete cascade,
  jeu_id uuid references public.jeux(id) on delete cascade,
  niveau text not null check (niveau in ('anime','apprendre','non')),
  check ((categorie_id is null) <> (jeu_id is null))
);
create unique index competences_cat on public.competences (benevole_id, categorie_id) where categorie_id is not null;
create unique index competences_jeu on public.competences (benevole_id, jeu_id) where jeu_id is not null;

-- ========================================================================
-- besoins_equipes (effectif requis par équipe et demi-journée)
-- ========================================================================
create table public.besoins_equipes (
  edition_id uuid not null references public.editions(id) on delete cascade,
  equipe text not null,
  jour text not null check (jour in ('ven','sam','dim')),
  demi_journee text not null check (demi_journee in ('matin','aprem')),
  nombre_requis int not null default 0,
  primary key (edition_id, equipe, jour, demi_journee)
);

-- ========================================================================
-- regimes (isolés pour restreindre l'accès ; exactement une des deux références)
-- ========================================================================
create table public.regimes (
  id uuid primary key default gen_random_uuid(),
  benevole_edition_id uuid references public.benevoles_editions(id) on delete cascade,
  organisme_edition_id uuid references public.organisme_editions(id) on delete cascade,
  texte text not null,
  check ((benevole_edition_id is null) <> (organisme_edition_id is null))
);

-- ========================================================================
-- Fonctions d'aide (remplacent le stub de 001)
-- ========================================================================
create or replace function public.benevole_courant() returns uuid
language sql stable security definer set search_path = public as $$
  select id from benevoles where profil_id = auth.uid();
$$;

create or replace function public.a_equipe(p_edition uuid, p_equipe text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from benevoles_editions be
    where be.benevole_id = benevole_courant() and be.edition_id = p_edition
      and be.statut <> 'annule' and p_equipe = any (be.equipes));
$$;

-- ========================================================================
-- Liaison invitation→bénévole : étend creer_profil (001) pour rattacher le
-- bénévole éventuellement désigné par l'invitation.
-- ========================================================================
create or replace function public.creer_profil() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invitations%rowtype;
begin
  select * into inv from invitations
   where lower(email) = lower(new.email) and utilisee_le is null;
  insert into profils (id, email, nom, role, actif)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'nom', new.email),
          coalesce(inv.role, 'membre'), inv.email is not null);
  if inv.email is not null then
    insert into responsables_pole (profil_id, pole_id)
      select new.id, unnest(inv.pole_ids) on conflict do nothing;
    if inv.benevole_id is not null then
      update benevoles set profil_id = new.id where id = inv.benevole_id;
    end if;
    update invitations set utilisee_le = now() where email = inv.email;
  end if;
  return new;
end $$;

-- FK d'invitations.benevole_id (différée de 001)
alter table public.invitations
  add constraint invitations_benevole_fk
  foreign key (benevole_id) references public.benevoles(id) on delete set null;

-- ========================================================================
-- RLS (§5)
-- ========================================================================
alter table public.benevoles          enable row level security;
alter table public.benevoles_editions enable row level security;
alter table public.disponibilites     enable row level security;
alter table public.competences        enable row level security;
alter table public.besoins_equipes    enable row level security;
alter table public.regimes            enable row level security;

-- helpers de lecture
create or replace function public.gere_benevoles() returns boolean
language sql stable security definer set search_path = public as $$
  select est_admin() or est_responsable('animateurs_benevoles');
$$;

-- benevoles : soi-même ou gestionnaires
create policy benevoles_acces on public.benevoles for all to authenticated
  using (profil_id = (select auth.uid()) or gere_benevoles())
  with check (profil_id = (select auth.uid()) or gere_benevoles());

-- benevoles_editions : la personne concernée ou gestionnaires
create policy bened_acces on public.benevoles_editions for all to authenticated
  using (gere_benevoles() or benevole_id = benevole_courant())
  with check (gere_benevoles() or benevole_id = benevole_courant());

-- disponibilites : via le bénévole concerné
create policy dispo_acces on public.disponibilites for all to authenticated
  using (gere_benevoles() or exists (
    select 1 from benevoles_editions be where be.id = benevole_edition_id
      and be.benevole_id = benevole_courant()))
  with check (gere_benevoles() or exists (
    select 1 from benevoles_editions be where be.id = benevole_edition_id
      and be.benevole_id = benevole_courant()));

-- competences : soi-même ou gestionnaires (admin en écriture pour autrui)
create policy comp_lecture on public.competences for select to authenticated
  using (gere_benevoles() or benevole_id = benevole_courant());
create policy comp_self on public.competences for all to authenticated
  using (benevole_id = benevole_courant() or est_admin())
  with check (benevole_id = benevole_courant() or est_admin());

-- besoins_equipes : admin + responsables animateurs/buvette (lecture), écriture admin/animateurs
create policy besoins_lecture on public.besoins_equipes for select to authenticated
  using (est_admin() or est_responsable('animateurs_benevoles') or est_responsable('buvette_catering'));
create policy besoins_ecriture on public.besoins_equipes for all to authenticated
  using (est_admin() or est_responsable('animateurs_benevoles'))
  with check (est_admin() or est_responsable('animateurs_benevoles'));

-- regimes : les siens, admin, ou responsable buvette_catering
create policy regimes_acces on public.regimes for all to authenticated
  using (est_admin() or est_responsable('buvette_catering') or exists (
    select 1 from benevoles_editions be where be.id = benevole_edition_id
      and be.benevole_id = benevole_courant()))
  with check (est_admin() or est_responsable('buvette_catering') or exists (
    select 1 from benevoles_editions be where be.id = benevole_edition_id
      and be.benevole_id = benevole_courant()));

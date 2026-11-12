-- 001_socle.sql — PlanFest, Phase 0
-- Socle : profils, pôles, responsables, invitations, éditions, catégories,
-- fonctions d'aide, déclencheur de création de profil, RLS.
-- Conventions : snake_case sans accents, uuid, timestamptz, énums = text + check.

-- ========================================================================
-- Déclencheurs communs (maj_le, version)
-- ========================================================================
create or replace function public.touch_maj() returns trigger
language plpgsql as $$
begin new.maj_le := now(); return new; end $$;

create or replace function public.touch_version() returns trigger
language plpgsql as $$
begin
  new.maj_le := now();
  if tg_op = 'UPDATE' then new.version := old.version + 1; end if;
  return new;
end $$;

-- ========================================================================
-- profils (1 par compte ; id = auth.users.id)
-- ========================================================================
create table public.profils (
  id uuid primary key references auth.users(id) on delete cascade,
  nom text not null default '',
  email text not null,
  role text not null default 'membre' check (role in ('admin','membre')),
  actif boolean not null default false,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create trigger t_profils_maj before update on public.profils
  for each row execute function public.touch_maj();

-- ========================================================================
-- poles (8 lignes de départ, modifiables)
-- ========================================================================
create table public.poles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in (
    'jeux_editeurs','partenaires','animateurs_benevoles','buvette_catering',
    'communication','sponsors','logistique_securite','intergenerationnelle')),
  nom text not null,
  ordre int not null default 0
);
insert into public.poles (code, nom, ordre) values
  ('jeux_editeurs','Jeux et éditeurs',1),
  ('partenaires','Partenaires',2),
  ('animateurs_benevoles','Animateurs et bénévoles',3),
  ('buvette_catering','Buvette et catering',4),
  ('communication','Communication',5),
  ('sponsors','Sponsors',6),
  ('logistique_securite','Logistique et sécurité',7),
  ('intergenerationnelle','Intergénérationnelle',8);

-- ========================================================================
-- responsables_pole (un responsable peut avoir plusieurs pôles)
-- ========================================================================
create table public.responsables_pole (
  profil_id uuid not null references public.profils(id) on delete cascade,
  pole_id uuid not null references public.poles(id) on delete cascade,
  primary key (profil_id, pole_id)
);

-- ========================================================================
-- invitations (pas d'inscription libre : voir §5)
-- benevole_id : la FK vers benevoles sera ajoutée en 005
-- ========================================================================
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null default 'membre' check (role in ('admin','membre')),
  pole_ids uuid[] not null default '{}',
  benevole_id uuid,
  utilisee_le timestamptz,
  cree_le timestamptz not null default now()
);

-- ========================================================================
-- editions
-- ========================================================================
create table public.editions (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  date_samedi date not null,
  jours_actifs text[] not null default '{sam,dim}',
  etat text not null default 'preparation'
    check (etat in ('preparation','figee','cloturee')),
  programme_publie boolean not null default false,
  pause_repas_min int not null default 45,
  fenetre_repas_debut time not null default '11:30',
  fenetre_repas_fin time not null default '14:30',
  limite_matin time not null default '13:00',
  ouverture_debut time,                 -- §6 : à définir
  ouverture_fin time,                   -- §6 : à définir
  edition_source_id uuid references public.editions(id) on delete set null,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create trigger t_editions_maj before update on public.editions
  for each row execute function public.touch_maj();
-- une seule édition publiée à la fois (§10)
create unique index editions_une_publiee
  on public.editions (programme_publie) where programme_publie;

-- ========================================================================
-- categories_jeux (12 lignes de départ — À VALIDER avec Romain)
-- ========================================================================
create table public.categories_jeux (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  type text not null check (type in ('age','niveau','format')),
  ordre int not null default 0
);
insert into public.categories_jeux (nom, type, ordre) values
  ('Enfant 3+','age',1), ('Enfant 6+','age',2), ('Enfant 8+','age',3),
  ('Familial','niveau',4), ('Initié','niveau',5), ('Expert','niveau',6),
  ('Ambiance','format',7), ('Stratégie','format',8), ('Coopératif','format',9),
  ('Party','format',10), ('Deck-building','format',11), ('Enquête','format',12);

-- ========================================================================
-- Fonctions d'aide (§5)
-- ========================================================================
create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profils where id = auth.uid() and role = 'admin');
$$;

create or replace function public.est_responsable(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from responsables_pole rp join poles p on p.id = rp.pole_id
    where rp.profil_id = auth.uid() and p.code = p_code);
$$;

create or replace function public.est_actif() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profils where id = auth.uid() and actif);
$$;

-- benevole_courant() et a_equipe() dépendent de benevoles (005) :
-- stub provisoire, remplacé en 005.
create or replace function public.benevole_courant() returns uuid
language sql stable security definer set search_path = public as $$
  select null::uuid;
$$;

-- ========================================================================
-- Déclencheur de création de profil (§5)
-- (La liaison du benevole_id sera ajoutée en 005.)
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
    update invitations set utilisee_le = now() where email = inv.email;
  end if;
  return new;
end $$;

drop trigger if exists sur_nouvel_utilisateur on auth.users;
create trigger sur_nouvel_utilisateur after insert on auth.users
  for each row execute function public.creer_profil();

-- Empêche un non-admin de s'octroyer un rôle ou de s'activer lui-même
create or replace function public.profils_garde() returns trigger
language plpgsql as $$
begin
  if not est_admin() then
    if new.role is distinct from old.role or new.actif is distinct from old.actif then
      raise exception 'Modification du rôle ou du statut réservée aux admins';
    end if;
  end if;
  return new;
end $$;
create trigger t_profils_garde before update on public.profils
  for each row execute function public.profils_garde();

-- ========================================================================
-- RLS (§5)
-- ========================================================================
alter table public.profils            enable row level security;
alter table public.poles              enable row level security;
alter table public.responsables_pole  enable row level security;
alter table public.invitations        enable row level security;
alter table public.editions           enable row level security;
alter table public.categories_jeux    enable row level security;

-- profils : soi-même ou admin en lecture ; soi-même (sauf role/actif, cf. garde) et admin en écriture
create policy profils_select on public.profils for select to authenticated
  using (id = (select auth.uid()) or est_admin());
create policy profils_self on public.profils for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profils_admin on public.profils for all to authenticated
  using (est_admin()) with check (est_admin());

-- poles / categories_jeux / editions : lecture connecté actif, écriture admin
create policy poles_lecture on public.poles for select to authenticated using (est_actif());
create policy poles_ecriture on public.poles for all to authenticated
  using (est_admin()) with check (est_admin());

create policy cat_lecture on public.categories_jeux for select to authenticated using (est_actif());
create policy cat_ecriture on public.categories_jeux for all to authenticated
  using (est_admin()) with check (est_admin());

create policy editions_lecture on public.editions for select to authenticated using (est_actif());
create policy editions_ecriture on public.editions for all to authenticated
  using (est_admin()) with check (est_admin());

-- responsables_pole : soi-même ou admin en lecture ; admin en écriture
create policy resp_select on public.responsables_pole for select to authenticated
  using (profil_id = (select auth.uid()) or est_admin());
create policy resp_ecriture on public.responsables_pole for all to authenticated
  using (est_admin()) with check (est_admin());

-- invitations : admin (tout) ; responsable animateurs_benevoles peut créer une invitation 'membre'
create policy inv_admin on public.invitations for all to authenticated
  using (est_admin()) with check (est_admin());
create policy inv_resp_membre on public.invitations for insert to authenticated
  with check (est_responsable('animateurs_benevoles') and role = 'membre');

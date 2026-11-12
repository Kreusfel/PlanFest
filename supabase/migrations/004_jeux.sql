-- 004_jeux.sql — PlanFest, Phase 1
-- Jeux (persistants, éventuellement liés à BGG plus tard) + leur déclinaison par édition.
-- Import BGG (Edge Function bgg-import) différé : saisie manuelle pour l'instant.
-- Étend dupliquer_edition. Nécessite 001 + 002 + 003.

-- ========================================================================
-- jeux (persistant ; une catégorie principale, un éditeur = un organisme)
-- ========================================================================
create table public.jeux (
  id uuid primary key default gen_random_uuid(),
  bgg_id int unique,
  titre text not null,
  annee int,
  image_url text,
  miniature_url text,
  joueurs_min int,
  joueurs_max int,
  duree_min int,
  age_min int,
  categorie_id uuid references public.categories_jeux(id) on delete set null,
  editeur_id uuid references public.organismes(id) on delete set null,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create trigger t_jeux_maj before update on public.jeux
  for each row execute function public.touch_maj();

-- ========================================================================
-- jeux_editions (statut et usage pour une édition donnée)
-- ========================================================================
create table public.jeux_editions (
  id uuid primary key default gen_random_uuid(),
  jeu_id uuid not null references public.jeux(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  statut text not null default 'souhaite'
    check (statut in ('souhaite','demande','recu','deja_asso')),
  usage text not null default 'animation'
    check (usage in ('animation','tournoi','tombola')),
  exemplaires int not null default 1,
  emplacement text,
  notes text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (jeu_id, edition_id)
);
create index on public.jeux_editions (edition_id);
create trigger t_jeuxed_maj before update on public.jeux_editions
  for each row execute function public.touch_maj();

-- ========================================================================
-- RLS (§5 : lecture connecté actif ; écriture admin + responsable jeux_editeurs)
-- ========================================================================
alter table public.jeux          enable row level security;
alter table public.jeux_editions enable row level security;

create policy jeux_lecture on public.jeux for select to authenticated using (est_actif());
create policy jeux_ecriture on public.jeux for all to authenticated
  using (est_admin() or est_responsable('jeux_editeurs'))
  with check (est_admin() or est_responsable('jeux_editeurs'));

create policy jeuxed_lecture on public.jeux_editions for select to authenticated using (est_actif());
create policy jeuxed_ecriture on public.jeux_editions for all to authenticated
  using (est_admin() or est_responsable('jeux_editeurs'))
  with check (est_admin() or est_responsable('jeux_editeurs'));

-- ========================================================================
-- dupliquer_edition (extension) : copie aussi les jeux (statut souhaite, sauf deja_asso).
-- ========================================================================
create or replace function public.dupliquer_edition(
  p_source uuid, p_nom text, p_date_samedi date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_new uuid; v_map jsonb := '{}'; r record; v_ns uuid;
begin
  if not est_admin() then raise exception 'acces refuse'; end if;

  insert into editions (
    nom, date_samedi, jours_actifs, pause_repas_min, fenetre_repas_debut,
    fenetre_repas_fin, limite_matin, ouverture_debut, ouverture_fin,
    edition_source_id, etat, programme_publie)
  select p_nom, p_date_samedi, jours_actifs, pause_repas_min, fenetre_repas_debut,
         fenetre_repas_fin, limite_matin, ouverture_debut, ouverture_fin,
         p_source, 'preparation', false
  from editions where id = p_source
  returning id into v_new;

  for r in select * from salles where edition_id = p_source loop
    insert into salles (edition_id, nom, cols, rows, ici_x, ici_y)
    values (v_new, r.nom, r.cols, r.rows, r.ici_x, r.ici_y)
    returning id into v_ns;
    v_map := v_map || jsonb_build_object(r.id::text, v_ns::text);
  end loop;

  insert into elements (
    edition_id, salle_id, kind, x, y, w, h, numero, type_table,
    organisme_edition_id, chaises, mode, zone, categorie_id,
    sous, label, assigne, etat_terrain, notes)
  select v_new, (v_map->>e.salle_id::text)::uuid, e.kind, e.x, e.y, e.w, e.h,
         e.numero, e.type_table, null, e.chaises, e.mode, e.zone, e.categorie_id,
         e.sous, e.label, e.assigne, 'a_installer', e.notes
  from elements e where e.edition_id = p_source;

  insert into organisme_editions (organisme_id, edition_id, roles, couleur, statut)
  select organisme_id, v_new, roles, couleur, 'invite'
  from organisme_editions where edition_id = p_source;

  insert into jeux_editions (jeu_id, edition_id, statut, usage, exemplaires, emplacement, notes)
  select jeu_id, v_new,
         case when statut = 'deja_asso' then 'deja_asso' else 'souhaite' end,
         usage, exemplaires, null, null
  from jeux_editions where edition_id = p_source;

  return v_new;
end $$;

-- 002_plan.sql — PlanFest, Phase 0
-- Plan : salles, elements, creneaux_table, versions_plan.
-- RPC : enregistrer_plan (autosave + contrôle de version), dupliquer_edition.
-- Nécessite 001_socle.sql.

-- ========================================================================
-- salles
-- ========================================================================
create table public.salles (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  nom text not null default 'Salle',
  cols int not null check (cols > 0),
  rows int not null check (rows > 0),
  ici_x numeric,
  ici_y numeric,
  version int not null default 1,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index on public.salles (edition_id);
create trigger t_salles_version before update on public.salles
  for each row execute function public.touch_version();

-- ========================================================================
-- elements (remplace `items` de la maquette : tables + repères)
-- NB : la FK organisme_edition_id est ajoutée en 003 (organisme_editions
--      n'existe pas encore). Ici c'est une simple colonne uuid.
-- ========================================================================
create table public.elements (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  salle_id uuid not null references public.salles(id) on delete cascade,
  kind text not null check (kind in ('table','bloc')),
  x int not null, y int not null,
  w int not null check (w > 0), h int not null check (h > 0),
  numero text,
  type_table text check (type_table in ('partenaire','jurande','non_attribuee')),
  organisme_edition_id uuid,
  chaises int not null default 0,
  mode text not null default 'animee' check (mode in ('animee','libre')),
  zone text,
  categorie_id uuid references public.categories_jeux(id),
  sous text, label text, assigne boolean,
  etat_terrain text not null default 'a_installer'
    check (etat_terrain in ('a_installer','installee','verifiee')),
  notes text,
  version int not null default 1,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  check ((kind = 'table') = (type_table is not null))
);
create index on public.elements (edition_id, salle_id);
create trigger t_elements_version before update on public.elements
  for each row execute function public.touch_version();

-- ========================================================================
-- creneaux_table (tables enfants dont la tranche d'âge change dans la journée)
-- ========================================================================
create table public.creneaux_table (
  element_id uuid not null references public.elements(id) on delete cascade,
  jour text not null check (jour in ('ven','sam','dim')),
  debut time not null,
  categorie_id uuid not null references public.categories_jeux(id),
  primary key (element_id, jour, debut)
);

-- ========================================================================
-- versions_plan (instantané figé ; écrit uniquement par RPC)
-- ========================================================================
create table public.versions_plan (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  nom text not null,
  cree_par uuid references public.profils(id) on delete set null,
  cree_le timestamptz not null default now(),
  instantane jsonb not null
);
create index on public.versions_plan (edition_id);

-- ========================================================================
-- Temps réel (§2 : elements, salles, creneaux ; parties/presences en 007/009)
-- ========================================================================
alter publication supabase_realtime add table public.elements;
alter publication supabase_realtime add table public.salles;
alter publication supabase_realtime add table public.creneaux_table;

-- ========================================================================
-- RLS (§5 : lecture connecté actif ; écriture admin + logistique_securite)
-- ========================================================================
alter table public.salles          enable row level security;
alter table public.elements        enable row level security;
alter table public.creneaux_table  enable row level security;
alter table public.versions_plan   enable row level security;

create policy salles_lecture on public.salles for select to authenticated using (est_actif());
create policy salles_ecriture on public.salles for all to authenticated
  using (est_admin() or est_responsable('logistique_securite'))
  with check (est_admin() or est_responsable('logistique_securite'));

create policy elements_lecture on public.elements for select to authenticated using (est_actif());
create policy elements_ecriture on public.elements for all to authenticated
  using (est_admin() or est_responsable('logistique_securite'))
  with check (est_admin() or est_responsable('logistique_securite'));

create policy creneaux_lecture on public.creneaux_table for select to authenticated using (est_actif());
create policy creneaux_ecriture on public.creneaux_table for all to authenticated
  using (est_admin() or est_responsable('logistique_securite'))
  with check (est_admin() or est_responsable('logistique_securite'));

-- versions_plan : lecture admin/logistique ; écriture par RPC uniquement (aucune policy d'écriture)
create policy versions_lecture on public.versions_plan for select to authenticated
  using (est_admin() or est_responsable('logistique_securite'));

-- ========================================================================
-- RPC enregistrer_plan — autosave transactionnel avec contrôle de version (§9)
--   p_upserts : tableau JSON d'éléments complets, chacun avec sa `version` connue
--               (0 ou absente = nouvel élément).
--   p_suppressions : tableau JSON d'objets {id, version}.
--   Retour : { ok, versions:[{id,version}], conflits:[{id,version_serveur}] }
-- ========================================================================
create or replace function public.enregistrer_plan(
  p_edition uuid, p_upserts jsonb default '[]', p_suppressions jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  el jsonb; v_id uuid; v_known int; v_cur int; v_new int;
  versions jsonb := '[]'; conflits jsonb := '[]';
begin
  if not (est_admin() or est_responsable('logistique_securite')) then
    raise exception 'acces refuse';
  end if;

  -- upserts
  for el in select * from jsonb_array_elements(coalesce(p_upserts,'[]')) loop
    v_id := (el->>'id')::uuid;
    v_known := coalesce((el->>'version')::int, 0);
    select version into v_cur from elements where id = v_id;
    if found then
      if v_cur <> v_known then
        conflits := conflits || jsonb_build_object('id', v_id, 'version_serveur', v_cur);
      else
        update elements set
          salle_id = (el->>'salle_id')::uuid,
          kind = el->>'kind',
          x = (el->>'x')::int, y = (el->>'y')::int,
          w = (el->>'w')::int, h = (el->>'h')::int,
          numero = el->>'numero',
          type_table = el->>'type_table',
          organisme_edition_id = nullif(el->>'organisme_edition_id','')::uuid,
          chaises = coalesce((el->>'chaises')::int, 0),
          mode = coalesce(el->>'mode','animee'),
          zone = el->>'zone',
          categorie_id = nullif(el->>'categorie_id','')::uuid,
          sous = el->>'sous', label = el->>'label',
          assigne = (el->>'assigne')::boolean,
          etat_terrain = coalesce(el->>'etat_terrain','a_installer'),
          notes = el->>'notes'
        where id = v_id and edition_id = p_edition;
        select version into v_new from elements where id = v_id;
        versions := versions || jsonb_build_object('id', v_id, 'version', v_new);
      end if;
    else
      insert into elements (
        id, edition_id, salle_id, kind, x, y, w, h, numero, type_table,
        organisme_edition_id, chaises, mode, zone, categorie_id,
        sous, label, assigne, etat_terrain, notes)
      values (
        v_id, p_edition, (el->>'salle_id')::uuid, el->>'kind',
        (el->>'x')::int, (el->>'y')::int, (el->>'w')::int, (el->>'h')::int,
        el->>'numero', el->>'type_table',
        nullif(el->>'organisme_edition_id','')::uuid,
        coalesce((el->>'chaises')::int, 0), coalesce(el->>'mode','animee'),
        el->>'zone', nullif(el->>'categorie_id','')::uuid,
        el->>'sous', el->>'label', (el->>'assigne')::boolean,
        coalesce(el->>'etat_terrain','a_installer'), el->>'notes');
      versions := versions || jsonb_build_object('id', v_id, 'version', 1);
    end if;
  end loop;

  -- suppressions (contrôle de version avant suppression)
  for el in select * from jsonb_array_elements(coalesce(p_suppressions,'[]')) loop
    v_id := (el->>'id')::uuid;
    v_known := coalesce((el->>'version')::int, 0);
    select version into v_cur from elements where id = v_id and edition_id = p_edition;
    if found then
      if v_known <> 0 and v_cur <> v_known then
        conflits := conflits || jsonb_build_object('id', v_id, 'version_serveur', v_cur);
      else
        delete from elements where id = v_id and edition_id = p_edition;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', jsonb_array_length(conflits) = 0,
    'versions', versions, 'conflits', conflits);
end $$;

-- ========================================================================
-- RPC dupliquer_edition (§6) — version Phase 0 : édition + salles + éléments.
--   Les organismes/jeux/besoins seront ajoutés par 003/004/005
--   (create or replace qui étend cette fonction).
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

  -- salles : copie + table de correspondance ancien id -> nouvel id
  for r in select * from salles where edition_id = p_source loop
    insert into salles (edition_id, nom, cols, rows, ici_x, ici_y)
    values (v_new, r.nom, r.cols, r.rows, r.ici_x, r.ici_y)
    returning id into v_ns;
    v_map := v_map || jsonb_build_object(r.id::text, v_ns::text);
  end loop;

  -- elements : remap salle_id ; partenaire remis à null ; état terrain réinitialisé
  insert into elements (
    edition_id, salle_id, kind, x, y, w, h, numero, type_table,
    organisme_edition_id, chaises, mode, zone, categorie_id,
    sous, label, assigne, etat_terrain, notes)
  select v_new, (v_map->>e.salle_id::text)::uuid, e.kind, e.x, e.y, e.w, e.h,
         e.numero, e.type_table, null, e.chaises, e.mode, e.zone, e.categorie_id,
         e.sous, e.label, e.assigne, 'a_installer', e.notes
  from elements e where e.edition_id = p_source;

  -- créneaux_table : à copier quand on remappera les id d'éléments (migration ultérieure).
  return v_new;
end $$;

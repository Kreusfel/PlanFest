-- 003_organismes.sql — PlanFest, Phase 1
-- Organismes (partenaires / éditeurs / sponsors) persistants + leur déclinaison par
-- édition (statut, rôles, « fiche partenaire partagée »). Ajoute la FK différée
-- elements.organisme_edition_id, la vue publique organismes_noms, la RLS par rôle,
-- la RPC attribuer_table, et étend dupliquer_edition. Nécessite 001 + 002.

-- ========================================================================
-- organismes (persistant ; contacts = données personnelles)
-- ========================================================================
create table public.organismes (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  site text,
  contact_nom text,
  contact_email text,
  contact_tel text,
  notes text,
  archive boolean not null default false,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create trigger t_organismes_maj before update on public.organismes
  for each row execute function public.touch_maj();

-- ========================================================================
-- organisme_editions (une ligne par organisme et par édition)
-- ========================================================================
create table public.organisme_editions (
  id uuid primary key default gen_random_uuid(),
  organisme_id uuid not null references public.organismes(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete cascade,
  roles text[] not null default '{}'
    check (roles <@ array['partenaire','editeur','sponsor']::text[]),
  statut text not null default 'invite'
    check (statut in ('invite','relance','confirme','refuse')),
  dernier_contact date,
  couleur text,
  convention_recue boolean not null default false,
  assurance_recue boolean not null default false,
  personnes_sam int not null default 0,
  personnes_dim int not null default 0,
  tables_souhaitees int not null default 0,
  electricite boolean not null default false,
  nature_aide text,           -- sponsor
  logo_url text,              -- sponsor / communication
  notes text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (organisme_id, edition_id)
);
create index on public.organisme_editions (edition_id);
create trigger t_orged_maj before update on public.organisme_editions
  for each row execute function public.touch_maj();

-- ========================================================================
-- FK différée de 002 : une table du plan peut pointer un partenaire-édition
-- ========================================================================
alter table public.elements
  add constraint elements_organisme_edition_fk
  foreign key (organisme_edition_id)
  references public.organisme_editions(id) on delete set null;

-- ========================================================================
-- Vue organismes_noms (§5) : nom + couleur par organisme-édition, sans contacts.
-- Vue "security definer" (défaut) : contourne la RLS des tables sous-jacentes pour
-- n'exposer QUE ces deux colonnes à tout compte connecté (le plan en a besoin).
-- ========================================================================
create view public.organismes_noms as
  select oe.id, o.nom, oe.couleur
  from public.organisme_editions oe
  join public.organismes o on o.id = oe.organisme_id;
grant select on public.organismes_noms to authenticated;

-- ========================================================================
-- Accès par rôle : un responsable n'agit que sur les organismes dont un rôle
-- correspond à son pôle (partenaires↔partenaire, jeux_editeurs↔editeur, sponsors↔sponsor).
-- ========================================================================
create or replace function public.peut_ecrire_organisme(p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select est_admin()
    or ('partenaire' = any (p_roles) and est_responsable('partenaires'))
    or ('editeur'    = any (p_roles) and est_responsable('jeux_editeurs'))
    or ('sponsor'    = any (p_roles) and est_responsable('sponsors'));
$$;

-- ========================================================================
-- RLS (§5)
-- ========================================================================
alter table public.organismes         enable row level security;
alter table public.organisme_editions enable row level security;

-- organisme_editions : lecture et écriture = admin ou responsable d'un rôle porté par la ligne
create policy orged_acces on public.organisme_editions for all to authenticated
  using (peut_ecrire_organisme(roles))
  with check (peut_ecrire_organisme(roles));

-- organismes : visible si admin, ou s'il existe une déclinaison dont un rôle correspond ;
-- création permise à l'admin et aux responsables des trois pôles concernés.
create policy organismes_lecture on public.organismes for select to authenticated
  using (est_admin() or exists (
    select 1 from organisme_editions oe
    where oe.organisme_id = organismes.id and peut_ecrire_organisme(oe.roles)));
create policy organismes_modif on public.organismes for update to authenticated
  using (est_admin() or exists (
    select 1 from organisme_editions oe
    where oe.organisme_id = organismes.id and peut_ecrire_organisme(oe.roles)))
  with check (est_admin() or exists (
    select 1 from organisme_editions oe
    where oe.organisme_id = organismes.id and peut_ecrire_organisme(oe.roles)));
create policy organismes_insert on public.organismes for insert to authenticated
  with check (est_admin() or est_responsable('partenaires')
    or est_responsable('jeux_editeurs') or est_responsable('sponsors'));
create policy organismes_suppr on public.organismes for delete to authenticated
  using (est_admin());

-- ========================================================================
-- RPC attribuer_table (§6) : rattacher une table à un partenaire sans donner
-- l'écriture sur tout le plan (droit fin pour le pôle partenaires).
-- ========================================================================
create or replace function public.attribuer_table(
  p_element uuid, p_organisme_edition uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (est_admin() or est_responsable('logistique_securite') or est_responsable('partenaires')) then
    raise exception 'acces refuse';
  end if;
  update elements
     set organisme_edition_id = p_organisme_edition,
         type_table = 'partenaire'
   where id = p_element and kind = 'table';
end $$;

-- ========================================================================
-- dupliquer_edition (extension §6) : copie aussi les organismes de l'édition
-- (statut remis à invite ; personnes, cases et notes vidées).
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

  -- organismes : nouvelle déclinaison vierge pour la nouvelle édition
  insert into organisme_editions (organisme_id, edition_id, roles, couleur, statut)
  select organisme_id, v_new, roles, couleur, 'invite'
  from organisme_editions where edition_id = p_source;

  return v_new;
end $$;

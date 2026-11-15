-- 052_contreparties.sql — PlanFest
-- Contreparties demandées en échange d'un jeu (don, prêt), d'un soutien (sponsor) ou d'un
-- partenariat : photos, compte rendu, communication, logo… Une seule liste par édition,
-- suivie dans Communication → Contreparties, alimentée depuis Jeux et Organismes.
-- Les contreparties sponsors saisies en texte (045) sont reprises ici.

create table if not exists public.contreparties (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  beneficiaire text not null,                        -- à qui on la doit
  organisme_id uuid references public.organismes(id) on delete set null,
  origine text not null default 'autre' check (origine in ('jeu', 'sponsor', 'partenaire', 'autre')),
  jeu_edition_id uuid references public.jeux_editions(id) on delete set null,
  nature text not null default 'autre' check (nature in ('photos', 'compte_rendu', 'communication', 'logo', 'autre')),
  description text,
  echeance date,
  faite boolean not null default false,
  faite_le date,
  cree_le timestamptz not null default now()
);
create index if not exists contreparties_edition on public.contreparties (edition_id);

alter table public.contreparties enable row level security;
drop policy if exists contreparties_lecture on public.contreparties;
drop policy if exists contreparties_ecriture on public.contreparties;
create policy contreparties_lecture on public.contreparties for select to authenticated using (est_actif());
create policy contreparties_ecriture on public.contreparties for all to authenticated
  using (est_admin() or est_responsable('communication') or est_responsable('jeux_editeurs')
         or est_responsable('sponsors') or est_responsable('partenaires'))
  with check (est_admin() or est_responsable('communication') or est_responsable('jeux_editeurs')
         or est_responsable('sponsors') or est_responsable('partenaires'));

-- Reprise des contreparties sponsors (texte libre) — une seule fois.
insert into public.contreparties (edition_id, beneficiaire, organisme_id, origine, nature, description, faite)
select oe.edition_id, o.nom, o.id,
       case when 'sponsor' = any (oe.roles) then 'sponsor' else 'partenaire' end,
       'autre', oe.contreparties, oe.contreparties_faites
from public.organisme_editions oe join public.organismes o on o.id = oe.organisme_id
where coalesce(btrim(oe.contreparties), '') <> ''
  and not exists (select 1 from public.contreparties c
                  where c.edition_id = oe.edition_id and c.organisme_id = o.id and c.description = oe.contreparties);

-- Tableau de bord : contreparties à faire (carte Communication). Dernière définition : 035.
create or replace function public.tableau_de_bord(p_edition uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb := '{}';
begin
  if not est_actif() then raise exception 'acces refuse'; end if;

  res := res || jsonb_build_object('partenaires', jsonb_build_object(
    'confirmes', (select count(*) from organisme_editions where edition_id = p_edition and 'partenaire' = any (roles) and statut = 'confirme'),
    'a_relancer', (select count(*) from organisme_editions where edition_id = p_edition and 'partenaire' = any (roles) and statut in ('invite','relance')),
    'tables_non_attribuees', (select count(*) from elements where edition_id = p_edition and kind = 'table' and type_table = 'non_attribuee')));

  res := res || jsonb_build_object('jeux_editeurs', jsonb_build_object(
    'editeurs_sans_reponse', (select count(*) from organisme_editions where edition_id = p_edition and 'editeur' = any (roles) and statut in ('invite','relance')),
    'jeux_demandes', (select count(*) from jeux_editions where edition_id = p_edition and statut = 'demande'),
    'jeux_recus', (select count(*) from jeux_editions where edition_id = p_edition and statut = 'recu')));

  res := res || jsonb_build_object('sponsors', jsonb_build_object(
    'dossiers_attente', (select count(*) from subventions where edition_id = p_edition and statut in ('a_faire','depose')),
    'echeances_30j', (select count(*) from subventions where edition_id = p_edition and statut in ('a_faire','depose') and echeance between current_date and current_date + 30)));

  res := res || jsonb_build_object('logistique_securite', jsonb_build_object(
    'tables_non_attribuees', (select count(*) from elements where edition_id = p_edition and kind = 'table' and type_table = 'non_attribuee'),
    'tables_non_verifiees', (select count(*) from elements where edition_id = p_edition and kind = 'table' and etat_terrain <> 'verifiee')));

  res := res || jsonb_build_object('buvette_catering',
    coalesce((select jsonb_object_agg(j_code, nb_total) from repas_par_jour(p_edition, true)), '{}'::jsonb));

  res := res || jsonb_build_object('animateurs_benevoles', jsonb_build_object(
    'benevoles', (select count(*) from benevoles_editions where edition_id = p_edition and statut <> 'annule'),
    'confirmes', (select count(*) from benevoles_editions where edition_id = p_edition and statut = 'confirme'),
    'animateurs', (select count(*) from benevoles_editions where edition_id = p_edition and est_animateur and statut <> 'annule'),
    'alertes', (select count(*) from alertes_parties where edition_id = p_edition)));

  res := res || jsonb_build_object('communication', jsonb_build_object(
    'confirmes_sans_logo', (select count(*) from organisme_editions where edition_id = p_edition and statut = 'confirme' and (logo_url is null or logo_url = '')),
    'programme_publie', (select programme_publie from editions where id = p_edition),
    'contreparties_a_faire', (select count(*) from contreparties where edition_id = p_edition and not faite)));

  res := res || jsonb_build_object('intergenerationnelle', jsonb_build_object(
    'ecoles_confirmees', (select count(*) from vendredi_participants vp join comm_contacts c on c.id = vp.contact_id
      where vp.edition_id = p_edition and vp.statut in ('confirme','venu') and c.type = 'École'),
    'etablissements_confirmes', (select count(*) from vendredi_participants vp join comm_contacts c on c.id = vp.contact_id
      where vp.edition_id = p_edition and vp.statut in ('confirme','venu') and coalesce(c.type, '') <> 'École'),
    'personnes_attendues', (select coalesce(sum(vp.effectif), 0) from vendredi_participants vp
      where vp.edition_id = p_edition and vp.statut in ('confirme','venu'))));

  return res;
end $$;

-- ============================================================================
-- Cohérence statut des jeux ↔ statut de l'éditeur (fiche Organismes)
-- Un jeu « demandé à l'éditeur » = provenance_detail égal au nom de son éditeur.
--  - jeu passé à « Demandé » auprès de son éditeur → dernier contact = aujourd'hui sur la
--    fiche de l'éditeur (inscrit sur l'édition s'il ne l'était pas) ;
--  - jeu obtenu (don ou prêt) auprès de son éditeur → éditeur « Confirmé » ;
--  - éditeur passé à « Refusé » → ses jeux demandés reviennent « À obtenir », avec une note.
-- ============================================================================
create or replace function public.sync_jeu_vers_editeur()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ed uuid; v_nom text;
begin
  select j.editeur_id, o.nom into v_ed, v_nom from jeux j join organismes o on o.id = j.editeur_id where j.id = new.jeu_id;
  if v_ed is null or nom_comparable(new.provenance_detail) <> nom_comparable(v_nom) then return new; end if;
  if new.statut = 'demande' and old.statut is distinct from 'demande' then
    insert into organisme_editions (organisme_id, edition_id, roles, statut, dernier_contact)
    values (v_ed, new.edition_id, array['editeur'], 'invite', current_date)
    on conflict (organisme_id, edition_id) do update
      set dernier_contact = current_date,
          roles = (select array_agg(distinct r) from unnest(organisme_editions.roles || array['editeur']) r);
  elsif new.statut = 'recu' and new.provenance in ('don', 'pret') and old.statut is distinct from 'recu' then
    update organisme_editions set statut = 'confirme', dernier_contact = current_date
     where organisme_id = v_ed and edition_id = new.edition_id and statut <> 'confirme';
  end if;
  return new;
end $$;
drop trigger if exists t_sync_jeu_vers_editeur on public.jeux_editions;
create trigger t_sync_jeu_vers_editeur after update of statut on public.jeux_editions
  for each row execute function public.sync_jeu_vers_editeur();

create or replace function public.sync_editeur_vers_jeux()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nom text;
begin
  if new.statut <> 'refuse' or old.statut = 'refuse' or not ('editeur' = any (new.roles)) then return new; end if;
  select nom into v_nom from organismes where id = new.organisme_id;
  update jeux_editions je
     set statut = 'souhaite', provenance = null, provenance_detail = null,
         notes = concat_ws(E'\n', nullif(je.notes, ''), 'Refusé par ' || v_nom || ' le ' || to_char(current_date, 'YYYY-MM-DD'))
    from jeux j
   where j.id = je.jeu_id and j.editeur_id = new.organisme_id and je.edition_id = new.edition_id
     and je.statut = 'demande' and nom_comparable(je.provenance_detail) = nom_comparable(v_nom);
  return new;
end $$;
drop trigger if exists t_sync_editeur_vers_jeux on public.organisme_editions;
create trigger t_sync_editeur_vers_jeux after update of statut on public.organisme_editions
  for each row execute function public.sync_editeur_vers_jeux();

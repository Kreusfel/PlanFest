-- 020_ludotheque.sql — PlanFest
-- Ludothèque de l'asso : marque les jeux possédés par l'association, et enregistre
-- par festival le choix « on le prend ? » : oui / non / oui au bar à jeux.
-- Nécessite 004 (jeux) et 001 (editions, helpers de droits).

-- 1) Flag « jeu de la ludothèque (possédé par l'asso) ». Le catalogue existant est
--    considéré comme étant celui de l'asso ; on décoche au cas par cas les jeux
--    purement éditeurs depuis la fiche jeu.
alter table public.jeux add column if not exists ludotheque boolean not null default true;

-- 2) Choix de triage de la ludothèque, par édition.
create table if not exists public.ludotheque_choix (
  edition_id uuid not null references public.editions(id) on delete cascade,
  jeu_id uuid not null references public.jeux(id) on delete cascade,
  choix text not null check (choix in ('oui','non','bar')),  -- bar = oui, au bar à jeux
  maj_le timestamptz not null default now(),
  primary key (edition_id, jeu_id)
);
create index if not exists ludotheque_choix_edition on public.ludotheque_choix (edition_id);

alter table public.ludotheque_choix enable row level security;
create policy ludo_choix_lecture on public.ludotheque_choix for select to authenticated
  using (est_actif());
create policy ludo_choix_ecriture on public.ludotheque_choix for all to authenticated
  using (est_admin() or est_responsable('jeux_editeurs'))
  with check (est_admin() or est_responsable('jeux_editeurs'));

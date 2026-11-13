-- 026_accueil.sql — PlanFest
-- Accueil jour J :
--  - entrees : provenance (ville / code postal / groupe) saisie par groupe/famille.
--  - partie_inscriptions : inscriptions aux parties, DÉCORRÉLÉES des entrées —
--    n'importe quel bénévole peut inscrire quelqu'un à tout moment de la visite.
-- Nécessite 009 (entrees) et 007 (parties).

alter table public.entrees add column if not exists ville text;
alter table public.entrees add column if not exists code_postal text;
alter table public.entrees add column if not exists groupe text;

create table if not exists public.partie_inscriptions (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  partie_id uuid not null references public.parties(id) on delete cascade,
  nom text,
  nb int not null default 1 check (nb > 0),
  notes text,
  saisi_le timestamptz not null default now(),
  saisi_par uuid references public.profils(id) on delete set null
);
create index if not exists partie_inscriptions_edition on public.partie_inscriptions (edition_id);
create index if not exists partie_inscriptions_partie on public.partie_inscriptions (partie_id);

alter table public.partie_inscriptions enable row level security;
-- Outil jour J : tout bénévole actif peut inscrire / voir.
create policy partie_insc_lecture on public.partie_inscriptions for select to authenticated using (est_actif());
create policy partie_insc_ecriture on public.partie_inscriptions for all to authenticated
  using (est_actif()) with check (est_actif());

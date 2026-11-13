-- 018_permanences.sql — PlanFest
-- Permanences bénévoles à créneaux horaires : qui tient quel poste, quand,
-- éventuellement sur une table précise du plan. Une ligne = un bénévole (ou un
-- créneau non attribué) sur un poste. Nécessite 001..007.

create table public.permanences (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  benevole_edition_id uuid references public.benevoles_editions(id) on delete set null,
  poste text not null,
  jour text not null check (jour in ('ven','sam','dim')),
  debut time not null,
  fin time not null,
  element_id uuid references public.elements(id) on delete set null,  -- « sur une table »
  notes text,
  version int not null default 1,
  maj_le timestamptz not null default now(),
  check (fin > debut)
);
create index on public.permanences (edition_id, jour);
create index on public.permanences (benevole_edition_id);
create trigger t_permanences_version before update on public.permanences
  for each row execute function public.touch_version();

alter table public.permanences enable row level security;
create policy permanences_lecture on public.permanences for select to authenticated
  using (est_actif());
create policy permanences_ecriture on public.permanences for all to authenticated
  using (est_admin() or est_responsable('animateurs_benevoles'))
  with check (est_admin() or est_responsable('animateurs_benevoles'));

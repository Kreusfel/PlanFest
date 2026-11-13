-- 025_intergeneration.sql — PlanFest
-- Pôle Intergénérationnel (journée du vendredi) :
--  - vendredi_participants : participation d'un contact (école, EHPAD, handicap…)
--    au vendredi, par édition (invité / confirmé / venu), créneau et effectif.
--  - malle_jeux : jeux sélectionnés pour les malles prêtées aux écoles, par édition.
-- Réutilise comm_contacts (024) comme annuaire, et jeux (004). Nécessite 001/004/024.

create table if not exists public.vendredi_participants (
  edition_id uuid not null references public.editions(id) on delete cascade,
  contact_id uuid not null references public.comm_contacts(id) on delete cascade,
  statut text not null default 'invite' check (statut in ('invite','confirme','venu','decline')),
  creneau text,
  effectif int,
  notes text,
  maj_le timestamptz not null default now(),
  primary key (edition_id, contact_id)
);
create index if not exists vendredi_participants_edition on public.vendredi_participants (edition_id);

create table if not exists public.malle_jeux (
  edition_id uuid not null references public.editions(id) on delete cascade,
  jeu_id uuid not null references public.jeux(id) on delete cascade,
  malle text,
  notes text,
  maj_le timestamptz not null default now(),
  primary key (edition_id, jeu_id)
);
create index if not exists malle_jeux_edition on public.malle_jeux (edition_id);

alter table public.vendredi_participants enable row level security;
alter table public.malle_jeux           enable row level security;
create policy vendredi_lecture on public.vendredi_participants for select to authenticated using (est_actif());
create policy vendredi_ecriture on public.vendredi_participants for all to authenticated
  using (est_admin() or est_responsable('intergenerationnelle'))
  with check (est_admin() or est_responsable('intergenerationnelle'));
create policy malle_lecture on public.malle_jeux for select to authenticated using (est_actif());
create policy malle_ecriture on public.malle_jeux for all to authenticated
  using (est_admin() or est_responsable('intergenerationnelle'))
  with check (est_admin() or est_responsable('intergenerationnelle'));

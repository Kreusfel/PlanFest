-- 006_subventions.sql — PlanFest, Phase 1
-- Dossiers de subvention (sans montant). Accès admin + responsable sponsors.
-- Nécessite 001..005.

create table public.subventions (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  financeur text not null,
  echeance date,
  statut text not null default 'a_faire'
    check (statut in ('a_faire','depose','accorde','refuse')),
  lien_pieces text,
  notes text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index on public.subventions (edition_id);
create trigger t_subventions_maj before update on public.subventions
  for each row execute function public.touch_maj();

alter table public.subventions enable row level security;
create policy subv_acces on public.subventions for all to authenticated
  using (est_admin() or est_responsable('sponsors'))
  with check (est_admin() or est_responsable('sponsors'));

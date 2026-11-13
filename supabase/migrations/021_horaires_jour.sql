-- 021_horaires_jour.sql — PlanFest
-- Horaires d'ouverture PAR JOUR (le samedi et le dimanche peuvent différer).
-- Remplace l'usage de editions.ouverture_debut/fin pour le calcul des trous.
-- Nécessite 001 (editions, helpers de droits).

create table if not exists public.horaires_ouverture (
  edition_id uuid not null references public.editions(id) on delete cascade,
  jour text not null check (jour in ('ven','sam','dim')),
  debut time,
  fin time,
  primary key (edition_id, jour)
);

alter table public.horaires_ouverture enable row level security;
create policy horaires_lecture on public.horaires_ouverture for select to authenticated
  using (est_actif());
create policy horaires_ecriture on public.horaires_ouverture for all to authenticated
  using (est_admin() or est_responsable('animateurs_benevoles'))
  with check (est_admin() or est_responsable('animateurs_benevoles'));

-- Reprise : on sème chaque jour actif avec la fenêtre unique existante, si définie.
insert into public.horaires_ouverture (edition_id, jour, debut, fin)
select e.id, j, e.ouverture_debut, e.ouverture_fin
from public.editions e, unnest(e.jours_actifs) j
where e.ouverture_debut is not null or e.ouverture_fin is not null
on conflict (edition_id, jour) do nothing;

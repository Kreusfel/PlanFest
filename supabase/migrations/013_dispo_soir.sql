-- 013_dispo_soir.sql — PlanFest. Ajoute le créneau « soir » (rangement du dimanche)
-- aux disponibilités et aux besoins d'équipe. Nécessite 001..012.

alter table public.disponibilites drop constraint if exists disponibilites_demi_journee_check;
alter table public.disponibilites add constraint disponibilites_demi_journee_check
  check (demi_journee in ('matin', 'aprem', 'soir'));

alter table public.besoins_equipes drop constraint if exists besoins_equipes_demi_journee_check;
alter table public.besoins_equipes add constraint besoins_equipes_demi_journee_check
  check (demi_journee in ('matin', 'aprem', 'soir'));

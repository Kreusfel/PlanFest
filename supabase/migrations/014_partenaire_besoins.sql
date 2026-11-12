-- 014_partenaire_besoins.sql — PlanFest. Fiche partenaire : chaises + grilles souhaitées,
-- et noms des personnes (pour les étiquettes) dissociés des repas. Nécessite 001..013.
-- NB : personnes_sam / personnes_dim deviennent explicitement les REPAS samedi / dimanche
-- (déjà utilisés ainsi par repas_par_jour) ; les NOMS vont dans noms_personnes.

alter table public.organisme_editions
  add column if not exists chaises_souhaitees int not null default 0,
  add column if not exists grilles_souhaitees int not null default 0,
  add column if not exists noms_personnes text;

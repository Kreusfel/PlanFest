-- 047_exemplaires_asso.sql — PlanFest
-- Nombre d'exemplaires d'un jeu possédés par l'asso (ludothèque). Les malles des écoles
-- sont physiques : chaque malle mobilise un exemplaire, le festival les siens. L'écran
-- Jeux compare besoins et exemplaires et liste les jeux « à obtenir ».

alter table public.jeux add column if not exists exemplaires_asso int not null default 1;
alter table public.jeux drop constraint if exists jeux_exemplaires_asso_positif;
alter table public.jeux add constraint jeux_exemplaires_asso_positif check (exemplaires_asso >= 0);

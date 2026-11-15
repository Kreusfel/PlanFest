-- 044_code_barre_jeux.sql — PlanFest
-- Code-barre (EAN / UPC) d'un jeu : scanné ou tapé une première fois, il permet ensuite
-- de retrouver le jeu instantanément (inventaire de la ludothèque, ajout au festival).
-- Chiffres seulement ; un même code ne peut désigner qu'un jeu.

alter table public.jeux add column if not exists ean text;
alter table public.jeux drop constraint if exists jeux_ean_chiffres;
alter table public.jeux add constraint jeux_ean_chiffres check (ean is null or ean ~ '^[0-9]{6,14}$');
create unique index if not exists jeux_ean_unique on public.jeux (ean) where ean is not null;

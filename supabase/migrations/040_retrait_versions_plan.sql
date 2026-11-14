-- 040_retrait_versions_plan.sql — PlanFest
-- Retrait des « versions du plan » (figer / restaurer) : fonctionnalité abandonnée,
-- plus aucun écran ne l'utilise (Administration nettoyée). Les versions déjà figées
-- sont effacées. Le plan lui-même (salles, éléments) n'est pas touché.

drop function if exists public.restaurer_plan(uuid);
drop function if exists public.restauration_impact(uuid);
drop function if exists public.figer_plan(uuid, text);
drop table if exists public.versions_plan;

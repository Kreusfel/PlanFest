-- 049_restitution_prets.sql — PlanFest
-- Jeux prêtés pour le festival (ludothèque, bar à jeux, boutique…) : suivi de la
-- restitution, par prêteur (provenance_detail). rendu_le = date du retour.

alter table public.jeux_editions add column if not exists rendu boolean not null default false;
alter table public.jeux_editions add column if not exists rendu_le date;

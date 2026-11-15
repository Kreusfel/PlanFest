-- 046_malles_pole_jeux.sql — PlanFest
-- Les malles des écoles se gèrent désormais dans l'écran Jeux (onglet « Malles ») :
-- le pôle Jeux & éditeurs peut les modifier, en plus de l'Intergénérationnel et des admins.
-- Lecture inchangée (tout compte actif). Dernière définition : 025.

drop policy if exists malle_ecriture on public.malle_jeux;
create policy malle_ecriture on public.malle_jeux for all to authenticated
  using (est_admin() or est_responsable('intergenerationnelle') or est_responsable('jeux_editeurs'))
  with check (est_admin() or est_responsable('intergenerationnelle') or est_responsable('jeux_editeurs'));

-- Un même jeu peut être dans plusieurs malles (plusieurs exemplaires à l'asso) — et au
-- festival en même temps (déjà possible). Avant : une seule malle par jeu et par édition.
-- Chaque ligne reçoit un identifiant ; la malle devient obligatoire (« Sans nom » sinon) ;
-- un jeu ne peut pas être deux fois dans la MÊME malle.
alter table public.malle_jeux add column if not exists id uuid not null default gen_random_uuid();
update public.malle_jeux set malle = 'Sans nom' where malle is null or btrim(malle) = '';
alter table public.malle_jeux alter column malle set default 'Sans nom';
alter table public.malle_jeux alter column malle set not null;
alter table public.malle_jeux drop constraint if exists malle_jeux_pkey;
alter table public.malle_jeux add primary key (id);
create unique index if not exists malle_jeux_unique on public.malle_jeux (edition_id, jeu_id, malle);

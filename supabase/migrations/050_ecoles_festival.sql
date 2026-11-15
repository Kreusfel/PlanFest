-- 050_ecoles_festival.sql — PlanFest
-- Écoles qui viennent au festival (journée intergénérationnelle du vendredi) : le carnet
-- (comm_contacts) sert à la diffusion des flyers ; les écoles RETENUES sont celles qui ont
-- une ligne vendredi_participants. Pour chacune : matin ou après-midi, et ses classes
-- (nom + nombre d'élèves ; effectif = total).
-- ecoles_festival() : nom des écoles retenues, lisible par tout compte actif (le pôle Jeux
-- n'a pas accès au carnet) — sert à choisir la malle de chaque école dans Jeux → Malles.

alter table public.vendredi_participants add column if not exists demi_journee text;
alter table public.vendredi_participants drop constraint if exists vendredi_participants_demi_chk;
alter table public.vendredi_participants add constraint vendredi_participants_demi_chk
  check (demi_journee is null or demi_journee in ('matin', 'aprem'));
alter table public.vendredi_participants add column if not exists classes jsonb not null default '[]'::jsonb;

create or replace function public.ecoles_festival(p_edition uuid)
returns table (contact_id uuid, nom text, demi_journee text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not est_actif() then raise exception 'acces refuse'; end if;
  return query
  select c.id, c.nom, vp.demi_journee
  from vendredi_participants vp join comm_contacts c on c.id = vp.contact_id
  where vp.edition_id = p_edition and c.type = 'École' and vp.statut <> 'decline'
  order by c.nom;
end $$;
revoke all on function public.ecoles_festival(uuid) from public, anon;
grant execute on function public.ecoles_festival(uuid) to authenticated;

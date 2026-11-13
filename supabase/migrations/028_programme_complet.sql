-- 028_programme_complet.sql — PlanFest
-- Le programme public renvoie aussi le nombre d'inscrits par partie, pour
-- afficher « complet » côté visiteurs. Nécessite 008 et 026.

drop function if exists public.programme_public(uuid);
create function public.programme_public(p_edition uuid)
returns table (jour text, debut time, fin time, salle text, numero text, jeu text, places int, inscrits int)
language sql stable security definer set search_path = public as $$
  select p.jour, p.debut, p.fin, s.nom, e.numero,
         coalesce(j.titre, p.titre), p.places,
         coalesce((select sum(pi.nb)::int from partie_inscriptions pi where pi.partie_id = p.id), 0)
  from parties p
  join editions ed on ed.id = p.edition_id and ed.programme_publie
  join elements e on e.id = p.element_id
  join salles s on s.id = e.salle_id
  left join jeux_editions je on je.id = p.jeu_edition_id
  left join jeux j on j.id = je.jeu_id
  where p.edition_id = p_edition
  order by p.jour, p.debut, s.nom;
$$;
grant execute on function public.programme_public(uuid) to anon, authenticated;

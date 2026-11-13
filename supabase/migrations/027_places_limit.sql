-- 027_places_limit.sql — PlanFest
-- Garde-fou : on ne peut pas inscrire plus de personnes qu'une partie n'a de
-- places. Si parties.places est nul (pas de limite), aucune restriction.
-- Nécessite 007 (parties) et 026 (partie_inscriptions).

create or replace function public.partie_inscriptions_limit() returns trigger
language plpgsql set search_path = public as $$
declare v_places int; v_total int;
begin
  select places into v_places from parties where id = new.partie_id;
  if v_places is null then return new; end if;
  select coalesce(sum(nb), 0) into v_total from partie_inscriptions
    where partie_id = new.partie_id and id <> new.id;
  if v_total + new.nb > v_places then
    raise exception 'Complet : % place(s) disponible(s) sur % (déjà % inscrit(s))',
      greatest(v_places - v_total, 0), v_places, v_total;
  end if;
  return new;
end $$;

create trigger t_partie_insc_limit before insert or update on public.partie_inscriptions
  for each row execute function public.partie_inscriptions_limit();

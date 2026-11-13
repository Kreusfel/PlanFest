-- 017_public_contenu.sql — PlanFest. Texte de présentation libre de l'espace public,
-- par édition (le plan public reste le schéma auto, voir plan_public en 016).
-- Nécessite 001..016.

alter table public.editions
  add column if not exists presentation text;

-- Contenu éditorial d'une édition publiée (présentation libre).
create or replace function public.edition_public(p_edition uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'nom', nom, 'date_samedi', date_samedi,
    'presentation', presentation)
  from editions where id = p_edition and programme_publie;
$$;
grant execute on function public.edition_public(uuid) to anon, authenticated;

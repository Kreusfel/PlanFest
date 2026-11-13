-- 023_buvette.sql — PlanFest
-- Suivi buvette : articles avec quantités achetées / vendues et prix, par édition.
-- Permet coût, chiffre d'affaires, marge, stock restant, et un historique en
-- consultant les éditions passées. Nécessite 001 (editions, helpers, touch_maj).

create table if not exists public.buvette_items (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete cascade,
  nom text not null,
  categorie text,
  prix_achat numeric(10,2) not null default 0,  -- € unitaire d'achat
  prix_vente numeric(10,2) not null default 0,  -- € unitaire de vente
  qte_achetee int not null default 0,
  qte_vendue int not null default 0,
  notes text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists buvette_items_edition on public.buvette_items (edition_id);
create trigger t_buvette_items_maj before update on public.buvette_items
  for each row execute function public.touch_maj();

alter table public.buvette_items enable row level security;
create policy buvette_items_lecture on public.buvette_items for select to authenticated
  using (est_actif());
create policy buvette_items_ecriture on public.buvette_items for all to authenticated
  using (est_admin() or est_responsable('buvette_catering'))
  with check (est_admin() or est_responsable('buvette_catering'));

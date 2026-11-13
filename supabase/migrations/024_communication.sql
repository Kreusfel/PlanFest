-- 024_communication.sql — PlanFest
-- Pôle Communication :
--  - comm_contacts : carnet de diffusion PERPÉTUEL (mairies, écoles, médias…)
--    avec email et quantité de flyers (ex. nb d'élèves). Réutilisé chaque édition.
--  - comm_envois : suivi d'envoi PAR ÉDITION (à faire / envoyé / distribué).
--  - ouverture au pôle communication : publication du programme + texte public.
-- Nécessite 001 (editions, helpers, touch_maj) et 008 (publier_edition).

create table if not exists public.comm_contacts (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  type text,               -- Mairie, École, EHPAD, Presse, Média, Commerce, Autre (libre)
  contact text,            -- personne (maire, directeur…)
  email text,
  telephone text,
  commune text,
  adresse text,
  code_postal text,
  quantite_flyers int not null default 0,
  notes text,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create trigger t_comm_contacts_maj before update on public.comm_contacts
  for each row execute function public.touch_maj();

create table if not exists public.comm_envois (
  edition_id uuid not null references public.editions(id) on delete cascade,
  contact_id uuid not null references public.comm_contacts(id) on delete cascade,
  statut text not null default 'a_faire' check (statut in ('a_faire','envoye','distribue')),
  maj_le timestamptz not null default now(),
  primary key (edition_id, contact_id)
);
create index if not exists comm_envois_edition on public.comm_envois (edition_id);

alter table public.comm_contacts enable row level security;
alter table public.comm_envois   enable row level security;
create policy comm_contacts_lecture on public.comm_contacts for select to authenticated using (est_actif());
create policy comm_contacts_ecriture on public.comm_contacts for all to authenticated
  using (est_admin() or est_responsable('communication'))
  with check (est_admin() or est_responsable('communication'));
create policy comm_envois_lecture on public.comm_envois for select to authenticated using (est_actif());
create policy comm_envois_ecriture on public.comm_envois for all to authenticated
  using (est_admin() or est_responsable('communication'))
  with check (est_admin() or est_responsable('communication'));

-- Publication du programme : ouverte au pôle communication (en plus de l'admin).
create or replace function public.publier_edition(p_edition uuid, p_publier boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (est_admin() or est_responsable('communication')) then raise exception 'acces refuse'; end if;
  if p_publier then
    update editions set programme_publie = false where programme_publie and id <> p_edition;
    update editions set programme_publie = true where id = p_edition;
  else
    update editions set programme_publie = false where id = p_edition;
  end if;
end $$;

-- Texte de présentation public : modifiable par la communication (sans ouvrir
-- tout le reste de la table editions, qui reste admin).
create or replace function public.maj_contenu_public(p_edition uuid, p_presentation text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (est_admin() or est_responsable('communication')) then raise exception 'acces refuse'; end if;
  update editions set presentation = p_presentation where id = p_edition;
end $$;
grant execute on function public.maj_contenu_public(uuid, text) to authenticated;

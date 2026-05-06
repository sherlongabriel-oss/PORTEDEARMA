create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('delegacia','militar','clube')),
  name text not null,
  phone text,
  email text,
  address text,
  city text,
  state text,
  notes text,
  created_at timestamp with time zone default now()
);

create index if not exists entities_kind_idx on public.entities (kind);
create index if not exists entities_city_idx on public.entities (city);
create index if not exists entities_state_idx on public.entities (state);

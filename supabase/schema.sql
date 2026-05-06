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

create table if not exists public.legal_sources (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_url text not null,
  source_kind text not null check (source_kind in ('planalto','dou','pf','exercito','outro')),
  collected_at timestamp with time zone not null default now(),
  publisher text,
  notes text
);

create table if not exists public.legal_norms (
  id uuid primary key default gen_random_uuid(),
  norm_type text not null check (norm_type in ('constituicao','lei','decreto','portaria','instrucao_normativa','resolucao','outro')),
  norm_number text,
  norm_year integer,
  title text not null,
  summary text,
  issuing_body text not null,
  publication_date date,
  effective_date date,
  revocation_date date,
  status text not null default 'vigente' check (status in ('vigente','revogada','parcialmente_revogada','suspensa','desconhecido')),
  official_url text not null,
  source_id uuid references public.legal_sources(id) on delete set null,
  collected_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (norm_type, norm_number, norm_year, issuing_body)
);

create table if not exists public.legal_articles (
  id uuid primary key default gen_random_uuid(),
  norm_id uuid not null references public.legal_norms(id) on delete cascade,
  article_label text not null,
  article_text text not null,
  topic_tags text,
  created_at timestamp with time zone not null default now(),
  unique (norm_id, article_label)
);

create table if not exists public.legal_admin_interpretations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  issuing_body text not null,
  act_type text not null,
  act_number text,
  publication_date date,
  interpretation_text text not null,
  scope_category text,
  official_url text not null,
  source_id uuid references public.legal_sources(id) on delete set null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.legal_update_log (
  id uuid primary key default gen_random_uuid(),
  target_table text not null check (target_table in ('legal_norms','legal_articles','legal_admin_interpretations')),
  target_id uuid,
  change_type text not null check (change_type in ('insert','update','delete','import')),
  changed_by text,
  reason text,
  created_at timestamp with time zone not null default now()
);

create index if not exists legal_sources_kind_idx on public.legal_sources (source_kind);
create index if not exists legal_norms_type_idx on public.legal_norms (norm_type);
create index if not exists legal_norms_status_idx on public.legal_norms (status);
create index if not exists legal_norms_body_idx on public.legal_norms (issuing_body);
create index if not exists legal_articles_norm_idx on public.legal_articles (norm_id);
create index if not exists legal_interp_body_idx on public.legal_admin_interpretations (issuing_body);

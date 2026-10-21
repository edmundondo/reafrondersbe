-- ReAfronders · Africa's Natural Wonders — core schema
-- Think of it like a record crate: `countries` are the crates,
-- `wonders` are the records inside, `presentation` is the mixer settings.


-- ── Countries ────────────────────────────────────────────────
create table if not exists public.countries (
  iso_a3      text primary key check (char_length(iso_a3) between 3 and 5),
  name        text not null,
  region      text,                       -- e.g. 'Southern Africa'
  tagline     text,                       -- one-line poetic intro
  palette     jsonb not null default '[]'::jsonb,  -- ["#hex", ...] country colour story
  active      boolean not null default false,       -- shown on the public map?
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Wonders ──────────────────────────────────────────────────
create table if not exists public.wonders (
  id           uuid primary key default gen_random_uuid(),
  country_iso  text not null references public.countries(iso_a3) on update cascade on delete cascade,
  slug         text not null unique,
  name         text not null,
  local_name   text,                      -- e.g. 'Mosi-oa-Tunya'
  category     text not null default 'landform'
               check (category in ('waterfall','mountain','gorge','rock','cave','wetland','river','lake','forest','desert','savanna','coast','volcano','landform')),
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  summary      text not null,             -- brief description
  uniqueness   text,                      -- what makes it one of a kind
  stat_label   text,                      -- e.g. 'Width'
  stat_value   text,                      -- e.g. '1,708 m'
  unesco       boolean not null default false,
  visible      boolean not null default true,
  sort_order   int not null default 0,
  art          jsonb not null default '{}'::jsonb,  -- per-wonder presentation: {color, intensity, motion}
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists wonders_country_idx on public.wonders(country_iso, sort_order);

-- ── Presentation (global look & feel) ────────────────────────
create table if not exists public.presentation (
  id          text primary key default 'default',
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ── Editors (who may change things) ──────────────────────────
create table if not exists public.editors (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  added_at   timestamptz not null default now()
);

create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.editors where user_id = auth.uid());
$$;

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists countries_touch on public.countries;
create trigger countries_touch before update on public.countries for each row execute function public.touch_updated_at();
drop trigger if exists wonders_touch on public.wonders;
create trigger wonders_touch before update on public.wonders for each row execute function public.touch_updated_at();
drop trigger if exists presentation_touch on public.presentation;
create trigger presentation_touch before update on public.presentation for each row execute function public.touch_updated_at();

-- ── Row Level Security: the public listens, editors mix ──────
alter table public.countries    enable row level security;
alter table public.wonders      enable row level security;
alter table public.presentation enable row level security;
alter table public.editors      enable row level security;

drop policy if exists "public read countries" on public.countries;
create policy "public read countries" on public.countries for select using (active or public.is_editor());
drop policy if exists "editors write countries" on public.countries;
create policy "editors write countries" on public.countries for all to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists "public read wonders" on public.wonders;
create policy "public read wonders" on public.wonders for select using (visible or public.is_editor());
drop policy if exists "editors write wonders" on public.wonders;
create policy "editors write wonders" on public.wonders for all to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists "public read presentation" on public.presentation;
create policy "public read presentation" on public.presentation for select using (true);
drop policy if exists "editors write presentation" on public.presentation;
create policy "editors write presentation" on public.presentation for all to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists "editors see themselves" on public.editors;
create policy "editors see themselves" on public.editors for select to authenticated using (user_id = auth.uid());
-- (Add editors from the SQL editor / dashboard only — no public insert policy on purpose.)

-- Pintwist backend — initial schema
-- Applied via MCP at project creation; this file is the canonical source.

-- Pin identity: one row per unique pin
create table public.pins (
  pin_id text primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  image_url text,
  is_video boolean,
  pin_created_at timestamptz,
  observation_count integer not null default 0
);

-- Time-series observations
create table public.pin_snapshots (
  id bigint generated always as identity primary key,
  pin_id text not null references public.pins(pin_id) on delete cascade,
  seen_at timestamptz not null default now(),
  install_id uuid not null,
  source_url text,
  search_terms text,
  saves integer,
  reactions integer,
  shares integer,
  repins integer,
  comments integer
);

create index pin_snapshots_pin_seen_idx on public.pin_snapshots (pin_id, seen_at desc);
create index pin_snapshots_seen_idx on public.pin_snapshots (seen_at desc);
create index pin_snapshots_install_seen_idx on public.pin_snapshots (install_id, seen_at desc);

-- Bump pins.observation_count + last_seen whenever a new snapshot lands
create function public.bump_pin_observation() returns trigger
language plpgsql as $$
begin
  update public.pins
     set observation_count = observation_count + 1,
         last_seen = greatest(last_seen, new.seen_at)
   where pin_id = new.pin_id;
  return null;
end;
$$;

create trigger pin_snapshots_bump_observation
after insert on public.pin_snapshots
for each row execute function public.bump_pin_observation();

-- Permanent daily rollup
create table public.pin_daily (
  pin_id text not null,
  day date not null,
  unique_observers integer not null default 0,
  observation_count integer not null default 0,
  max_saves integer,
  min_saves integer,
  avg_saves numeric,
  top_source_urls text[],
  primary key (pin_id, day)
);

create index pin_daily_day_idx on public.pin_daily (day desc);

-- Rate limiting: batches per install_id per minute window
create table public.ingest_rate_limits (
  install_id uuid not null,
  window_start timestamptz not null,
  batch_count integer not null default 0,
  primary key (install_id, window_start)
);

create index ingest_rate_limits_window_idx on public.ingest_rate_limits (window_start);

-- Enable RLS; no policies = no anon/authenticated access. Service role bypasses RLS.
alter table public.pins enable row level security;
alter table public.pin_snapshots enable row level security;
alter table public.pin_daily enable row level security;
alter table public.ingest_rate_limits enable row level security;

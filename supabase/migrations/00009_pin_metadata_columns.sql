-- 00009_pin_metadata_columns.sql
-- Add rich pin metadata to the pins table so we capture "all the info possible"
-- from each Pinterest pin, not just metrics. New fields nullable; existing rows
-- stay as-is, extension v1.6.3+ populates them going forward.
--
-- Also rebuilds trending_agg to expose the new fields, and adds a
-- pin_snapshot_timeline RPC backing the new pin-detail modal in the web app.

alter table public.pins
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists link text,
  add column if not exists domain text,
  add column if not exists dominant_color text,
  add column if not exists alt_text text,
  add column if not exists board_name text,
  add column if not exists pinner_username text;

create index if not exists pins_domain_idx on public.pins (domain) where domain is not null;

drop function if exists public.trending_agg(integer,text,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone,integer,integer);

create or replace function public.trending_agg(
  p_days integer,
  p_q text,
  p_sort text,
  p_min_saves integer default null,
  p_max_saves integer default null,
  p_min_comments integer default null,
  p_max_comments integer default null,
  p_min_repins integer default null,
  p_max_repins integer default null,
  p_min_reactions integer default null,
  p_max_reactions integer default null,
  p_min_shares integer default null,
  p_max_shares integer default null,
  p_min_pin_created timestamptz default null,
  p_max_pin_created timestamptz default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns table (
  pin_id text,
  image_url text,
  pin_created_at timestamptz,
  title text,
  description text,
  link text,
  domain text,
  dominant_color text,
  board_name text,
  pinner_username text,
  max_saves integer,
  max_comments integer,
  max_repins integer,
  max_reactions integer,
  max_shares integer,
  reach bigint,
  latest_source text,
  latest_search_terms text,
  latest_seen timestamptz,
  total_count bigint
)
language sql
security definer
set search_path = public, pg_catalog
as $$
  with snaps as (
    select s.*, p.image_url, p.pin_created_at, p.title, p.description, p.link,
           p.domain, p.dominant_color, p.board_name, p.pinner_username
    from pin_snapshots s
    join pins p using (pin_id)
    where s.seen_at >= now() - make_interval(days => p_days)
      and (p_min_pin_created is null or p.pin_created_at >= p_min_pin_created)
      and (p_max_pin_created is null or p.pin_created_at <= p_max_pin_created)
      and (p_q = '' or s.search_terms ilike '%' || p_q || '%' or p.title ilike '%' || p_q || '%')
  ),
  agg as (
    select
      pin_id,
      max(image_url) as image_url,
      max(pin_created_at) as pin_created_at,
      max(title) as title,
      max(description) as description,
      max(link) as link,
      max(domain) as domain,
      max(dominant_color) as dominant_color,
      max(board_name) as board_name,
      max(pinner_username) as pinner_username,
      coalesce(max(saves), 0) as max_saves,
      coalesce(max(comments), 0) as max_comments,
      coalesce(max(repins), 0) as max_repins,
      coalesce(max(reactions), 0) as max_reactions,
      coalesce(max(shares), 0) as max_shares,
      count(distinct install_id) as reach,
      (array_agg(source_url order by seen_at desc))[1] as latest_source,
      (array_agg(search_terms order by seen_at desc))[1] as latest_search_terms,
      max(seen_at) as latest_seen
    from snaps
    group by pin_id
    having
      (p_min_saves is null or coalesce(max(saves), 0) >= p_min_saves)
      and (p_max_saves is null or coalesce(max(saves), 0) <= p_max_saves)
      and (p_min_comments is null or coalesce(max(comments), 0) >= p_min_comments)
      and (p_max_comments is null or coalesce(max(comments), 0) <= p_max_comments)
      and (p_min_repins is null or coalesce(max(repins), 0) >= p_min_repins)
      and (p_max_repins is null or coalesce(max(repins), 0) <= p_max_repins)
      and (p_min_reactions is null or coalesce(max(reactions), 0) >= p_min_reactions)
      and (p_max_reactions is null or coalesce(max(reactions), 0) <= p_max_reactions)
      and (p_min_shares is null or coalesce(max(shares), 0) >= p_min_shares)
      and (p_max_shares is null or coalesce(max(shares), 0) <= p_max_shares)
  ),
  ranked as (
    select *,
      case
        when p_sort = 'saves' then max_saves::bigint
        when p_sort = 'repins' then max_repins::bigint
        when p_sort = 'comments' then max_comments::bigint
        when p_sort = 'reactions' then max_reactions::bigint
        when p_sort = 'shares' then max_shares::bigint
        when p_sort = 'recent' then extract(epoch from latest_seen)::bigint
        else reach
      end as sort_key
    from agg
  ),
  total as (select count(*) as total_count from ranked)
  select
    r.pin_id, r.image_url, r.pin_created_at, r.title, r.description, r.link,
    r.domain, r.dominant_color, r.board_name, r.pinner_username,
    r.max_saves, r.max_comments, r.max_repins, r.max_reactions, r.max_shares,
    r.reach, r.latest_source, r.latest_search_terms, r.latest_seen, t.total_count
  from ranked r cross join total t
  order by r.sort_key desc nulls last, r.pin_id
  limit p_limit offset p_offset;
$$;

grant execute on function public.trending_agg(
  integer, text, text,
  integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer,
  timestamptz, timestamptz, integer, integer
) to service_role;

-- Snapshot timeline for the pin-detail modal. Returns every observation across
-- every install for a single pin, ordered ascending so charts render naturally.
create or replace function public.pin_snapshot_timeline(p_pin_id text)
returns table (
  seen_at timestamptz,
  install_id_short text,
  saves integer, comments integer, repins integer, reactions integer, shares integer,
  source_url text, search_terms text
)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select seen_at, left(install_id::text, 8) as install_id_short,
         saves, comments, repins, reactions, shares,
         source_url, search_terms
  from pin_snapshots
  where pin_id = p_pin_id
  order by seen_at asc;
$$;

grant execute on function public.pin_snapshot_timeline(text) to service_role;

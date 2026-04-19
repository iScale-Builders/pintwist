-- Push aggregation from Node-in-memory into Postgres.
-- At several hundred DAU the snapshot table grows to millions of rows,
-- and Node can't handle "fetch N million, aggregate in memory" on every
-- API request. These functions run the aggregation in Postgres directly.
--
-- All functions are STABLE SECURITY DEFINER and granted to service_role
-- only (the serverless functions call them via sb.rpc()).

-- ===== Indexes to support the new query patterns =====

create index if not exists pin_snapshots_seen_pin_idx
  on public.pin_snapshots (seen_at desc, pin_id);

create index if not exists pin_snapshots_search_terms_seen_idx
  on public.pin_snapshots (lower(search_terms), seen_at desc)
  where search_terms is not null;

create index if not exists pins_pin_created_idx
  on public.pins (pin_created_at)
  where pin_created_at is not null;


-- ===== /api/trending replacement =====

create or replace function public.trending_agg(
  p_days integer default 7,
  p_q text default '',
  p_sort text default 'reach',
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
) returns table(
  pin_id text,
  reach integer,
  obs integer,
  max_saves integer,
  max_comments integer,
  max_repins integer,
  max_reactions integer,
  max_shares integer,
  velocity integer,
  latest_source text,
  latest_search_terms text,
  latest_seen timestamptz,
  image_url text,
  is_video boolean,
  pin_created_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
as $$
  with filtered_snaps as (
    select s.pin_id, s.install_id, s.saves, s.comments, s.repins, s.reactions, s.shares,
           s.source_url, s.search_terms, s.seen_at
    from public.pin_snapshots s
    where s.seen_at >= now() - make_interval(days => p_days)
      and (p_q = ''
           or s.pin_id ilike '%' || p_q || '%'
           or s.search_terms ilike '%' || p_q || '%'
           or s.source_url ilike '%' || p_q || '%')
  ),
  agg as (
    select
      fs.pin_id,
      count(distinct fs.install_id)::int as reach,
      count(*)::int as obs,
      coalesce(max(fs.saves), 0)::int as max_saves,
      coalesce(max(fs.comments), 0)::int as max_comments,
      coalesce(max(fs.repins), 0)::int as max_repins,
      coalesce(max(fs.reactions), 0)::int as max_reactions,
      coalesce(max(fs.shares), 0)::int as max_shares,
      case when count(distinct fs.install_id) > 0
           then (coalesce(sum(fs.saves), 0) / count(distinct fs.install_id))::int
           else 0
      end as velocity,
      (array_agg(fs.source_url order by fs.seen_at desc)
         filter (where fs.source_url is not null))[1] as latest_source,
      (array_agg(fs.search_terms order by fs.seen_at desc)
         filter (where fs.search_terms is not null))[1] as latest_search_terms,
      max(fs.seen_at) as latest_seen
    from filtered_snaps fs
    group by fs.pin_id
  ),
  with_meta as (
    select a.*, p.image_url, p.is_video, p.pin_created_at
    from agg a
    left join public.pins p on p.pin_id = a.pin_id
  ),
  metric_filtered as (
    select * from with_meta
    where (p_min_saves is null or max_saves >= p_min_saves)
      and (p_max_saves is null or max_saves <= p_max_saves)
      and (p_min_comments is null or max_comments >= p_min_comments)
      and (p_max_comments is null or max_comments <= p_max_comments)
      and (p_min_repins is null or max_repins >= p_min_repins)
      and (p_max_repins is null or max_repins <= p_max_repins)
      and (p_min_reactions is null or max_reactions >= p_min_reactions)
      and (p_max_reactions is null or max_reactions <= p_max_reactions)
      and (p_min_shares is null or max_shares >= p_min_shares)
      and (p_max_shares is null or max_shares <= p_max_shares)
      and (p_min_pin_created is null or (pin_created_at is not null and pin_created_at >= p_min_pin_created))
      and (p_max_pin_created is null or (pin_created_at is not null and pin_created_at <= p_max_pin_created))
  ),
  total as (select count(*)::bigint as n from metric_filtered)
  select
    mf.pin_id, mf.reach, mf.obs,
    mf.max_saves, mf.max_comments, mf.max_repins, mf.max_reactions, mf.max_shares,
    mf.velocity,
    mf.latest_source, mf.latest_search_terms, mf.latest_seen,
    mf.image_url, mf.is_video, mf.pin_created_at,
    t.n as total_count
  from metric_filtered mf cross join total t
  order by
    case p_sort when 'reach'     then mf.reach         end desc nulls last,
    case p_sort when 'saves'     then mf.max_saves     end desc nulls last,
    case p_sort when 'comments'  then mf.max_comments  end desc nulls last,
    case p_sort when 'repins'    then mf.max_repins    end desc nulls last,
    case p_sort when 'reactions' then mf.max_reactions end desc nulls last,
    case p_sort when 'shares'    then mf.max_shares    end desc nulls last,
    case p_sort when 'velocity'  then mf.velocity      end desc nulls last,
    case p_sort when 'newest'    then mf.latest_seen   end desc nulls last,
    mf.max_saves desc,
    mf.pin_id
  limit p_limit
  offset p_offset;
$$;

revoke all on function public.trending_agg(integer, text, text,
  integer, integer, integer, integer, integer, integer, integer, integer, integer, integer,
  timestamptz, timestamptz, integer, integer) from public;
grant execute on function public.trending_agg(integer, text, text,
  integer, integer, integer, integer, integer, integer, integer, integer, integer, integer,
  timestamptz, timestamptz, integer, integer) to service_role;


-- ===== /api/niches replacement =====

create or replace function public.niches_agg(
  p_days integer default 30,
  p_sort text default 'volume',
  p_min_volume integer default 1,
  p_limit integer default 60,
  p_offset integer default 0
) returns table(
  term text,
  volume integer,
  unique_pins integer,
  reach integer,
  max_saves integer,
  avg_saves integer,
  max_comments integer,
  avg_comments integer,
  max_repins integer,
  avg_repins integer,
  max_reactions integer,
  avg_reactions integer,
  max_shares integer,
  avg_shares integer,
  latest_seen timestamptz,
  total_count bigint
)
language sql
stable
security definer
as $$
  with src as (
    select
      lower(trim(s.search_terms)) as term,
      s.pin_id, s.install_id, s.saves, s.comments, s.repins, s.reactions, s.shares,
      s.seen_at
    from public.pin_snapshots s
    where s.seen_at >= now() - make_interval(days => p_days)
      and s.search_terms is not null
      and trim(s.search_terms) <> ''
  ),
  agg as (
    select
      term,
      count(*)::int as volume,
      count(distinct pin_id)::int as unique_pins,
      count(distinct install_id)::int as reach,
      coalesce(max(saves), 0)::int as max_saves,
      coalesce(round(avg(saves))::int, 0) as avg_saves,
      coalesce(max(comments), 0)::int as max_comments,
      coalesce(round(avg(comments))::int, 0) as avg_comments,
      coalesce(max(repins), 0)::int as max_repins,
      coalesce(round(avg(repins))::int, 0) as avg_repins,
      coalesce(max(reactions), 0)::int as max_reactions,
      coalesce(round(avg(reactions))::int, 0) as avg_reactions,
      coalesce(max(shares), 0)::int as max_shares,
      coalesce(round(avg(shares))::int, 0) as avg_shares,
      max(seen_at) as latest_seen
    from src
    group by term
  ),
  filtered as (
    select * from agg where volume >= p_min_volume
  ),
  total as (select count(*)::bigint as n from filtered)
  select
    f.*, t.n as total_count
  from filtered f cross join total t
  order by
    case p_sort when 'volume'    then f.volume         end desc nulls last,
    case p_sort when 'reach'     then f.reach          end desc nulls last,
    case p_sort when 'saves'     then f.max_saves      end desc nulls last,
    case p_sort when 'comments'  then f.max_comments   end desc nulls last,
    case p_sort when 'repins'    then f.max_repins     end desc nulls last,
    case p_sort when 'reactions' then f.max_reactions  end desc nulls last,
    case p_sort when 'shares'    then f.max_shares     end desc nulls last,
    case p_sort when 'avg_saves' then f.avg_saves      end desc nulls last,
    case p_sort when 'recency'   then f.latest_seen    end desc nulls last,
    f.volume desc,
    f.term
  limit p_limit
  offset p_offset;
$$;

revoke all on function public.niches_agg(integer, text, integer, integer, integer) from public;
grant execute on function public.niches_agg(integer, text, integer, integer, integer) to service_role;


-- ===== /api/insights replacement =====
-- Returns all three sections (cross-niche, momentum, velocity) as a single JSONB
-- so the API handler just does one rpc() call and passes it through.

create or replace function public.insights_agg(
  p_days integer default 30
) returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_since timestamptz := now() - make_interval(days => p_days);
  v_this_week timestamptz := now() - interval '7 days';
  v_prev_week_start timestamptz := now() - interval '14 days';
  v_cross jsonb;
  v_momentum jsonb;
  v_velocity jsonb;
begin
  -- Velocity: top niches by avg saves per pin
  with base as (
    select
      lower(trim(search_terms)) as term,
      pin_id, saves
    from public.pin_snapshots
    where seen_at >= v_since
      and search_terms is not null
      and trim(search_terms) <> ''
  ),
  agg as (
    select term,
           count(distinct pin_id) as unique_pins,
           coalesce(round(avg(saves))::int, 0) as avg_saves,
           coalesce(max(saves), 0) as max_saves,
           count(*) filter (where saves is not null) as save_count
    from base
    group by term
  ),
  ranked as (
    select * from agg
    where save_count >= 3 and unique_pins >= 3
    order by avg_saves desc
    limit 30
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'term', term,
    'unique_pins', unique_pins,
    'avg_saves', avg_saves,
    'max_saves', max_saves
  )), '[]'::jsonb) into v_velocity
  from ranked;

  -- Momentum: week-over-week unique pin count
  with per_term as (
    select
      lower(trim(search_terms)) as term,
      count(distinct pin_id) filter (where seen_at >= v_this_week) as this_wk,
      count(distinct pin_id) filter (where seen_at >= v_prev_week_start and seen_at < v_this_week) as prev_wk
    from public.pin_snapshots
    where seen_at >= v_prev_week_start
      and search_terms is not null
      and trim(search_terms) <> ''
    group by lower(trim(search_terms))
  ),
  ranked as (
    select term, this_wk, prev_wk,
           round(((this_wk + 1)::numeric / (prev_wk + 1)::numeric)::numeric, 2) as growth_ratio
    from per_term
    where this_wk >= 3
    order by growth_ratio desc, this_wk desc
    limit 30
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'term', term,
    'pins_this_week', this_wk,
    'pins_prev_week', prev_wk,
    'growth_ratio', growth_ratio
  )), '[]'::jsonb) into v_momentum
  from ranked;

  -- Cross-niche overlap: pin_id appearing under multiple terms
  -- Cap to top 80 niches to keep the pairwise comparison bounded.
  with top_niches as (
    select lower(trim(search_terms)) as term, count(distinct pin_id) as pins
    from public.pin_snapshots
    where seen_at >= v_since
      and search_terms is not null
      and trim(search_terms) <> ''
    group by lower(trim(search_terms))
    order by pins desc
    limit 80
  ),
  pairs as (
    select b1.term_a, b2.term_b, count(*)::int as shared_pins
    from (
      select distinct lower(trim(s.search_terms)) as term_a, s.pin_id
      from public.pin_snapshots s
      join top_niches t on lower(trim(s.search_terms)) = t.term
      where s.seen_at >= v_since
    ) b1
    join (
      select distinct lower(trim(s.search_terms)) as term_b, s.pin_id
      from public.pin_snapshots s
      join top_niches t on lower(trim(s.search_terms)) = t.term
      where s.seen_at >= v_since
    ) b2 on b1.pin_id = b2.pin_id and b1.term_a < b2.term_b
    group by b1.term_a, b2.term_b
  ),
  ranked as (
    select term_a, term_b, shared_pins from pairs
    where shared_pins >= 2
    order by shared_pins desc
    limit 30
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'term_a', term_a,
    'term_b', term_b,
    'shared_pins', shared_pins
  )), '[]'::jsonb) into v_cross
  from ranked;

  return jsonb_build_object(
    'window_days', p_days,
    'cross_niche', v_cross,
    'momentum', v_momentum,
    'velocity', v_velocity
  );
end;
$$;

revoke all on function public.insights_agg(integer) from public;
grant execute on function public.insights_agg(integer) to service_role;

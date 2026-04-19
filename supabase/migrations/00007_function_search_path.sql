-- Pin search_path on SECURITY DEFINER functions.
-- Without this, a user who controls the search_path (via SET search_path)
-- could shadow objects like `public.pins` or `public.pin_snapshots` with
-- their own schema and get the function to operate on the wrong tables.
-- Hardening recommended by Supabase's security linter (0011).

alter function public.bump_pin_observation()
  set search_path = public, pg_catalog;

alter function public.bump_rate_limit(uuid, timestamptz, integer)
  set search_path = public, pg_catalog;

alter function public.trending_agg(
  integer, text, text,
  integer, integer, integer, integer, integer, integer, integer, integer, integer, integer,
  timestamptz, timestamptz, integer, integer
) set search_path = public, pg_catalog;

alter function public.niches_agg(integer, text, integer, integer, integer)
  set search_path = public, pg_catalog;

alter function public.insights_agg(integer)
  set search_path = public, pg_catalog;

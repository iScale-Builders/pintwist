-- Atomic rate-limit bump: single INSERT ... ON CONFLICT DO UPDATE RETURNING
-- Replaces the racy SELECT-then-UPSERT pattern in the Edge Function.

create function public.bump_rate_limit(
  p_install_id uuid,
  p_window_start timestamptz,
  p_limit integer
) returns table(allowed boolean, current_count integer)
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  insert into public.ingest_rate_limits (install_id, window_start, batch_count)
  values (p_install_id, p_window_start, 1)
  on conflict (install_id, window_start)
  do update set batch_count = public.ingest_rate_limits.batch_count + 1
  returning public.ingest_rate_limits.batch_count into v_count;

  return query select (v_count <= p_limit), v_count;
end;
$$;

revoke all on function public.bump_rate_limit(uuid, timestamptz, integer) from public;
grant execute on function public.bump_rate_limit(uuid, timestamptz, integer) to service_role;

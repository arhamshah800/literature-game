create extension if not exists pg_cron;

alter table public.game_players
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists game_players_game_seen_idx
on public.game_players (game_id, last_seen_at);

create or replace function game_private.cleanup_disconnected_games(
  stale_after interval default interval '90 seconds'
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := now() - stale_after;
  deleted_count int;
begin
  update public.game_players
  set is_connected = false
  where is_connected = true
    and last_seen_at < cutoff;

  with deleted_games as (
    delete from public.games g
    where exists (
        select 1
        from public.game_players gp
        where gp.game_id = g.id
      )
      and not exists (
        select 1
        from public.game_players gp
        where gp.game_id = g.id
          and gp.last_seen_at >= cutoff
      )
    returning g.id
  )
  select count(*)::int
  into deleted_count
  from deleted_games;

  return deleted_count;
end;
$$;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'literature-cleanup-disconnected-games'
  ) then
    perform cron.unschedule('literature-cleanup-disconnected-games');
  end if;

  perform cron.schedule(
    'literature-cleanup-disconnected-games',
    '* * * * *',
    $job$select game_private.cleanup_disconnected_games();$job$
  );
end $$;

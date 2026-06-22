-- Hardening migration for hidden-information integrity.
-- The browser may read only its own hand and sanitized events/state. All state
-- mutations must go through Edge Functions or tightly wrapped RPCs.

alter table public.profiles force row level security;
alter table public.games force row level security;
alter table public.game_players force row level security;
alter table public.card_catalog force row level security;
alter table public.game_cards force row level security;
alter table public.book_results force row level security;
alter table public.game_events force row level security;
alter table public.action_log force row level security;

alter table public.action_log
  add column if not exists request_id uuid;

create unique index if not exists action_log_unique_successful_request
on public.action_log (game_id, user_id, request_id, action_type)
where request_id is not null and success = true;

create or replace function game_private.enforce_claim_turn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  turn_player_id uuid;
begin
  select g.current_turn_player_id
  into turn_player_id
  from public.games g
  where g.id = new.game_id;

  if turn_player_id is distinct from new.claimed_by_player_id then
    raise exception 'It is not your turn.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists book_results_claim_turn_guard on public.book_results;
create trigger book_results_claim_turn_guard
before insert on public.book_results
for each row
execute function game_private.enforce_claim_turn();

drop policy if exists "players can read only their own live cards" on public.game_cards;
create policy "players can read only their own live cards"
on public.game_cards
for select
to authenticated
using (
  location_type = 'player'::public.card_location_type
  and holder_player_id in (
    select gp.id
    from public.game_players gp
    where gp.game_id = game_cards.game_id
      and gp.user_id = (select auth.uid())
  )
);

-- If a client queries "PlayerHands", this grant still exposes only rows that
-- pass the game_cards RLS policy above because the view is security_invoker.
grant select on public.game_cards to authenticated;
grant select on public.card_catalog to authenticated;

-- No browser role may write game state directly, even if it discovers table
-- names or generated REST endpoints.
revoke insert, update, delete, truncate on public.games from anon, authenticated;
revoke insert, update, delete, truncate on public.game_players from anon, authenticated;
revoke insert, update, delete, truncate on public.game_cards from anon, authenticated;
revoke insert, update, delete, truncate on public.book_results from anon, authenticated;
revoke insert, update, delete, truncate on public.game_events from anon, authenticated;
revoke insert, update, delete, truncate on public.action_log from anon, authenticated;

-- Prevent clients from calling private state-machine functions with a forged
-- caller_user_id. Edge Functions using the database URL keep owner-level access.
revoke usage on schema game_private from anon, authenticated;
revoke execute on all functions in schema game_private from anon, authenticated;

-- Prefer Edge Functions for mutations. If direct public RPC is re-enabled later,
-- the wrapper must pass auth.uid() and the private function must reject mismatches.
revoke execute on function public.initialize_game(uuid) from anon, authenticated;
revoke execute on function public.process_card_ask(uuid, uuid, public.literature_card_code) from anon, authenticated;
revoke execute on function public.process_claim(uuid, public.literature_book_code, public.claim_assignment[]) from anon, authenticated;

-- Hidden cards must never be replicated as realtime Postgres Changes.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'public.game_cards',
    'public.game_players',
    'public.games',
    'public.book_results',
    'public.action_log'
  ]
  loop
    if exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname || '.' || tablename = table_name
    ) then
      execute format('alter publication supabase_realtime drop table %s', table_name);
    end if;
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.game_events;
  end if;
exception
  when duplicate_object then null;
end $$;

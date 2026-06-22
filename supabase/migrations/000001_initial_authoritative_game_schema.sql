create extension if not exists pgcrypto;

create type public.game_status as enum (
  'waiting',
  'active',
  'completed',
  'cancelled'
);

create type public.card_location_type as enum (
  'deck',
  'player',
  'claimed',
  'cancelled'
);

create type public.claim_result as enum (
  'correct',
  'cancelled_wrong_locations',
  'awarded_to_opponent'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  lobby_code text not null unique,
  host_user_id uuid not null references public.profiles(id),
  status public.game_status not null default 'waiting',
  player_count int not null check (player_count between 4 and 8),
  current_turn_player_id uuid,
  winning_team_index int check (winning_team_index in (0, 1)),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table public.game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  seat_index int not null check (seat_index >= 0),
  team_index int not null check (team_index in (0, 1)),
  is_connected boolean not null default true,
  joined_at timestamptz not null default now(),
  unique (game_id, user_id),
  unique (game_id, seat_index)
);

alter table public.games
  add constraint games_current_turn_player_fk
  foreign key (current_turn_player_id)
  references public.game_players(id)
  deferrable initially deferred;

create table public.card_catalog (
  code text primary key,
  rank text not null,
  suit text,
  book_code text not null,
  sort_index int not null,
  is_joker boolean not null default false,
  check (
    book_code in (
      'clubs_low',
      'clubs_high',
      'diamonds_low',
      'diamonds_high',
      'hearts_low',
      'hearts_high',
      'spades_low',
      'spades_high',
      'eights_jokers'
    )
  )
);

create table public.game_cards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  card_code text not null references public.card_catalog(code),
  book_code text not null,
  location_type public.card_location_type not null default 'deck',
  holder_player_id uuid references public.game_players(id),
  claimed_team_index int check (claimed_team_index in (0, 1)),
  updated_at timestamptz not null default now(),
  unique (game_id, card_code),
  check (
    (
      location_type = 'player'
      and holder_player_id is not null
      and claimed_team_index is null
    )
    or (
      location_type = 'deck'
      and holder_player_id is null
      and claimed_team_index is null
    )
    or (
      location_type = 'claimed'
      and holder_player_id is null
      and claimed_team_index is not null
    )
    or (
      location_type = 'cancelled'
      and holder_player_id is null
    )
  )
);

create table public.book_results (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  book_code text not null,
  result public.claim_result not null,
  claiming_team_index int not null check (claiming_team_index in (0, 1)),
  awarded_team_index int check (awarded_team_index in (0, 1)),
  claimed_by_player_id uuid not null references public.game_players(id),
  created_at timestamptz not null default now(),
  unique (game_id, book_code)
);

create table public.game_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  version bigint not null,
  event_type text not null,
  actor_player_id uuid references public.game_players(id),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table public.action_log (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references public.games(id) on delete cascade,
  user_id uuid references public.profiles(id),
  player_id uuid references public.game_players(id),
  action_type text not null,
  request_payload jsonb not null,
  response_payload jsonb,
  success boolean not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index games_lobby_code_idx on public.games (lobby_code);
create index game_players_game_id_idx on public.game_players (game_id);
create index game_players_user_id_idx on public.game_players (user_id);
create index game_cards_game_holder_idx on public.game_cards (game_id, holder_player_id);
create index game_cards_game_book_idx on public.game_cards (game_id, book_code);
create index game_events_game_version_idx on public.game_events (game_id, version);
create index book_results_game_id_idx on public.book_results (game_id);

insert into public.card_catalog (code, rank, suit, book_code, sort_index, is_joker) values
  ('2C', '2', 'clubs', 'clubs_low', 0, false),
  ('3C', '3', 'clubs', 'clubs_low', 1, false),
  ('4C', '4', 'clubs', 'clubs_low', 2, false),
  ('5C', '5', 'clubs', 'clubs_low', 3, false),
  ('6C', '6', 'clubs', 'clubs_low', 4, false),
  ('7C', '7', 'clubs', 'clubs_low', 5, false),
  ('9C', '9', 'clubs', 'clubs_high', 6, false),
  ('10C', '10', 'clubs', 'clubs_high', 7, false),
  ('JC', 'J', 'clubs', 'clubs_high', 8, false),
  ('QC', 'Q', 'clubs', 'clubs_high', 9, false),
  ('KC', 'K', 'clubs', 'clubs_high', 10, false),
  ('AC', 'A', 'clubs', 'clubs_high', 11, false),
  ('2D', '2', 'diamonds', 'diamonds_low', 12, false),
  ('3D', '3', 'diamonds', 'diamonds_low', 13, false),
  ('4D', '4', 'diamonds', 'diamonds_low', 14, false),
  ('5D', '5', 'diamonds', 'diamonds_low', 15, false),
  ('6D', '6', 'diamonds', 'diamonds_low', 16, false),
  ('7D', '7', 'diamonds', 'diamonds_low', 17, false),
  ('9D', '9', 'diamonds', 'diamonds_high', 18, false),
  ('10D', '10', 'diamonds', 'diamonds_high', 19, false),
  ('JD', 'J', 'diamonds', 'diamonds_high', 20, false),
  ('QD', 'Q', 'diamonds', 'diamonds_high', 21, false),
  ('KD', 'K', 'diamonds', 'diamonds_high', 22, false),
  ('AD', 'A', 'diamonds', 'diamonds_high', 23, false),
  ('2H', '2', 'hearts', 'hearts_low', 24, false),
  ('3H', '3', 'hearts', 'hearts_low', 25, false),
  ('4H', '4', 'hearts', 'hearts_low', 26, false),
  ('5H', '5', 'hearts', 'hearts_low', 27, false),
  ('6H', '6', 'hearts', 'hearts_low', 28, false),
  ('7H', '7', 'hearts', 'hearts_low', 29, false),
  ('9H', '9', 'hearts', 'hearts_high', 30, false),
  ('10H', '10', 'hearts', 'hearts_high', 31, false),
  ('JH', 'J', 'hearts', 'hearts_high', 32, false),
  ('QH', 'Q', 'hearts', 'hearts_high', 33, false),
  ('KH', 'K', 'hearts', 'hearts_high', 34, false),
  ('AH', 'A', 'hearts', 'hearts_high', 35, false),
  ('2S', '2', 'spades', 'spades_low', 36, false),
  ('3S', '3', 'spades', 'spades_low', 37, false),
  ('4S', '4', 'spades', 'spades_low', 38, false),
  ('5S', '5', 'spades', 'spades_low', 39, false),
  ('6S', '6', 'spades', 'spades_low', 40, false),
  ('7S', '7', 'spades', 'spades_low', 41, false),
  ('9S', '9', 'spades', 'spades_high', 42, false),
  ('10S', '10', 'spades', 'spades_high', 43, false),
  ('JS', 'J', 'spades', 'spades_high', 44, false),
  ('QS', 'Q', 'spades', 'spades_high', 45, false),
  ('KS', 'K', 'spades', 'spades_high', 46, false),
  ('AS', 'A', 'spades', 'spades_high', 47, false),
  ('8C', '8', 'clubs', 'eights_jokers', 48, false),
  ('8D', '8', 'diamonds', 'eights_jokers', 49, false),
  ('8H', '8', 'hearts', 'eights_jokers', 50, false),
  ('8S', '8', 'spades', 'eights_jokers', 51, false),
  ('JOKER_RED', 'JOKER', null, 'eights_jokers', 52, true),
  ('JOKER_BLACK', 'JOKER', null, 'eights_jokers', 53, true);

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.card_catalog enable row level security;
alter table public.game_cards enable row level security;
alter table public.book_results enable row level security;
alter table public.game_events enable row level security;
alter table public.action_log enable row level security;

create function public.is_game_member(target_game_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.game_players gp
    where gp.game_id = target_game_id
      and gp.user_id = auth.uid()
  );
$$;

create function public.current_game_player_id(target_game_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select gp.id
  from public.game_players gp
  where gp.game_id = target_game_id
    and gp.user_id = auth.uid()
  limit 1;
$$;

create policy "users can read only their own profile"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "members can read their games"
on public.games for select
to authenticated
using (public.is_game_member(id));

create policy "members can read players in their games"
on public.game_players for select
to authenticated
using (public.is_game_member(game_id));

create policy "authenticated users can read the immutable card catalog"
on public.card_catalog for select
to authenticated
using (true);

create policy "players can read only their own live cards"
on public.game_cards for select
to authenticated
using (
  location_type = 'player'
  and holder_player_id = public.current_game_player_id(game_id)
);

create policy "members can read book results"
on public.book_results for select
to authenticated
using (public.is_game_member(game_id));

create policy "members can read sanitized game events"
on public.game_events for select
to authenticated
using (public.is_game_member(game_id));

create policy "members can read their own action log rows"
on public.action_log for select
to authenticated
using (user_id = auth.uid() and (game_id is null or public.is_game_member(game_id)));

create view public.public_game_player_card_counts as
select
  game_id,
  holder_player_id as player_id,
  count(*)::int as card_count
from public.game_cards
where location_type = 'player'
group by game_id, holder_player_id;

create function public.get_public_game_state(target_game_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'gameId', g.id,
    'lobbyCode', g.lobby_code,
    'status', g.status,
    'playerCount', g.player_count,
    'currentTurnPlayerId', g.current_turn_player_id,
    'version', g.version,
    'players', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'playerId', gp.id,
          'displayName', p.display_name,
          'seatIndex', gp.seat_index,
          'teamIndex', gp.team_index,
          'isConnected', gp.is_connected,
          'cardCount', coalesce(counts.card_count, 0)
        )
        order by gp.seat_index
      )
      from public.game_players gp
      join public.profiles p on p.id = gp.user_id
      left join public.public_game_player_card_counts counts
        on counts.game_id = gp.game_id
        and counts.player_id = gp.id
      where gp.game_id = g.id
    ), '[]'::jsonb),
    'books', (
      select jsonb_agg(
        jsonb_build_object(
          'bookCode', book.book_code,
          'status',
            case
              when br.result is null then 'unclaimed'
              when br.result = 'cancelled_wrong_locations' then 'cancelled'
              else 'claimed'
            end,
          'awardedTeamIndex', br.awarded_team_index
        )
        order by book.sort_order
      )
      from (
        values
          ('clubs_low', 0),
          ('clubs_high', 1),
          ('diamonds_low', 2),
          ('diamonds_high', 3),
          ('hearts_low', 4),
          ('hearts_high', 5),
          ('spades_low', 6),
          ('spades_high', 7),
          ('eights_jokers', 8)
      ) as book(book_code, sort_order)
      left join public.book_results br
        on br.game_id = g.id
        and br.book_code = book.book_code
    )
  )
  from public.games g
  where g.id = target_game_id
    and public.is_game_member(g.id);
$$;

create function public.get_my_hand(target_game_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'gameId', target_game_id,
    'playerId', public.current_game_player_id(target_game_id),
    'cards', coalesce(jsonb_agg(
      jsonb_build_object(
        'code', cc.code,
        'rank', cc.rank,
        'suit', cc.suit,
        'bookCode', cc.book_code,
        'sortIndex', cc.sort_index,
        'isJoker', cc.is_joker
      )
      order by cc.sort_index
    ) filter (where gc.id is not null), '[]'::jsonb)
  )
  from public.game_cards gc
  join public.card_catalog cc on cc.code = gc.card_code
  where gc.game_id = target_game_id
    and gc.location_type = 'player'
    and gc.holder_player_id = public.current_game_player_id(target_game_id);
$$;

revoke all on public.profiles from anon, authenticated;
revoke all on public.games from anon, authenticated;
revoke all on public.game_players from anon, authenticated;
revoke all on public.card_catalog from anon, authenticated;
revoke all on public.game_cards from anon, authenticated;
revoke all on public.book_results from anon, authenticated;
revoke all on public.game_events from anon, authenticated;
revoke all on public.action_log from anon, authenticated;
revoke all on public.public_game_player_card_counts from anon, authenticated;
revoke execute on function public.is_game_member(uuid) from public;
revoke execute on function public.current_game_player_id(uuid) from public;
revoke execute on function public.get_public_game_state(uuid) from public;
revoke execute on function public.get_my_hand(uuid) from public;
grant select on public.game_events to authenticated;
grant execute on function public.is_game_member(uuid) to authenticated;
grant execute on function public.current_game_player_id(uuid) to authenticated;
grant execute on function public.get_public_game_state(uuid) to authenticated;
grant execute on function public.get_my_hand(uuid) to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime add table public.game_events;
  end if;
exception
  when duplicate_object then
    null;
end $$;

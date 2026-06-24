-- Resolve Supabase advisor warnings from 2026-06-24.
--
-- Anonymous sign-ins use the authenticated Postgres role, so policies need an
-- explicit JWT guard in addition to `to authenticated`.

revoke execute on function public.current_game_player_id(uuid) from public, anon, authenticated;
revoke execute on function public.get_my_hand(uuid) from public, anon, authenticated;
revoke execute on function public.is_game_member(uuid) from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

alter policy "users can read only their own profile"
on public.profiles
using (
  id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
);

alter policy "members can read their games"
on public.games
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
  and public.is_game_member(id)
);

alter policy "members can read players in their games"
on public.game_players
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
  and public.is_game_member(game_id)
);

alter policy "authenticated users can read the immutable card catalog"
on public.card_catalog
using (
  (select auth.uid()) is not null
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
);

alter policy "players can read only their own live cards"
on public.game_cards
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
  and location_type = 'player'::public.card_location_type
  and holder_player_id in (
    select gp.id
    from public.game_players gp
    where gp.game_id = game_cards.game_id
      and gp.user_id = (select auth.uid())
  )
);

alter policy "members can read book results"
on public.book_results
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
  and public.is_game_member(game_id)
);

alter policy "members can read sanitized game events"
on public.game_events
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
  and public.is_game_member(game_id)
);

alter policy "members can read their own action log rows"
on public.action_log
using (
  user_id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
  and (game_id is null or public.is_game_member(game_id))
);

alter policy "game members can receive private game broadcasts"
on realtime.messages
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
  and realtime.messages.extension = 'broadcast'
  and left((select realtime.topic()), 5) = 'game:'
  and public.is_game_member(public.try_uuid(substr((select realtime.topic()), 6)))
);

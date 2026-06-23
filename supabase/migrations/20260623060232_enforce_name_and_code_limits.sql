update public.profiles
set display_name = case
  when nullif(left(regexp_replace(btrim(display_name), '\s+', ' ', 'g'), 24), '') is null then left(id::text, 8)
  else left(regexp_replace(btrim(display_name), '\s+', ' ', 'g'), 24)
end
where display_name <> case
  when nullif(left(regexp_replace(btrim(display_name), '\s+', ' ', 'g'), 24), '') is null then left(id::text, 8)
  else left(regexp_replace(btrim(display_name), '\s+', ' ', 'g'), 24)
end;

alter table public.profiles
  add constraint profiles_display_name_not_blank
  check (length(btrim(display_name)) between 1 and 24);

alter table public.games
  add constraint games_lobby_code_six_chars
  check (length(btrim(lobby_code)) = 6);

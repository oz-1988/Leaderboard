# Scoreboard — drop-in leaderboard for Phaser

Copy this folder into a game.

```
scoreboard/
  Scoreboard.js       public API + Supabase calls
  ScoreboardUI.js     the two Phaser panels
  leaderboard.json    seed scores, used to populate a new board
```

## 1. Install in the game

Copy `scoreboard/` into your source tree (e.g. `src/scoreboard/`), then in EndFrameScene:

```js
import { Scoreboard } from "../scoreboard/Scoreboard";
  
init(data = {}) {
  this.finalScore = data.score ?? 0;
}

async create() {

  // Render leaderboard over the end frame.
    this.scene.bringToTop();
    // Initials prompt + leaderboard, before the end frame.
    await Scoreboard.play(this, { score: this.finalScore });
    if (!this.scene.isActive()) return;

}
```

That is the whole integration. `play()` resolves once the player has entered
their initials and tapped through the board.

## 2. Set up Supabase

One Supabase project serves every game — each game is a `GAME_SLUG` in one
shared table. If a project already exists, skip to step 3.

1. Sign up at [supabase.com](https://supabase.com), create a project on the free
   tier, pick a region near your players.
2. Open **SQL Editor → New query**, paste the schema below, **Run**. It is
   idempotent, so re-running it is safe.
3. Open **Project Settings → API** and copy **Project URL** and the
   **`anon` `public`** key.

## 3. Configure

Top of `Scoreboard.js`:

| Constant | Does |
| --- | --- |
| `GAME_SLUG` | Which board this game writes to. **One per game.** |
| `SUPABASE_URL` | Project URL from step 2. |
| `SUPABASE_ANON_KEY` | The `anon` `public` key. |
| `LIMIT` | Rows shown. Default 10. |
| `AUTO_ADVANCE_SECS` | Seconds before the board moves on by itself. `0` waits for a tap. |

Restyle in `ScoreboardUI.js` via the `FONT`, `COLOR` and `FILL` constants at the
top. `FONT` falls back to sans-serif, so it is safe to leave alone.

## Schema

Paste into **SQL Editor → New query → Run**.

```sql
-- Cleanup from an earlier revision of this schema. No-ops on a fresh project.
-- The scores table and its data are left alone.
drop function if exists public.get_leaderboard(text, integer);
drop function if exists public.sb_is_profane(text);
drop function if exists public.sb_sanitize_nickname(text);
drop function if exists public.sb_normalize(text);
drop table if exists public.banned_words;
drop index if exists public.scores_leaderboard_idx;


-- Scores for every game, one row per player per game.
create table if not exists public.scores (
  game_slug   text        not null,
  player_uuid uuid        not null,
  nickname    text        not null,
  score       integer     not null default 0,
  achieved_at timestamptz not null default now(),
  primary key (game_slug, player_uuid)
);

create index if not exists scores_board_idx
  on public.scores (game_slug, score desc, achieved_at asc);

alter table public.scores enable row level security;
-- Deliberately no policies: anon reaches this table only via the functions below.


-- Three-letter combos to reject. Add your own to the array.
create or replace function public.sb_blocked(p_nick text)
returns boolean
language sql
immutable
as $$
  select translate(lower(coalesce(p_nick, '')), '0134578@$!', 'oieastbasi') = any (array[
    'ass','fag','fuc','fuk','fuq','cum','cnt','kkk','nig','sex',
    'tit','vag','dic','dik','pis','sht','twt','gay','jiz','wtf'
  ]);
$$;


-- Ranked board. Populates an empty board from the game's bundled JSON seed.
create or replace function public.get_leaderboard(
  p_game_slug text,
  p_limit     integer default 10,
  p_seed      jsonb   default null
)
returns table (rank integer, nickname text, score integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_seed is not null then
    -- Serialises concurrent first-players so the seed cannot double-insert.
    perform pg_advisory_xact_lock(hashtext(p_game_slug));

    if not exists (select 1 from scores where game_slug = p_game_slug) then
      insert into scores (game_slug, player_uuid, nickname, score, achieved_at)
      select p_game_slug,
             gen_random_uuid(),
             upper(substring(regexp_replace(s->>'nickname', '[^a-zA-Z0-9]', '', 'g') from 1 for 3)),
             greatest(coalesce((s->>'score')::int, 0), 0),
             -- Older than any real score, so seeds lose ties to real players.
             now() - interval '1 day'
      from jsonb_array_elements(p_seed) s;
    end if;
  end if;

  return query
  select (row_number() over (order by s.score desc, s.achieved_at asc))::int,
         s.nickname,
         s.score
  from scores s
  where s.game_slug = p_game_slug
  order by s.score desc, s.achieved_at asc
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
end;
$$;


-- Records a score, keeping the player's best.
-- Returns { ok, nickname, bestScore, rank } or { error, reason }.
create or replace function public.submit_score(
  p_game_slug   text,
  p_player_uuid uuid,
  p_nickname    text,
  p_score       integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick  text;
  v_score integer;
  v_best  integer;
  v_at    timestamptz;
  v_rank  integer;
begin
  if p_game_slug is null or p_player_uuid is null then
    return jsonb_build_object('error', 'invalid', 'reason', 'Missing game or player.');
  end if;

  v_nick := upper(regexp_replace(coalesce(p_nickname, ''), '[^a-zA-Z0-9]', '', 'g'));

  if char_length(v_nick) <> 3 then
    return jsonb_build_object('error', 'invalid', 'reason', 'Pick three letters.');
  end if;

  if sb_blocked(v_nick) then
    return jsonb_build_object('error', 'blocked', 'reason', 'That one isn''t allowed.');
  end if;

  -- Raise the ceiling if your game can legitimately score higher.
  v_score := least(greatest(coalesce(p_score, 0), 0), 1000000);

  insert into scores (game_slug, player_uuid, nickname, score)
  values (p_game_slug, p_player_uuid, v_nick, v_score)
  on conflict (game_slug, player_uuid) do update
    set nickname    = excluded.nickname,
        score       = greatest(scores.score, excluded.score),
        achieved_at = case when excluded.score > scores.score
                           then now() else scores.achieved_at end;

  select score, achieved_at into v_best, v_at
  from scores
  where game_slug = p_game_slug and player_uuid = p_player_uuid;

  select 1 + count(*) into v_rank
  from scores
  where game_slug = p_game_slug
    and (score > v_best or (score = v_best and achieved_at < v_at));

  return jsonb_build_object('ok', true, 'nickname', v_nick, 'bestScore', v_best, 'rank', v_rank);
end;
$$;


-- anon may call these two functions and nothing else.
revoke all on function public.get_leaderboard(text, integer, jsonb) from public;
revoke all on function public.submit_score(text, uuid, text, integer) from public;

grant execute on function public.get_leaderboard(text, integer, jsonb) to anon, authenticated;
grant execute on function public.submit_score(text, uuid, text, integer) to anon, authenticated;
```

## Free tier caveat

Free projects **pause after ~7 days with zero requests**, and the first request
after that fails while it wakes — the board falls back to the JSON seed until it
does. A live campaign generates enough traffic to never hit this; a project
sitting idle between builds will. Move to the paid tier before going live.

## Checking the data

**Table Editor → scores**, or:

```sql
select * from get_leaderboard('your-slug', 20);
```

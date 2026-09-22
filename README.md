# Scoreboard

A drop-in leaderboard for Phaser playables.

```
scoreboard/     <- copy this folder into your game
_legacy/        <- previous implementations, kept for reference
```

## Use it

Copy [`scoreboard/`](./scoreboard) into your game's source tree, set `GAME_SLUG`
and your Supabase keys, and call one line at game over:

```js
await Scoreboard.play(this, { score: finalScore });
```

Full instructions and the database schema:
[`scoreboard/README.md`](./scoreboard/README.md).

## Status

Scores live in Supabase, keyed by `GAME_SLUG`, so one project serves every game.
`leaderboard.json` populates a game's board the first time it is played, and
doubles as the offline fallback if the backend is unreachable — the board always
shows, even unconfigured.

Setup is one SQL paste. No server to run.

## `_legacy/`

Earlier attempts, kept only for reference. Nothing here is wired to a game.

| Folder | What it was |
| --- | --- |
| `scoreboardAPI/` | Express + MySQL server: profanity filtering, rate limiting, best-score upsert. Useful as a spec for a real backend. |
| `scoreboardFrontend/` | DOM/HTML client the API was built for. Replaced by the Phaser UI. |
| `scoreboardTest/` | Browser harness for the DOM client. |
| `Usage.txt` | Setup notes for the DOM client. |

Safe to delete once nothing references it; it is all in git history.

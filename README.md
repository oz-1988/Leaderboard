# Scoreboard System (Frontend + Backend)

This project provides a **reusable scoreboard system for playables (Phaser and Vanilla JS)**, with a shared backend and a drop-in frontend client.

## Goals

- One scoreboard for all games  
- Minimal integration code per game  
- Clean UX for nickname submission  
- Safe backend (profanity filtering, rate limiting)

---

## Overview

### What happens at game end

1. Game finishes and provides a final score.
2. If the user has **not submitted a nickname in this session**, a nickname modal is shown.  
   Users can **Submit** or **Skip**.

#### If nickname is submitted

- Backend validates nickname (including profanity filtering).
- If accepted, score is saved and ranked.
- If rejected, user is asked to choose another nickname.

#### If nickname is skipped

- Score is **not saved**.
- Leaderboard still appears with a highlighted **YOU** row (provisional).

> The leaderboard overlay is **always shown** at the end.

---

## Frontend

### `Scoreboard.js`

This is the **only JS file** you need to import into games.

It handles:

- Nickname modal (DOM-based)
- Leaderboard overlay (DOM-based)
- API communication
- Session handling (nickname locked once per session)
- Provisional scores (when user skips nickname)
- Error handling and retry logic

---

## Key Concepts

### Nickname locking

- Nickname is locked **only after the backend accepts it**.
- Profanity-flagged nicknames are **never locked**.
- If the user skips, the nickname is **not locked**.

### Provisional score

If the user skips nickname:

- Score is not saved.
- Leaderboard shows a **local-only row**:

```
Nickname: YOU
Rank: —
```

This row exists **only in the UI**, not in the database.

### Error handling (user-friendly)

- Profanity errors are shown **inside the modal**.
- Server / DB errors show a friendly message:

```
Server error. Please try again or choose another nickname.
```

---

## Required HTML

Paste these into your HTML **once** (for example in `index.html`):

```html
<link rel="stylesheet" href="./scoreboard/scoreboard.css">

<template id="sb-modal-template">
  <!-- Nickname modal -->
</template>

<template id="sb-leaderboard-template">
  <!-- Leaderboard -->
</template>
```

This avoids extra fetches and runtime DOM creation.

---

## Basic Usage

```js
import { Scoreboard } from "./scoreboard/Scoreboard.js";

const scoreboard = new Scoreboard({
  apiBase: "http://localhost:3000",
  gameSlug: "RepoName",
  leaderboardLimit: 10,

  onView: ({ leaderboard, player, highlightYou }) => {
    // Optional hook for custom rendering
    console.log(leaderboard, player);
  },
});

// Call this when the game ends
scoreboard.onGameEnd({ score: finalScore });
```

---

## Backend

### Stack

- Node.js
- Express
- MySQL
- `bad-words` for profanity filtering

---

## API Endpoints

### `GET /v1/leaderboard`

Returns top scores for a game.

**Response**
```json
{
  "game_slug": "RepoName",
  "top": [
    { "rank": 1, "nickname": "Alex", "score": 1200 }
  ]
}
```

If DB is unavailable:
```json
{
  "game_slug": "RepoName",
  "top": [],
  "db_ready": false
}
```

---

### `POST /v1/score`

Submits a score (only after nickname validation).

**Request**
```json
{
  "game_slug": "RepoName",
  "player_uuid": "uuid",
  "nickname": "Player1",
  "score": 1200
}
```

#### Success
```json
{
  "ok": true,
  "your": {
    "nickname": "Player1",
    "best_score": 1200,
    "rank": 3
  }
}
```

#### Profanity rejected
```json
{
  "error": "Nickname not allowed",
  "reason": "Profanity detected"
}
```

#### DB not ready
```json
{
  "ok": false,
  "db_ready": false,
  "error": "DB not ready"
}
```

---

## Database Schema (MySQL)

### Tables

#### `GAMES`
- `id` (PK)
- `slug` (UNIQUE)
- `name`

#### `PLAYERS`
- `id` (PK)
- `player_uuid` (UNIQUE)
- `nickname` (VARCHAR(16) / NULL)
- `created_at`

#### `BEST_SCORES`
- `game_id` (FK)
- `player_id` (FK)
- `best_score` (INT)
- `nickname_snapshot` (VARCHAR(16))
- `achieved_at`

### Indexes

- `PRIMARY KEY (game_id, player_id)`
- `INDEX (game_id, best_score)`

---

## Leaderboard Query

Query executed on demand.

**Top 10**
```sql
SELECT *
FROM scores
WHERE game_id = ?
ORDER BY score DESC, created_at ASC
LIMIT 10;
```

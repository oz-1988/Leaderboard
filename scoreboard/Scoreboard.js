/**
 * Drop-in leaderboard for Phaser games.
 *
 *   1. Copy this folder into your project (e.g. src/scoreboard/).
 *   2. Fill in the four constants below (see README.md for the Supabase setup).
 *   3. At game over, before you reveal your end screen:
 *
 *        import { Scoreboard } from "../scoreboard/Scoreboard";
 *        await Scoreboard.play(this, { score: finalScore });
 *
 * That is the whole integration. No assets, no HTML, no build config.
 *
 * Scores live in Supabase, keyed by GAME_SLUG. The first time a game is played
 * leaderboard.json populates that game's board, so it is never empty. If the
 * backend is unreachable the board still shows, falling back to that same JSON.
 */

import SEED from "./leaderboard.json";
import { InitialsPrompt, LeaderboardPanel } from "./ScoreboardUI.js";

/** Which board this game writes to. One per game. */
const GAME_SLUG = "frogger";

/** Supabase project URL, e.g. "https://abcdefgh.supabase.co" */
const SUPABASE_URL = "https://bbxeuvnairsmjndbrznu.supabase.co";

/** The publishable key. Safe to ship - see README.md. */
const SUPABASE_ANON_KEY = "sb_publishable_DymeFz7Oj64SqwrCbIThnQ_wKq336zw";

/** Rows shown in the panel. */
const LIMIT = 10;

/** Seconds the board holds before moving on by itself. 0 waits for a tap. */
const AUTO_ADVANCE_SECS = 0;

export const Scoreboard = {
  /**
   * Full end-of-game flow: initials prompt (first play only), save, then the
   * animated board. Resolves when the player taps through. Never throws.
   *
   * @param {Phaser.Scene} scene
   * @param {{score: number}} opts
   */
  async play(scene, { score = 0 } = {}) {
    // Tears itself down if the scene stops mid-flow, so the game scene does
    // not have to know this exists.
    const open = { ui: null };
    const cleanup = () => open.ui?.destroy();
    scene.events.once("shutdown", cleanup);

    try {
      const saved = readNickname();

      const you = saved
        ? await Scoreboard.submit(saved, score)
        : await promptForInitials(scene, score, open);

      open.ui = new LeaderboardPanel(scene, {
        top: await Scoreboard.getTop(),
        you,
        autoAdvanceSecs: AUTO_ADVANCE_SECS,
      });

      await open.ui.show();
      await open.ui.hide();
      open.ui = null;
    } catch (e) {
      console.warn("[Scoreboard]", e?.message || e);
    } finally {
      scene.events.off("shutdown", cleanup);
    }
  },

  /**
   * Top rows for this game, ranked. Passing the seed lets the backend populate
   * an empty board on the first ever play; it ignores it after that.
   *
   * @returns {Promise<Array<{rank, nickname, score}>>}
   */
  async getTop(limit = LIMIT) {
    try {
      const rows = await rpc("get_leaderboard", {
        p_game_slug: GAME_SLUG,
        p_limit: limit,
        p_seed: SEED,
      });

      if (Array.isArray(rows) && rows.length) return rows;
    } catch (e) {
      console.warn("[Scoreboard] backend unreachable, showing seed:", e?.message || e);
    }

    return seedBoard(limit);
  },

  /**
   * Records a score, keeping the player's best.
   *
   * @returns {Promise<object>} the player's row, or `{ rejected }` with a
   *   message to show when the backend refused the nickname.
   */
  async submit(nickname, score) {
    try {
      const result = await rpc("submit_score", {
        p_game_slug: GAME_SLUG,
        p_player_uuid: playerUuid(),
        p_nickname: nickname,
        p_score: score,
      });

      if (result?.ok) {
        writeNickname(result.nickname);
        return { nickname: result.nickname, score, bestScore: result.bestScore, rank: result.rank };
      }

      return { rejected: result?.reason || "Couldn't save that. Try another." };
    } catch (e) {
      console.warn("[Scoreboard] save failed:", e?.message || e);

      // Offline: still show them on the board, just not stored.
      return { nickname, score, provisional: true };
    }
  },

};

/* ------------------------------------------------------------------ */
/* Flow                                                                */
/* ------------------------------------------------------------------ */

async function promptForInitials(scene, score, open) {
  const prompt = (open.ui = new InitialsPrompt(scene, { score }));
  let initials = await prompt.show();

  while (initials) {
    prompt.setBusy(true);
    const result = await Scoreboard.submit(initials, score);

    if (!result.rejected) {
      await prompt.hide();
      open.ui = null;

      return result;
    }

    initials = await prompt.retry(result.rejected);
  }

  // Skipped: shown on the board, never stored.
  await prompt.hide();
  open.ui = null;

  return { nickname: "YOU", score, provisional: true };
}

/* ------------------------------------------------------------------ */
/* Backend                                                             */
/* ------------------------------------------------------------------ */

async function rpc(fn, args) {
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };

  if (SUPABASE_ANON_KEY.startsWith("eyJ")) {
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }

  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    credentials: "omit",
    body: JSON.stringify(args),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);

  return body;
}

/** The bundled JSON, ranked - what the board shows when the backend is down. */
function seedBoard(limit) {
  return [...SEED]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row, i) => ({ rank: i + 1, ...row }));
}

/* ------------------------------------------------------------------ */
/* Local identity                                                      */
/* ------------------------------------------------------------------ */

/** Identifies this device so replays update one row instead of adding rows. */
function playerUuid() {
  let id = safe(() => localStorage.getItem(key("uuid")));

  if (!id) {
    id = crypto?.randomUUID?.() || uuidFallback();
    safe(() => localStorage.setItem(key("uuid"), id));
  }

  return id;
}

/** scores.player_uuid is a real uuid column, so the fallback must be v4-shaped. */
function uuidFallback() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function readNickname() {
  return safe(() => localStorage.getItem(key("nickname"))) || "";
}

function writeNickname(nickname) {
  safe(() => localStorage.setItem(key("nickname"), nickname));
}

function key(suffix) {
  return `sb_${GAME_SLUG}_${suffix}`;
}

/** Storage throws in sandboxed iframes and private mode; a playable must survive that. */
function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

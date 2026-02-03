import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { db } from "./db.js";
import { validateAndSanitizeNickname } from "./profanityFilter.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use(rateLimit({ windowMs: 60_000, max: 30 }));

app.get("/v1/leaderboard", async (req, res) => {
  try {
    const { game, limit = 25 } = req.query;
    if (!game) return res.status(400).json({ error: "Missing game" });

    const [[gameRow]] = await db.query("SELECT id FROM games WHERE slug=?", [game]);

    if (!gameRow) {
      return res.json({ game_slug: game, top: [] });
    }

    const [rows] = await db.query(
      `SELECT nickname, score
       FROM best_scores
       WHERE game_id=?
       ORDER BY score DESC, achieved_at ASC
       LIMIT ?`,
      [gameRow.id, Number(limit)]
    );

    return res.json({
      game_slug: game,
      top: rows.map((r, i) => ({ rank: i + 1, nickname: r.nickname, score: r.score })),
    });
  } catch (e) {
    console.error("Leaderboard error:", e?.message || e);
    return res.status(200).json({ game_slug: req.query.game || "", top: [], db_ready: false });
  }
});

app.post("/v1/score", async (req, res) => {
  const { game_slug, player_uuid, nickname, score } = req.body;

  if (!game_slug || !player_uuid) {
    return res.status(400).json({ error: "Missing game_slug or player_uuid" });
  }

  const scoreInt = Number.isFinite(Number(score)) ? Math.max(0, Math.floor(Number(score))) : 0;

  // Profanity + validation
  const nickResult = validateAndSanitizeNickname(nickname);
  if (!nickResult.ok) {
    return res.status(400).json({ error: "Nickname not allowed", reason: nickResult.reason });
  }
  const cleanNick = nickResult.nickname;

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // Game
    await conn.query("INSERT IGNORE INTO games (slug) VALUES (?)", [game_slug]);
    const [[gameRow]] = await conn.query("SELECT id FROM games WHERE slug=?", [game_slug]);

    // Player
    await conn.query("INSERT IGNORE INTO players (player_uuid) VALUES (?)", [player_uuid]);
    const [[playerRow]] = await conn.query("SELECT id FROM players WHERE player_uuid=?", [player_uuid]);

    // Upsert best score (only updates score if higher; tie keeps earlier achieved_at)
    await conn.query(
      `INSERT INTO best_scores (game_id, player_id, nickname, score)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         nickname = VALUES(nickname),
         score = IF(VALUES(score) > score, VALUES(score), score),
         achieved_at = IF(VALUES(score) > score, CURRENT_TIMESTAMP, achieved_at)`,
      [gameRow.id, playerRow.id, cleanNick, scoreInt]
    );

    // Fetch best row (after upsert)
    const [[yourBest]] = await conn.query(
      `SELECT score, nickname, achieved_at
       FROM best_scores
       WHERE game_id=? AND player_id=?`,
      [gameRow.id, playerRow.id]
    );

    // Compute rank
    const [[rankRow]] = await conn.query(
      `SELECT 1 + COUNT(*) AS rank
       FROM best_scores
       WHERE game_id=?
         AND (score > ? OR (score = ? AND achieved_at < ?))`,
      [gameRow.id, yourBest.score, yourBest.score, yourBest.achieved_at]
    );

    await conn.commit();

    res.json({
      ok: true,
      your: {
        nickname: yourBest.nickname,
        best_score: yourBest.score,
        rank: Number(rankRow.rank),
      },
    });
  } catch (e) {
    try { if (conn) await conn.rollback(); } catch {}
    console.error("POST /v1/score error:", e?.message || e);

    return res.status(200).json({ ok: false, db_ready: false, error: "DB not ready" });
  } finally {
    try { conn?.release(); } catch {}
  }
});

app.listen(Number(process.env.PORT || 3000), () => {
  console.log(`Scoreboard API running on :${process.env.PORT || 3000}`);
});

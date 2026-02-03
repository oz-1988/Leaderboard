import { Scoreboard } from "../scoreboardFrontend/Scoreboard.js";

const el = (id) => document.getElementById(id);

let scoreboard = null;

function log(...args) {
  const line = args.map(a => (typeof a === "string" ? a : JSON.stringify(a, null, 2))).join(" ");
  el("log").textContent += line + "\n";
  el("log").scrollTop = el("log").scrollHeight;
}

function setMsg(type, text) {
  el("msg").innerHTML = type === "error"
    ? `<div class="error">${text}</div>`
    : `<div class="ok">${text}</div>`;
}

function renderLeaderboardView({ leaderboard, you, highlightYou, nicknameLocked }) {
  const top = leaderboard?.top || [];
  const build = leaderboard?.build_version ?? "";
  const game = leaderboard?.game_slug ?? "";

  el("lbMeta").innerHTML = `
    <div class="hint">
      Game: <span class="pill">${escapeHtml(game || "—")}</span>
      ${build ? ` Build: <span class="pill">${escapeHtml(build)}</span>` : ""}
      Nickname locked this session: <span class="pill">${nicknameLocked ? "YES" : "NO"}</span>
      ${you?.rank ? ` Your rank: <span class="pill">#${you.rank}</span>` : ""}
      ${you?.bestScore ? ` Best: <span class="pill">${you.bestScore}</span>` : ""}
    </div>
  `;

  // Compose rows
  const rows = [...top];

  let youRowIndex = -1;

  if (you?.isProvisional) {
    // Not stored -> show it at the bottom as a separate row
    rows.push({ rank: "—", nickname: you.nickname, score: you.score, __you: true });
    youRowIndex = rows.length - 1;
  } else {
    // Stored -> try to find it by nickname+score inside "top" list; if not present, highlight none
    youRowIndex = rows.findIndex(r => r.nickname === you.nickname && r.score === you.score);
  }

  const html = `
    <table>
      <thead>
        <tr>
          <th style="width: 70px;">Rank</th>
          <th>Nickname</th>
          <th style="width: 120px;">Score</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => {
          const isYou = highlightYou && (i === youRowIndex || r.__you);
          return `
            <tr class="${isYou ? "you" : ""}">
              <td>${escapeHtml(String(r.rank ?? ""))}</td>
              <td>${escapeHtml(String(r.nickname ?? ""))}${isYou ? ` <span class="pill">YOU</span>` : ""}</td>
              <td>${escapeHtml(String(r.score ?? ""))}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  el("lb").innerHTML = html;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createClient() {
  const apiBase = el("apiBase").value.trim();
  const gameSlug = el("gameSlug").value.trim();

  scoreboard = new Scoreboard({
    apiBase,
    gameSlug,
    leaderboardLimit: 25,
    ui: {
      cssUrl: "../scoreboardFrontend/scoreboard.css",
      modalTemplateId: "sb-modal-template",
      leaderboardTemplateId: "sb-leaderboard-template",
      modalTemplateUrl: "../scoreboardFrontend/scoreboard.modal.html",
      leaderboardTemplateUrl: "../scoreboardFrontend/scoreboard.leaderboard.html",
    },
    onView: (payload) => {
      log("onView payload:", payload);
      renderLeaderboardView(payload);
      setMsg("ok", "Leaderboard updated.");
    },
    onError: (e) => {
      log("ERROR:", e?.message || e, e?.payload || "");
      setMsg("error", `Error: ${e?.message || e}`);
    }
  });

  log("Client created:", { apiBase, gameSlug });
}

async function simulateGameEnd() {
  if (!scoreboard) createClient();

  const score = Number(el("score").value || 0);
  log("Simulate game end with score:", score);

  try {
    // This will prompt for nickname if not locked
    await scoreboard.onGameEnd({ score });
  } catch (e) {
    log("simulateGameEnd error:", e?.message || e);
    setMsg("error", `Error: ${e?.message || e}`);
  }
}

async function fetchLeaderboardOnly() {
  log("Fetch leaderboard only...");

  try {
    const leaderboard = await scoreboard.getLeaderboard();
    renderLeaderboardView({
      leaderboard,
      you: null,
      highlightYou: false,
      nicknameLocked: false
    });
    setMsg("ok", "Leaderboard fetched.");
  } catch (e) {
    log("fetchLeaderboardOnly error:", e?.message || e);
    setMsg("error", `Error: ${e?.message || e}`);
  }
}

function resetSessionLock() {
  // Session keys are per-game in Scoreboard: sb_<game>_nickname_submitted, sb_<game>_nickname
  const slug = el("gameSlug").value.trim();
  sessionStorage.removeItem(`sb_${slug}_nickname_submitted`);
  sessionStorage.removeItem(`sb_${slug}_nickname`);
  setMsg("ok", "Session nickname lock cleared. You will be prompted again on game end.");
  log("Session lock cleared for game:", slug);
}

function resetUUID() {
  const slug = el("gameSlug").value.trim();
  localStorage.removeItem(`sb_${slug}_player_uuid`);
  setMsg("ok", "LocalStorage UUID cleared. A new UUID will be generated next time.");
  log("UUID cleared for game:", slug);
}

// Wire UI
el("btnEnd").addEventListener("click", () => {
  createClient(); // refresh client
  simulateGameEnd();
});

el("btnLeaderboard").addEventListener("click", () => {
  fetchLeaderboardOnly();
});

el("btnResetSession").addEventListener("click", resetSessionLock);
el("btnResetAll").addEventListener("click", resetUUID);

// Bootstrap
//createClient();
setMsg("ok", "Ready. Make sure your API is running and reachable.");

// Scoreboard.js (API + UI)
// ESM export. Usage: import { Scoreboard } from "./scoreboard/Scoreboard.js";

export class Scoreboard {
    constructor(options) {
        this.apiBase = (options.apiBase || "").replace(/\/$/, "");
        this.gameSlug = options.gameSlug; // e.g. "stacker"
        this.leaderboardLimit = options.leaderboardLimit ?? 10;

        // UI settings (external files)
        // You can either:
        // 1) paste the <template> blocks into the HTML, OR
        // 2) provide template URLs and Scoreboard will fetch & inject.
        this.ui = {
            cssUrl: options.ui?.cssUrl || "",
            modalTemplateId: options.ui?.modalTemplateId || "sb-modal-template",
            leaderboardTemplateId: options.ui?.leaderboardTemplateId || "sb-leaderboard-template",
            modalTemplateUrl: options.ui?.modalTemplateUrl || "",                 // optional
            leaderboardTemplateUrl: options.ui?.leaderboardTemplateUrl || "",     // optional
        };

        // Hooks
        this.onBeforePrompt = options.onBeforePrompt || null;
        this.onAfterPrompt = options.onAfterPrompt || null;
        this.onError = options.onError || ((e) => console.warn("[Scoreboard]", e));

        // Placeholder used if user skips (not sent to server)
        this.youLabel = options.youLabel || "YOU";

        // If user provides custom handlers, use them.
        // If not, use built-in DOM modal + DOM leaderboard overlay.
        this.promptNickname = options.promptNickname || this._promptNicknameDOM.bind(this);
        this.onView = options.onView || this._showLeaderboardDOM.bind(this);

        // Internal state
        this._uiReadyPromise = null;

        this._ensureUUID();
    }

    // ---------------------------
    // Public API
    // ---------------------------

    async onGameEnd({ score }) {
        const scoreInt = this._toInt(score);

        // If nickname not submitted yet this session -> prompt every time
        if (!this._isNicknameLocked()) {
            const result = await this._maybePromptAndSubmit(scoreInt);

            // Always show leaderboard after end
            const leaderboard = await this.getLeaderboard();

            // If skipped: show local YOU row highlighted, NOT stored
            if (result.action === "skipped") {
                const payload = {
                    leaderboard,
                    player: { nickname: this.youLabel, score: scoreInt, isProvisional: true },
                    highlightYou: true,
                    nicknameLocked: false,
                };
                this._emitView(payload);
                return payload;
            }

            // If submitted: highlight their submitted nickname (and possibly server rank if returned)
            const payload = {
                leaderboard,
                player: {
                    nickname: result.nickname,
                    score: scoreInt,
                    isProvisional: false,
                    rank: result.server?.your?.rank,
                    bestScore: result.server?.your?.best_score,
                },
                highlightYou: true,
                nicknameLocked: true,
            };

            this._emitView(payload);
            return payload;
        }

        // Nickname already submitted once -> auto-submit without asking
        let server = null;
        try {
            server = await this.submitScore({ score: scoreInt, nickname: this._getSessionNickname() });
        } catch (e) {
            this.onError(e);
        }

        const leaderboard = await this.getLeaderboard();

        const payload = {
            leaderboard,
            player: {
                nickname: this._getSessionNickname() || this.youLabel,
                score: scoreInt,
                isProvisional: false,
                rank: server?.your?.rank,
                bestScore: server?.your?.best_score,
            },
            highlightYou: true,
            nicknameLocked: true,
        };

        this._emitView(payload);
        return payload;
    }

    async getLeaderboard() {
        return this._requestJSON(
            "GET",
            `/v1/leaderboard?game=${encodeURIComponent(this.gameSlug)}&limit=${encodeURIComponent(
                this.leaderboardLimit
            )}`
        );
    }

    async submitScore({ score, nickname }) {
        const payload = {
            game_slug: this.gameSlug,
            player_uuid: this._getUUID(),
            nickname: this._sanitizeNickname(nickname),
            score: this._toInt(score),
        };

        return this._requestJSON("POST", "/v1/score", payload);
    }

    // ---------------------------
    // UI (internal)
    // ---------------------------

    async _ensureUIReady() {
        if (this._uiReadyPromise) return this._uiReadyPromise;

        this._uiReadyPromise = (async () => {
            // Ensure CSS link if provided
            if (this.ui.cssUrl) this._ensureCssLink(this.ui.cssUrl);

            // Ensure templates exist; if missing and URL provided -> fetch and inject
            await this._ensureTemplateExists({
                templateId: this.ui.modalTemplateId,
                templateUrl: this.ui.modalTemplateUrl,
            });

            await this._ensureTemplateExists({
                templateId: this.ui.leaderboardTemplateId,
                templateUrl: this.ui.leaderboardTemplateUrl,
            });
        })();

        return this._uiReadyPromise;
    }

    _ensureCssLink(cssUrl) {
        const existing = document.querySelector(`link[data-sb-css="1"][href="${cssUrl}"]`);
        if (existing) return;

        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = cssUrl;
        link.setAttribute("data-sb-css", "1");
        document.head.appendChild(link);
    }

    async _ensureTemplateExists({ templateId, templateUrl }) {
        if (document.getElementById(templateId)) return;

        if (!templateUrl) {
            throw new Error(
                `[Scoreboard] Missing template #${templateId}. ` +
                `Either paste the <template id="${templateId}"> into your HTML, ` +
                `or provide ui.{modalTemplateUrl,leaderboardTemplateUrl}.`
            );
        }

        // Fetch the HTML fragment and inject it into the page
        const res = await fetch(templateUrl, { credentials: "omit" });
        const html = await res.text();

        // Create a safe container to parse
        const wrap = document.createElement("div");
        wrap.innerHTML = html;

        // Append any templates found
        const templates = wrap.querySelectorAll("template");
        if (!templates.length) {
            throw new Error(`[Scoreboard] No <template> found at ${templateUrl}`);
        }

        templates.forEach((t) => document.body.appendChild(t));
        if (!document.getElementById(templateId)) {
            throw new Error(
                `[Scoreboard] Template #${templateId} still missing after loading ${templateUrl}. ` +
                `Make sure the file contains <template id="${templateId}">...`
            );
        }
    }

    // Built-in nickname prompt (modal)
    async _promptNicknameDOM({ gameSlug, score }) {
        await this._ensureUIReady();

        return new Promise((resolve) => {
            const tpl = document.getElementById(this.ui.modalTemplateId);
            if (!tpl) throw new Error(`[Scoreboard] Missing template: #${this.ui.modalTemplateId}`);

            const node = tpl.content.firstElementChild?.cloneNode(true);
            if (!node) {
                throw new Error(`[Scoreboard] Template #${this.ui.modalTemplateId} has no root element.`);
            }


            const errorEl = node.querySelector('[data-sb="error"]');
            if (errorEl) {
                const msg = this._lastNicknameError || "";
                errorEl.textContent = msg;
                errorEl.style.display = msg ? "block" : "none";
            }

            // Support multiple markup variants:
            const card = node.querySelector(".sb-card") || node;
            const scoreEl = node.querySelector('[data-sb="score"]') || node.querySelector(".sb-score") || node.querySelector("#sbScore");
            const input = node.querySelector('[data-sb="input"]') || node.querySelector("input") || node.querySelector("#sbInput");
            const btnSkip = node.querySelector('[data-sb="skip"]') || node.querySelector(".sb-skip") || node.querySelector("#sbSkip");
            const btnSubmit = node.querySelector('[data-sb="submit"]') || node.querySelector(".sb-submit") || node.querySelector("#sbSubmit");
            const backdrop = node.querySelector('[data-sb="backdrop"]') || node;

            // Validate before using
            const missing = [];
            if (!scoreEl) missing.push("score element ([data-sb='score'] / .sb-score / #sbScore)");
            if (!input) missing.push("input ([data-sb='input'] / input / #sbInput)");
            if (!btnSkip) missing.push("skip button ([data-sb='skip'] / .sb-skip / #sbSkip)");
            if (!btnSubmit) missing.push("submit button ([data-sb='submit'] / .sb-submit / #sbSubmit)");

            if (missing.length) {
                throw new Error(
                    `[Scoreboard] Modal template mismatch (#${this.ui.modalTemplateId}). Missing: ${missing.join(", ")}`
                );
            }

            // Safe now
            scoreEl.textContent = String(score);
            input.value = this._getSessionNickname() || "";

            const cleanup = () => {
                this._lastNicknameError = "";
                node.remove();
                window.removeEventListener("keydown", onKey);
            };

            const submit = () => {
                const raw = (input.value || "").trim();
                const cleaned = this._sanitizeNickname(raw);
                if (!cleaned) {
                    card.classList.add("sb-shake");
                    setTimeout(() => card.classList.remove("sb-shake"), 220);
                    return;
                }
                cleanup();
                resolve(cleaned);
            };

            const skip = () => {
                cleanup();
                resolve(null);
            };

            const onKey = (e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") skip();
            };

            btnSubmit.addEventListener("click", submit);
            btnSkip.addEventListener("click", skip);

            // backdrop click closes (only if click is on backdrop itself)
            backdrop.addEventListener("click", (e) => {
                if (e.target === backdrop) skip();
            });

            window.addEventListener("keydown", onKey);
            document.body.appendChild(node);
            input.focus?.();
            input.setSelectionRange?.(input.value.length, input.value.length);
        });
    }

    // Built-in leaderboard overlay (DOM)
    async _showLeaderboardDOM({ leaderboard, player, highlightYou }) {
        await this._ensureUIReady();

        document.getElementById("sb-leaderboard-overlay")?.remove();

        const tpl = document.getElementById(this.ui.leaderboardTemplateId);
        if (!tpl) throw new Error(`[Scoreboard] Missing template: #${this.ui.leaderboardTemplateId}`);

        const node = tpl.content.firstElementChild?.cloneNode(true);
        if (!node) throw new Error(`[Scoreboard] Template #${this.ui.leaderboardTemplateId} has no root element.`);
        node.id = "sb-leaderboard-overlay";

        const backdrop = node.querySelector('[data-sb="backdrop"]') || node;
        const rowsWrap = node.querySelector('[data-sb="rows"]') || node.querySelector(".sb-rows");
        const meta = node.querySelector('[data-sb="meta"]') || node.querySelector(".sb-meta");
        const closeBtn = node.querySelector('[data-sb="close"]') || node.querySelector(".sb-close") || node.querySelector("button");

        const missing = [];
        if (!rowsWrap) missing.push("rows container ([data-sb='rows'] / .sb-rows)");
        if (!meta) missing.push("meta ([data-sb='meta'] / .sb-meta)");
        if (!closeBtn) missing.push("close button ([data-sb='close'] / .sb-close / button)");
        if (missing.length) throw new Error(`[Scoreboard] Leaderboard template mismatch (#${this.ui.leaderboardTemplateId}). Missing: ${missing.join(", ")}`);


        const top = leaderboard?.top || [];
        const rows = [...top];

        if (player?.isProvisional) {
            rows.push({
                rank: "—",
                nickname: player.nickname || this.youLabel,
                score: player.score,
                __you: true,
            });
        }

        const rankText = player?.rank ? `Your rank: #${player.rank}` : "";
        const bestText = player?.bestScore ? `Best: ${player.bestScore}` : "";
        meta.textContent = [rankText, bestText].filter(Boolean).join(" • ");

        rowsWrap.innerHTML = rows
            .map((r) => {
                const isYou =
                    highlightYou &&
                    (r.__you || (!player?.isProvisional && r.nickname === player?.nickname && r.score === player?.score));

                return `
          <div class="sb-row ${isYou ? "is-you" : ""}">
            <div>${escapeHtml(String(r.rank ?? ""))}</div>
            <div>${escapeHtml(String(r.nickname ?? ""))}${isYou ? ` <span class="sb-pill">YOU</span>` : ""}</div>
            <div>${escapeHtml(String(r.score ?? ""))}</div>
          </div>
        `;
            })
            .join("");

        const close = () => node.remove();
        closeBtn.addEventListener("click", close);
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) close();
        });

        document.body.appendChild(node);
    }

    // ---------------------------
    // Internals: prompt + submit
    // ---------------------------

    async _maybePromptAndSubmit(scoreInt) {
        try {
            this.onBeforePrompt?.();

            while (true) {
                const nickname = await this.promptNickname({
                    gameSlug: this.gameSlug,
                    score: scoreInt,
                });

                this.onAfterPrompt?.();

                // SKIP -> do not lock, do not submit
                if (!nickname) return { action: "skipped" };

                const cleaned = this._sanitizeNickname(nickname);
                if (!cleaned) {
                    alert("Nickname must be 3–12 chars (letters/numbers/space/_-).");
                    continue; // ask again
                }

                // Try to submit FIRST (do not lock yet)
                try {
                    const server = await this.submitScore({ score: scoreInt, nickname: cleaned });

                    // If backend says DB not ready, we can still lock locally so user isn't asked again
                    // (optional; remove this block if you prefer not to lock when DB is down)
                    if (server?.ok === false && server?.db_ready === false) {
                        this._lockNicknameForSession(cleaned);
                        return { action: "submitted", nickname: cleaned, server };
                    }

                    // Accepted by backend => now lock
                    this._lockNicknameForSession(cleaned);
                    this._lastNicknameError = "";
                    return { action: "submitted", nickname: cleaned, server };
                } catch (e) {
                    // Profanity (backend 400)
                    if (e?.status === 400 && e?.payload?.error === "Nickname not allowed") {
                        this._lastNicknameError =
                            e?.payload?.reason || "This nickname isn’t allowed. Please choose another.";
                        continue; // ask again, NOT locked
                    }

                    // Other error: show message and let them try again OR allow skip
                    this.onError(e);
                    this._lastNicknameError =
                        "Server error. Please try again or choose another nickname.";
                    continue;
                }
            }
        } catch (e) {
            this.onError(e);
            return { action: "skipped" };
        }
    }


    _emitView(payload) {
        try {
            this.onView?.(payload);
        } catch (e) {
            this.onError(e);
        }
    }

    // ---------------------------
    // Session nickname lock
    // ---------------------------

    _isNicknameLocked() {
        return sessionStorage.getItem(this._ssKey("nickname_submitted")) === "1";
    }

    _lockNicknameForSession(nickname) {
        sessionStorage.setItem(this._ssKey("nickname_submitted"), "1");
        sessionStorage.setItem(this._ssKey("nickname"), nickname);
    }

    _getSessionNickname() {
        return sessionStorage.getItem(this._ssKey("nickname")) || "";
    }

    // ---------------------------
    // UUID
    // ---------------------------

    _ensureUUID() {
        const key = this._lsKey("player_uuid");
        let id = localStorage.getItem(key);
        if (!id) {
            id = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            localStorage.setItem(key, id);
        }
    }

    _getUUID() {
        return localStorage.getItem(this._lsKey("player_uuid")) || "";
    }

    // ---------------------------
    // Network
    // ---------------------------

    async _requestJSON(method, path, body) {
        const url = `${this.apiBase}${path}`;
        const opts = {
            method,
            headers: { "Content-Type": "application/json" },
            credentials: "omit",
        };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(url, opts);
        const text = await res.text();

        let json;
        try {
            json = text ? JSON.parse(text) : {};
        } catch {
            console.warn("[Scoreboard] Non-JSON response:", res.status, text.slice(0, 300));
            json = { ok: false, error: "Invalid JSON response" };
        }

        if (!res.ok) {
            const err = new Error(json?.error || `HTTP ${res.status}`);
            err.status = res.status;
            err.payload = json;
            throw err;
        }
        return json;
    }

    // ---------------------------
    // Validation
    // ---------------------------

    _sanitizeNickname(name) {
        if (!name) return "";
        const cleaned = String(name)
            .trim()
            .replace(/\s+/g, " ")
            .replace(/[^a-zA-Z0-9 _-]/g, "");

        if (cleaned.length < 3) return "";
        return cleaned.slice(0, 12);
    }

    _toInt(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.floor(n));
    }

    _lsKey(suffix) {
        return `sb_${this.gameSlug}_${suffix}`;
    }
    _ssKey(suffix) {
        return `sb_${this.gameSlug}_${suffix}`;
    }
}

function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

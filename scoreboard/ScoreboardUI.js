/**
 * Phaser UI for the scoreboard: an arcade initials prompt and an animated
 * leaderboard. Everything is drawn with Graphics and Text, so this file has no
 * asset, atlas or font dependency and drops into any project unchanged.
 *
 * Only Scoreboard.js uses these directly.
 */

import { gsap } from "gsap";

/** Falls back to sans-serif anywhere the game has not loaded this font. */
const FONT = "CenturyGothic-Bold, sans-serif";

const COLOR = {
  value: "#ffffff",
  label: "#fdbf43",
  dim: "#9fb0c0",
  you: "#8ef26b",
  error: "#ff8f8f",
};

const FILL = {
  panel: 0x16202c,
  edge: 0xfdbf43,
  slot: 0x22303f,
  youRow: 0x2e7d32,
  button: 0x2b3b4d,
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function text(scene, x, y, value, { size = 26, color = COLOR.value, origin = 0.5 } = {}) {
  const t = scene.add.text(x, y, String(value), {
    fontFamily: FONT,
    fontSize: size,
    color,
    align: "center",
  });

  return Array.isArray(origin) ? t.setOrigin(origin[0], origin[1]) : t.setOrigin(origin);
}

function roundedRect(scene, x, y, w, h, { radius = 20, fill = FILL.panel, alpha = 0.96, edge = FILL.edge } = {}) {
  const g = scene.add.graphics();

  g.fillStyle(fill, alpha);
  g.fillRoundedRect(-w * 0.5, -h * 0.5, w, h, radius);

  if (edge !== null) {
    g.lineStyle(3, edge, 0.8);
    g.strokeRoundedRect(-w * 0.5, -h * 0.5, w, h, radius);
  }

  return g.setPosition(x, y);
}

/** Dim full-screen catcher so whatever is behind cannot be tapped through. */
function dimmer(scene) {
  return scene.add
    .rectangle(scene.scale.width * 0.5, scene.scale.height * 0.5, scene.scale.width, scene.scale.height, 0x000000, 0.62)
    .setInteractive();
}

/** Pill button. Returns a Container so it scales about its own centre. */
function button(scene, x, y, label, onTap, { w = 190, h = 62, primary = false } = {}) {
    const bg = scene.add.graphics();
    bg.fillStyle(primary ? FILL.edge : FILL.button, 1);
    bg.fillRoundedRect(-w * 0.5, -h * 0.5, w, h, h * 0.5);

    if (!primary) {
        bg.lineStyle(2, FILL.edge, 0.5);
        bg.strokeRoundedRect(-w * 0.5, -h * 0.5, w, h, h * 0.5);
    }

    const view = scene.add.container(x, y, [bg, text(scene, 0, 1, label, { size: 24, color: primary ? "#1c1205" : COLOR.value })]);

    const hit = scene.add.rectangle(x, y, w, h, 0xffffff).setAlpha(0.001).setInteractive();
    hit.on("pointerdown", () => {
        view.setScale(0.94);
        onTap?.();
    });
    hit.on("pointerup", () => view.setScale(1));
    hit.on("pointerout", () => view.setScale(1));

    return { view, hit, objects: [view, hit] };
}

/** Triangle arrow with a finger-sized hit area. `dir` is "up" or "down". */
function arrow(scene, x, y, dir, onTap) {
  const s = 17;
  const g = scene.add.graphics();

  g.fillStyle(FILL.edge, 1);
  if (dir === "up") g.fillTriangle(-s, s * 0.6, s, s * 0.6, 0, -s * 0.7);
  else g.fillTriangle(-s, -s * 0.6, s, -s * 0.6, 0, s * 0.7);
  g.setPosition(x, y);

  // Wide and short rather than a circle: a circle big enough to tap comfortably
  // would overlap the letter box below it.
  const hit = scene.add.rectangle(x, y, 72, 44, 0xffffff).setAlpha(0.001).setInteractive();
  hit.on("pointerdown", () => {
    g.setScale(0.85);
    onTap?.();
  });
  hit.on("pointerup", () => g.setScale(1));
  hit.on("pointerout", () => g.setScale(1));

  return [g, hit];
}

/* ------------------------------------------------------------------ */
/* Initials prompt                                                     */
/* ------------------------------------------------------------------ */

const SLOTS = 3;

/**
 * Vertical layout as offsets from the panel's centre, top to bottom. Every
 * number lives here so the spacing can be read - and fixed - in one place.
 * Each row leaves a gap of at least ~12px to its neighbour's edge.
 */
const L = {
  panelW: 520,
  panelH: 520,

  scoreLabel: -220, // "YOUR SCORE"
  scoreValue: -158, // the number
  prompt: -96, // "ENTER YOUR INITIALS"
  arrowUp: -58,
  slots: 14, // centre of the letter boxes
  arrowDown: 86,
  message: 132,
  buttons: 198,

  slotW: 84,
  slotH: 96,
  slotGap: 108,
};

export class InitialsPrompt {
  constructor(scene, { score = 0 } = {}) {
    this.scene = scene;
    this.score = score;
    this.letters = ["A", "A", "A"];
    this.active = 0;
    this.settled = false;

    this.build();
  }

  /** @returns {Promise<string|null>} initials, or null if skipped. */
  show() {
    gsap.fromTo(this.root, { alpha: 0, y: 50 }, { alpha: 1, y: 0, duration: 0.4, ease: "back.out(1.4)" });
    return this.arm();
  }

  /** Feedback while a save is in flight - cellular can be slow. */
  setBusy(on) {
    this.message.setColor(COLOR.dim).setText(on ? "Saving..." : "");
  }

  /** Re-arms after a rejected attempt, keeping the prompt on screen. */
  retry(message) {
    this.message.setColor(COLOR.error).setText(message);
    gsap.fromTo(this.root, { x: -10 }, { x: 0, duration: 0.4, ease: "elastic.out(1, 0.3)" });

    return this.arm();
  }

  arm() {
    this.settled = false;
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  build() {
    const scene = this.scene;
    const cX = scene.scale.width * 0.5;
    const cY = scene.scale.height * 0.5;

    const parts = [
      dimmer(scene),
      roundedRect(scene, cX, cY, L.panelW, L.panelH),
      text(scene, cX, cY + L.scoreLabel, "YOUR SCORE", { size: 22, color: COLOR.label }),
      text(scene, cX, cY + L.scoreValue, this.score, { size: 60 }),
      text(scene, cX, cY + L.prompt, "ENTER YOUR INITIALS", { size: 22, color: COLOR.label }),
    ];

    this.slots = [];

    for (let i = 0; i < SLOTS; i++) {
      const x = cX + (i - 1) * L.slotGap;
      const y = cY + L.slots;

      const box = scene.add.graphics();
      box.fillStyle(FILL.slot, 1);
      box.fillRoundedRect(x - L.slotW * 0.5, y - L.slotH * 0.5, L.slotW, L.slotH, 12);
      box.lineStyle(3, FILL.edge, 0.3);
      box.strokeRoundedRect(x - L.slotW * 0.5, y - L.slotH * 0.5, L.slotW, L.slotH, 12);

      const letter = text(scene, x, y, this.letters[i], { size: 56 });

      const focus = scene.add.rectangle(x, y, L.slotW, L.slotH, 0xffffff).setAlpha(0.001).setInteractive();
      focus.on("pointerdown", () => this.setActive(i));

      parts.push(
        box,
        focus,
        letter,
        ...arrow(scene, x, cY + L.arrowUp, "up", () => this.cycle(i, 1)),
        ...arrow(scene, x, cY + L.arrowDown, "down", () => this.cycle(i, -1))
      );

      this.slots.push(letter);
    }

    this.message = text(scene, cX, cY + L.message, "", { size: 21, color: COLOR.error });

    this.skip = button(scene, cX - 106, cY + L.buttons, "SKIP", () => this.finish(null));
    this.ok = button(scene, cX + 106, cY + L.buttons, "OK", () => this.finish(this.letters.join("")), { primary: true });

    this.root = scene.add.container(0, 0, [...parts, this.message, ...this.skip.objects, ...this.ok.objects]);

    this.setActive(0);
    this.bindKeys();
  }

  bindKeys() {
    this.onKey = (e) => {
      const k = e.key;

      if (k === "Enter") return this.finish(this.letters.join(""));
      if (k === "Escape") return this.finish(null);
      if (k === "ArrowUp") return this.cycle(this.active, 1);
      if (k === "ArrowDown") return this.cycle(this.active, -1);
      if (k === "ArrowLeft") return this.setActive(this.active - 1);
      if (k === "ArrowRight") return this.setActive(this.active + 1);

      const ch = k.toUpperCase();
      if (k.length === 1 && ALPHABET.includes(ch)) {
        this.setLetter(this.active, ch);
        this.setActive(this.active + 1);
      }
    };

    this.scene.input.keyboard?.on("keydown", this.onKey);
  }

  setActive(index) {
    this.active = Math.max(0, Math.min(index, SLOTS - 1));

    this.slots.forEach((letter, i) => {
      gsap.killTweensOf(letter);
      letter.setColor(i === this.active ? COLOR.label : COLOR.value).setScale(1);

      if (i === this.active) {
        gsap.to(letter, { scale: 1.1, duration: 0.5, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }
    });
  }

  cycle(index, step) {
    const next = (ALPHABET.indexOf(this.letters[index]) + step + ALPHABET.length) % ALPHABET.length;

    this.setLetter(index, ALPHABET[next]);
    this.setActive(index);
  }

  setLetter(index, ch) {
    this.letters[index] = ch;
    this.slots[index].setText(ch);
  }

  finish(value) {
    if (this.settled) return;
    this.settled = true;

    this.resolve?.(value);
  }

  async hide() {
    await tween(this.root, { alpha: 0, y: -30, duration: 0.28, ease: "sine.in" });
    this.destroy();
  }

  destroy() {
    this.finish(null);
    this.scene.input.keyboard?.off("keydown", this.onKey);
    this.slots.forEach((l) => gsap.killTweensOf(l));
    gsap.killTweensOf(this.root);
    this.root.destroy(true);
  }
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                         */
/* ------------------------------------------------------------------ */

const PANEL_W = 540;
const ROW_W = PANEL_W - 56;
const ROW_H = 46;
const ROW_GAP = 3;

export class LeaderboardPanel {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} opts
   * @param {Array} opts.top            ranked rows from Scoreboard.getTop()
   * @param {object|null} opts.you      the player's row, highlighted
   * @param {number} opts.autoAdvanceSecs
   */
  constructor(scene, { top = [], you = null, autoAdvanceSecs = 0 } = {}) {
    this.scene = scene;
    this.you = you;
    this.autoAdvanceSecs = autoAdvanceSecs;
    this.settled = false;

    this.rows = compose(top, you);
    this.build();
  }

  /** Resolves when the player taps through. */
  show() {
    // Promise first: the intro's onComplete arms the tap handler.
    const done = new Promise((resolve) => {
      this.resolve = resolve;
    });

    this.playIntro();
    return done;
  }

  build() {
    const scene = this.scene;
    const cX = scene.scale.width * 0.5;
    const cY = scene.scale.height * 0.5;

    const listH = Math.max(this.rows.length, 3) * (ROW_H + ROW_GAP);
    const panelH = Math.min(listH + 250, scene.scale.height - 120);
    const top = cY - panelH * 0.5;

    this.title = text(scene, cX, top + 48, "LEADERBOARD", { size: 38, color: COLOR.label });
    this.meta = text(scene, cX, top + 88, metaLine(this.you), { size: 21, color: COLOR.dim });

    const headY = top + 128;
    const head = [
      text(scene, cX - ROW_W * 0.5 + 34, headY, "RANK", { size: 17, color: COLOR.dim }),
      text(scene, cX - ROW_W * 0.5 + 92, headY, "NAME", { size: 17, color: COLOR.dim, origin: [0, 0.5] }),
      text(scene, cX + ROW_W * 0.5 - 12, headY, "SCORE", { size: 17, color: COLOR.dim, origin: [1, 0.5] }),
    ];

    const rule = scene.add.rectangle(cX, headY + 20, ROW_W, 2, FILL.edge).setAlpha(0.3);

    const listTop = headY + 40;
    this.rowViews = this.rows.map((row, i) =>
      this.buildRow(row, cX, listTop + i * (ROW_H + ROW_GAP) + ROW_H * 0.5)
    );

    this.continueText = text(scene, cX, cY + panelH * 0.5 - 38, "TAP TO CONTINUE", { size: 22, color: COLOR.label });

    this.root = scene.add.container(0, 0, [
      dimmer(scene),
      roundedRect(scene, cX, cY, PANEL_W, panelH),
      this.title,
      this.meta,
      ...head,
      rule,
      ...this.rowViews,
      this.continueText,
    ]);
  }

  /** One Container per row, positioned at its centre so scale tweens pivot there. */
  buildRow(row, cX, y) {
    const scene = this.scene;
    const mine = !!row.__you;
    const color = mine ? COLOR.you : COLOR.value;
    const children = [];

    if (mine) {
      const bg = scene.add.graphics();
      bg.fillStyle(FILL.youRow, 0.5);
      bg.fillRoundedRect(-ROW_W * 0.5, -ROW_H * 0.5, ROW_W, ROW_H, 9);
      bg.lineStyle(2, 0x8ef26b, 0.8);
      bg.strokeRoundedRect(-ROW_W * 0.5, -ROW_H * 0.5, ROW_W, ROW_H, 9);
      children.push(bg);
    }

    children.push(
      text(scene, -ROW_W * 0.5 + 34, 0, row.rank ?? "-", { size: 24, color }),
      text(scene, -ROW_W * 0.5 + 92, 0, mine ? `${row.nickname}  (YOU)` : row.nickname, { size: 24, color, origin: [0, 0.5] }),
      text(scene, ROW_W * 0.5 - 12, 0, row.score ?? 0, { size: 24, color, origin: [1, 0.5] })
    );

    const view = scene.add.container(cX, y, children);
    view.mine = mine;

    return view;
  }

  playIntro() {
    const cX = this.scene.scale.width * 0.5;
    const tl = gsap.timeline({ onComplete: () => this.armContinue() });
    this.introTL = tl;

    tl.from(this.root, { alpha: 0, duration: 0.25 }, 0);
    tl.from([this.title, this.meta], { alpha: 0, y: "-=20", duration: 0.35, stagger: 0.07, ease: "back.out(1.6)" }, 0.1);

    this.rowViews.forEach((view, i) => {
      tl.from(view, { alpha: 0, x: cX + 70, duration: 0.32, ease: "back.out(1.2)" }, 0.3 + i * 0.06);
    });

    const you = this.rowViews.find((v) => v.mine);
    if (you) tl.to(you, { scale: 1.06, duration: 0.2, yoyo: true, repeat: 3, ease: "sine.inOut" }, "+=0.15");

    tl.from(this.continueText, { alpha: 0, duration: 0.3 }, ">-0.1");
  }

  armContinue() {
    if (this.settled) return;

    gsap.to(this.continueText, { alpha: 0.3, duration: 0.7, yoyo: true, repeat: -1, ease: "sine.inOut" });

    this.tapCatcher = this.scene.add
      .rectangle(this.scene.scale.width * 0.5, this.scene.scale.height * 0.5, this.scene.scale.width, this.scene.scale.height, 0xffffff)
      .setAlpha(0.001)
      .setInteractive();

    this.tapCatcher.once("pointerdown", () => this.finish());
    this.root.add(this.tapCatcher);

    if (this.autoAdvanceSecs > 0) {
      this.autoCall = gsap.delayedCall(this.autoAdvanceSecs, () => this.finish());
    }
  }

  finish() {
    if (this.settled) return;
    this.settled = true;

    this.autoCall?.kill();
    this.resolve?.();
  }

  async hide() {
    this.tapCatcher?.disableInteractive();

    await tween(this.root, { alpha: 0, duration: 0.3, ease: "sine.in" });
    this.destroy();
  }

  destroy() {
    this.finish();
    this.introTL?.kill();
    this.autoCall?.kill();
    gsap.killTweensOf(this.continueText);
    gsap.killTweensOf(this.root);
    this.rowViews.forEach((v) => gsap.killTweensOf(v));
    this.root.destroy(true);
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Flags the player's row. If their score missed the cut - or they skipped and
 * it was never stored - it is appended so they always see where they landed.
 */
function compose(top, you) {
  const rows = top.map((r) => ({ ...r }));
  if (!you) return rows;

  const mine =
    !you.provisional && rows.find((r) => r.nickname === you.nickname && r.score === you.bestScore);

  if (mine) {
    mine.__you = true;
    return rows;
  }

  rows.push({ rank: you.rank ?? "-", nickname: you.nickname, score: you.score, __you: true });
  return rows;
}

function metaLine(you) {
  if (!you) return "Top players";
  if (you.provisional) return "Score not saved";

  const parts = [];
  if (you.rank) parts.push(`Your rank: #${you.rank}`);
  if (you.bestScore) parts.push(`Best: ${you.bestScore}`);

  return parts.join("     ") || "Top players";
}

function tween(target, vars) {
  return new Promise((done) => gsap.to(target, { ...vars, onComplete: done }));
}

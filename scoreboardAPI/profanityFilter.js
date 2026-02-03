import { Filter } from "bad-words";

// Add extra words here.
const EXTRA_BLOCKLIST = [];

export const filter = new Filter();
filter.addWords(...EXTRA_BLOCKLIST);

export function validateAndSanitizeNickname(raw) {
  if (!raw) return { ok: false, reason: "missing" };

  const cleaned = String(raw)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .slice(0, 12);

  if (cleaned.length < 3) return { ok: false, reason: "too_short" };

  // profanity check
  if (filter.isProfane(cleaned)) return { ok: false, reason: "profanity" };

  return { ok: true, nickname: cleaned };
}

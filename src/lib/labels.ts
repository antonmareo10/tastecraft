// Short labels for names that have to fit a small space (the taste constellation's star labels).
// The full name is always available on hover/focus and to screen readers; this only decides what
// the resting label shows.

const SUBTITLE = /\s+(?:with|feat\.?|ft\.?)\s+|\s*[:|]\s+|\s+[-–—]\s+|\s*\(/i;
const DANGLING = new Set(["the", "a", "an", "of", "and", "&", "with", "de", "la", "el", "y", "by", "for", "in", "on", "at", "-"]);

/**
 * A label of at most about `max` characters:
 *  - the full name when it is at most 2 characters over (no ellipsis for "Harbor Lights Juice");
 *  - else the name before a subtitle, when that fits ("Morning Table with Ann Lee" -> "Morning Table");
 *  - else whole words and an ellipsis, never ending on "the"/"of"/"&" ("Westfield Country Store" -> "Westfield Country…");
 *  - mid-word only when the first word alone is too long.
 */
export function shortLabel(name: string, max: number): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length <= max + 2) return clean;
  const head = clean.split(SUBTITLE)[0]?.trim() ?? "";
  if (head.length >= 3 && head.length <= max + 2 && head.length < clean.length) return head;
  const words = clean.split(" ");
  const kept: string[] = [];
  for (const w of words) {
    if ([...kept, w].join(" ").length > max - 1) break;
    kept.push(w);
  }
  while (kept.length > 1 && DANGLING.has(kept[kept.length - 1].toLowerCase().replace(/[^\p{L}&-]/gu, ""))) kept.pop();
  const cut = kept.join(" ").replace(/[\s,;:.\-–—]+$/, "");
  if (cut.length >= Math.min(4, max - 1)) return `${cut}…`;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

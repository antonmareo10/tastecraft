// Which of a restaurant's Qloo tags to show as chips under its name (playbook header and taste
// constellation). Display only: the agent still receives every tag.
//
// Qloo tags a place with everything it knows, including age buckets, pandemic-era notices and nearby
// landmarks, which read as noise in a header ("35 44", "Staff wear masks", "Royal palace of madrid").
// Recorded runs carry tag names only (no tag types), so the rules work on the text alone and filter
// recorded and live runs the same way. A tag is dropped when it:
//
//   1. repeats an earlier tag (case, accents and spacing ignored): "Authentic" twice;
//   2. contains a digit: Qloo's age buckets ("35 44") and similar codes;
//   3. is a health-and-safety notice ("Staff wear masks", "Contactless payments");
//   4. names a landmark or nearby attraction ("Royal palace of madrid", "Near Central Park");
//   5. is about logistics, payment or access ("Reservations", "Wheelchair accessible seating",
//      "Table service", "Street view").
//
// The word lists match whole words only, so "Parkside grill" or "Viewpoint" are kept.

const HEALTH =
  /\b(masks?|social distanc\w*|sanitiz\w*|sanitis\w*|disinfect\w*|contactless|temperature checks?|covid\w*|vaccin\w*|plexiglass)\b/i;

const LANDMARK =
  /\b(palace|museum|cathedral|basilica|church|plaza|square|park|stadium|arena|station|airport|monument|bridge|tower|pier|boardwalk|zoo|aquarium|university|theat(?:er|re)|landmark|attraction)\b/i;

const LOGISTICS =
  /\b(reservations?|wheelchair|accessible|accessibility|parking|wi-?fi|restrooms?|credit cards?|debit cards?|cash only|payments?|table service|counter service|high chairs?|views?)\b/i;

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Why a tag is not shown in the header, or null when it is. */
export function tagNoise(tag: string): "digits" | "health" | "landmark" | "logistics" | null {
  if (/\d/.test(tag)) return "digits";
  if (HEALTH.test(tag)) return "health";
  if (LANDMARK.test(tag)) return "landmark";
  if (LOGISTICS.test(tag)) return "logistics";
  return null;
}

/** The tags worth showing, in Qloo's order, first spelling kept, at most `max`. */
export function headerTags(tags: readonly (string | null | undefined)[] | undefined, max = Infinity): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw?.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    const key = plain(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (tagNoise(tag)) continue;
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

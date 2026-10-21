// Human labels for Qloo's demographic lens values ("24_and_younger", "female"), so the agent log
// never shows a raw API enum. Used when the agent emits a step and again when a step is displayed,
// which also fixes recordings made before the labels existed.

export type LensLike = { age?: string | null; gender?: string | null };

const GENDER: Record<string, string> = { male: "men", female: "women" };

/** "24_and_younger" -> "ages 24 and younger", "25_to_29" -> "ages 25 to 29", "55_and_older" -> "ages 55 and older". */
export function ageLabel(age: string): string {
  const a = age.trim().toLowerCase();
  let m = /^(\d+)_and_(younger|older)$/.exec(a);
  if (m) return `ages ${m[1]} and ${m[2]}`;
  m = /^(\d+)_to_(\d+)$/.exec(a);
  if (m) return `ages ${m[1]} to ${m[2]}`;
  return a.replace(/[_-]+/g, " ");
}

/** One lens value, age bucket or gender, in plain words. */
export function lensValueLabel(value: string): string {
  const v = value.trim().toLowerCase();
  return GENDER[v] ?? ageLabel(v);
}

/** "ages 24 and younger, women"; undefined when there is no lens. */
export function lensLabel(lens?: LensLike | null): string | undefined {
  const parts = [lens?.age, lens?.gender].filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return parts.length ? parts.map(lensValueLabel).join(", ") : undefined;
}

/** A step label with its lens: "Places your guests also love nearby (ages 24 and younger)". */
export function withLens(label: string, lens?: LensLike | null): string {
  const l = lensLabel(lens);
  return l ? `${label} (${l})` : label;
}

const LENS_SUFFIX = /\s*\(lens:\s*([^)]*)\)\s*$/i;

/**
 * The label to show for an agent step. Rewrites a raw "(lens: 24_and_younger)" suffix from older
 * recordings, and adds the lens to steps whose label did not carry it (taste_gaps, taste_tags)
 * when the tool input had one, so two otherwise identical steps can be told apart.
 */
export function stepLabel(label: string, input?: unknown): string {
  const raw = LENS_SUFFIX.exec(label);
  if (raw) {
    const words = raw[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(lensValueLabel)
      .join(", ");
    return words ? `${label.slice(0, raw.index)} (${words})` : label.slice(0, raw.index);
  }
  const i = (input ?? {}) as Record<string, unknown>;
  const lens = { age: typeof i.lens_age === "string" ? i.lens_age : undefined, gender: typeof i.lens_gender === "string" ? i.lens_gender : undefined };
  const l = lensLabel(lens);
  return l && !label.includes(`(${l})`) ? `${label} (${l})` : label;
}

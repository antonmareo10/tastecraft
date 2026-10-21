// Evidence ledger: every name and number Qloo returned during a run, so the server can check the
// names and scores each piece of evidence cites against what the API actually said (not what the model remembers).

import type { Evidence } from "./types";

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export class EvidenceLedger {
  private facts = new Map<
    string,
    { display: string; scores: Set<number>; affinities: Set<number>; sources: Set<string> }
  >();

  /**
   * Record a name Qloo returned. `scores` keeps every number seen for the name and backs
   * cite verification. `opts.affinity` marks the number as a genuine audience-affinity
   * score (0-100), kept apart so affinityOf() never mistakes a name's popularity, trend change,
   * demographic over/under-index, gap share or comparison delta for its affinity.
   */
  record(name: string | undefined | null, source: string, score?: number | null, opts?: { affinity?: boolean }) {
    if (!name) return;
    const key = normalizeName(name);
    if (!key) return;
    const entry =
      this.facts.get(key) ?? { display: name, scores: new Set<number>(), affinities: new Set<number>(), sources: new Set<string>() };
    if (typeof score === "number" && Number.isFinite(score)) {
      const rounded = Math.round(score);
      entry.scores.add(rounded);
      if (opts?.affinity) entry.affinities.add(rounded);
    }
    entry.sources.add(source);
    this.facts.set(key, entry);
  }

  /** A cite is verified when the name was returned by Qloo in this run and, if a score is quoted, it matches (±1). */
  verifyCite(name: string, score?: number | null): boolean {
    const entry = this.facts.get(normalizeName(name));
    if (!entry) return false;
    if (score == null) return true;
    for (const s of entry.scores) if (Math.abs(s - score) <= 1) return true;
    return false;
  }

  verify(evidence: Evidence[]): { items: Evidence[]; checked: number; verified: number } {
    let checked = 0;
    let verified = 0;
    const items = evidence.map((e) => {
      const ok = e.cites.length > 0 && e.cites.every((c) => this.verifyCite(c.name, c.score));
      checked += 1;
      if (ok) verified += 1;
      return { ...e, verified: ok };
    });
    return { items, checked, verified };
  }

  /**
   * The strongest audience affinity (0-100) Qloo returned for this fact in this run, or null
   * if Qloo gave no affinity for it. Only affinity-tagged numbers count: a name's popularity,
   * trend or demographic numbers never stand in for its affinity. Clamped to [0, 100].
   */
  affinityOf(name: string | undefined | null): number | null {
    if (!name) return null;
    const entry = this.facts.get(normalizeName(name));
    if (!entry || entry.affinities.size === 0) return null;
    return Math.max(0, Math.min(100, Math.max(...entry.affinities)));
  }

  get size(): number {
    return this.facts.size;
  }
}

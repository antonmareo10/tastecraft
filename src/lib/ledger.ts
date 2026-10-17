// Evidence ledger: every fact Qloo returned during a run, so the server can verify each
// claim in the playbook against what the API actually said (not what the model remembers).

import type { Evidence, MenuMove, Playbook } from "./types";

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export class EvidenceLedger {
  private facts = new Map<string, { display: string; scores: Set<number>; sources: Set<string> }>();

  record(name: string | undefined | null, source: string, score?: number | null) {
    if (!name) return;
    const key = normalizeName(name);
    if (!key) return;
    const entry = this.facts.get(key) ?? { display: name, scores: new Set<number>(), sources: new Set<string>() };
    if (typeof score === "number" && Number.isFinite(score)) entry.scores.add(Math.round(score));
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

  /** The strongest affinity (0-100) Qloo returned for this fact in this run, or null if none was numeric. */
  affinityOf(name: string | undefined | null): number | null {
    if (!name) return null;
    const entry = this.facts.get(normalizeName(name));
    if (!entry || entry.scores.size === 0) return null;
    return Math.max(...entry.scores);
  }

  get size(): number {
    return this.facts.size;
  }
}

/**
 * Taste-Fit Score: a single 0-100 number for how strongly the plan's dishes lean on things
 * this restaurant's audience actually over-indexes on. It is the mean Qloo affinity of the
 * *verified* facts the menu moves cite — computed from Qloo's own numbers, never asked of the
 * model. A high score means the plan is built on strong, checked audience signals; it says
 * nothing about how many covers a dish will sell (that is what the one-week test is for).
 */
export function tasteFit(moves: MenuMove[], ledger: EvidenceLedger): Playbook["taste_fit"] | undefined {
  const affinities: number[] = [];
  let grounded = 0;
  for (const m of moves) {
    let moveHasAffinity = false;
    for (const e of m.evidence) {
      if (!e.verified) continue;
      for (const c of e.cites) {
        const a = ledger.affinityOf(c.name);
        if (a != null) {
          affinities.push(a);
          moveHasAffinity = true;
        }
      }
    }
    if (moveHasAffinity) grounded += 1;
  }
  if (affinities.length === 0) return undefined;
  const score = Math.round(affinities.reduce((sum, a) => sum + a, 0) / affinities.length);
  return { score, facts: affinities.length, moves_grounded: grounded, moves_total: moves.length };
}

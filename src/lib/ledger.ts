// Evidence ledger: every fact Qloo returned during a run, so the server can verify each
// claim in the playbook against what the API actually said (not what the model remembers).

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

  get size(): number {
    return this.facts.size;
  }
}

// Concerts near the restaurant, ordered by how strongly its audience over-indexes on each billed artist.
// 1. Ticketmaster lists every music event within ~25 km in the next 35 days (no artist filter).
// 2. Qloo's official harness `rank` workflow scores the distinct billed artists for the restaurant's audience
//    (option_type artist, signals = the restaurant, signal_location = the city) in one comparable call.
// 3. Ambiguous or unknown artist names are dropped and the ranking is retried once; if ranking fails
//    entirely we fall back to the old keyword search for the artists the agent supplied.

import { rank as harnessRank, type HarnessResult, type RankedOption } from "./qloo-harness";
import { billedArtists, nearbyShows, normalizeArtist, upcomingMusicEvents, type MusicListing, type Show } from "./qloo-tasks";

export type RankFn = (
  opts: { options: string[]; optionType: "artist"; signals?: string[]; location?: string },
) => Promise<HarnessResult<RankedOption[]>>;

export type ArtistScore = { input: string; name: string; entityId: string; rank: number; fanMatch?: number };

export type ArtistRanking =
  | { ok: true; scores: ArtistScore[]; dropped: string[]; calls: number }
  | { ok: false; reason: string; dropped: string[]; calls: number };

export const MAX_RANKED_ARTISTS = 10;
export const MAX_MATCHED_SHOWS = 5;

/** Waits after a Qloo rate limit before ranking again (2.5 s, then 5 s). */
export const RATE_LIMIT_WAITS_MS = [2500, 5000];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Ranks artist names for the restaurant's audience. At most two ranking attempts with different options (the second
 * only after dropping unresolved names); an attempt that hits Qloo's rate limit is repeated after a short wait.
 */
export async function rankArtistsForAudience(
  opts: { artists: string[]; restaurantId: string; city?: string },
  rankFn: RankFn = harnessRank,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<ArtistRanking> {
  const firstSpelling = new Map<string, string>();
  for (const a of opts.artists) if (normalizeArtist(a) && !firstSpelling.has(normalizeArtist(a))) firstSpelling.set(normalizeArtist(a), a.trim());
  let options = [...firstSpelling.values()].slice(0, MAX_RANKED_ARTISTS);
  const dropped: string[] = [];
  let calls = 0;
  let rateLimited = 0;
  for (let call = 1; call <= 2; call++) {
    if (!options.length) return { ok: false, reason: "No artist name could be matched to a Qloo entity.", dropped, calls };
    calls += 1;
    const r = await rankFn({ options, optionType: "artist", signals: [opts.restaurantId], ...(opts.city ? { location: opts.city } : {}) });
    if (!r.ok && r.status === "error" && r.error.code === "QLOO_RATE_LIMIT" && rateLimited < RATE_LIMIT_WAITS_MS.length) {
      // The run's other Qloo calls can exhaust the rate limit for a moment: wait and try the same options again.
      await wait(RATE_LIMIT_WAITS_MS[rateLimited++]);
      call -= 1;
      continue;
    }
    if (r.ok) {
      const scores = r.data.map((o) => ({
        input: o.input ?? o.name,
        name: o.name,
        entityId: o.entityId,
        rank: o.rank,
        ...(typeof o.affinity === "number" ? { fanMatch: Math.round(Math.min(1, Math.max(0, o.affinity)) * 100) } : {}),
      }));
      return { ok: true, scores, dropped, calls };
    }
    if (r.status === "needs_input" && call === 1) {
      const bad = new Set(r.issues.filter((i) => i.field === "options" && options.includes(i.input)).map((i) => i.input));
      if (bad.size === 0) return { ok: false, reason: r.summary, dropped, calls }; // e.g. the restaurant itself did not resolve
      dropped.push(...bad);
      options = options.filter((o) => !bad.has(o));
      continue;
    }
    return {
      ok: false,
      reason: r.status === "error" ? `${r.error.code}: ${r.error.message}` : `${r.summary} (${r.issues.map((i) => `${i.input}: ${i.status}`).join(", ")})`,
      dropped,
      calls,
    };
  }
  return { ok: false, reason: "Ranking did not complete.", dropped, calls };
}

/** Attaches fan_match to each listed concert (best-matching billed artist) and keeps the top matches. */
export function attachFanMatch(listings: MusicListing[], scores: ArtistScore[], max = MAX_MATCHED_SHOWS): Show[] {
  const byName = new Map<string, ArtistScore>();
  for (const s of scores) {
    byName.set(normalizeArtist(s.input), s);
    if (!byName.has(normalizeArtist(s.name))) byName.set(normalizeArtist(s.name), s);
  }
  const matched: { show: Show; rank: number }[] = [];
  for (const l of listings) {
    let best: { artist: string; score: ArtistScore } | undefined;
    for (const a of l.attractions) {
      const s = byName.get(normalizeArtist(a));
      if (s && (!best || s.rank < best.score.rank)) best = { artist: a, score: s };
    }
    if (!best) continue;
    const show: Show = {
      artist: best.artist,
      event: l.event,
      venue: l.venue,
      date: l.date,
      ...(l.url ? { url: l.url } : {}),
      ...(l.distance_km != null ? { distance_km: l.distance_km } : {}),
      kind: "music",
      ...(best.score.fanMatch != null ? { fan_match: best.score.fanMatch } : {}),
    };
    matched.push({ show, rank: best.score.rank });
  }
  const seen = new Set<string>();
  return matched
    .sort((a, b) => (b.show.fan_match ?? -1) - (a.show.fan_match ?? -1) || a.rank - b.rank || a.show.date.localeCompare(b.show.date))
    .map((m) => m.show)
    .filter((s) => {
      const k = `${normalizeArtist(s.event)}|${s.date}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max);
}

export type ConcertMatch = {
  shows: Show[];
  strategy: "qloo_rank" | "keyword_fallback";
  scores: ArtistScore[];
  dropped: string[];
  rankCalls: number;
  /** Why the keyword fallback was used, or why nothing came back. */
  note?: string;
};

export type ConcertDeps = {
  rank: RankFn;
  listEvents: typeof upcomingMusicEvents;
  keywordSearch: typeof nearbyShows;
};

const defaultDeps: ConcertDeps = { rank: harnessRank, listEvents: upcomingMusicEvents, keywordSearch: nearbyShows };

export async function matchConcerts(
  opts: { lat: number; lon: number; city?: string; restaurantId?: string; artists: string[] },
  deps: Partial<ConcertDeps> = {},
): Promise<ConcertMatch> {
  const d = { ...defaultDeps, ...deps };
  const fallback = async (note: string, ranking?: { dropped: string[]; calls: number }): Promise<ConcertMatch> => ({
    shows: opts.artists.length ? await d.keywordSearch({ artists: opts.artists, lat: opts.lat, lon: opts.lon }) : [],
    strategy: "keyword_fallback",
    scores: [],
    dropped: ranking?.dropped ?? [],
    rankCalls: ranking?.calls ?? 0,
    note,
  });

  if (!opts.restaurantId) return fallback("No Qloo restaurant entity to rank artists against.");
  const listing = await d.listEvents({ lat: opts.lat, lon: opts.lon });
  if (listing === null) return fallback("Ticketmaster's event listing was unavailable.");
  const names = billedArtists(listing, MAX_RANKED_ARTISTS);
  if (!names.length) return { shows: [], strategy: "qloo_rank", scores: [], dropped: [], rankCalls: 0, note: "No music events listed nearby in the next 5 weeks." };

  const ranking = await rankArtistsForAudience({ artists: names, restaurantId: opts.restaurantId, city: opts.city }, d.rank);
  if (!ranking.ok) return fallback(`Qloo ranking unavailable (${ranking.reason}).`, ranking);
  if (!ranking.scores.length) return fallback("Qloo returned no scores for the listed artists.", ranking);
  return {
    shows: attachFanMatch(listing, ranking.scores),
    strategy: "qloo_rank",
    scores: ranking.scores,
    dropped: ranking.dropped,
    rankCalls: ranking.calls,
  };
}

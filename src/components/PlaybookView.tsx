"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, m } from "motion/react";
import { gainPct, HELD_OUT } from "@/lib/benchmark";
import { dishLowCount, isLowCount, liftLabel, LOW_COUNT_MENUS, type TermLift } from "@/lib/lift";
import { displayMenuTerms, supportedFirst } from "@/lib/menu-terms";
import { headerTags } from "@/lib/place-tags";
import { EASE_OUT, REVEAL, STAGGER } from "@/lib/motion";
import type { CrowdLift, EntityRef, HeatCell, Playbook, Resolution, ShowRef, TrendLine, Zone } from "@/lib/types";
import {
  IconBasket,
  IconCheck,
  IconDownload,
  IconGap,
  IconMap,
  IconMegaphone,
  IconMusic,
  IconPlate,
  IconSpark,
  IconTrend,
  IconUsers,
} from "./icons";
import { AffinityBar, CopyButton, EvidenceLine, HowLink, Pill, Section } from "./ui";
import { InViewGroup, KineticText, NumberReveal, Reveal } from "./fx";
import { InfoPopover } from "./Popover";
import SectionNav from "./SectionNav";
import { toast } from "./Toaster";
import ShareAssets from "./ShareAssets";
import TasteConstellation from "./TasteConstellation";

const TasteMap = dynamic(() => import("./TasteMap"), {
  ssr: false,
  loading: () => <div className="shimmer h-[380px] rounded-xl bg-paper-2" />,
});

const DOMAIN_LABEL: Record<string, string> = {
  place: "Places they also love",
  brand: "Brands",
  artist: "Music",
  movie: "Movies",
  tv_show: "TV",
  book: "Books",
  podcast: "Podcasts",
  destination: "Travel",
  video_game: "Games",
  person: "People",
};

function termLine(t: TermLift, cl: Pick<CrowdLift, "crowd_n" | "city_n">): string {
  return `${t.term}: on the menus of ${t.crowd} of ${cl.crowd_n} restaurants your guests love most vs ${t.city} of ${cl.city_n} of the city's most popular (${liftLabel(t.lift)}${isLowCount(t) ? ", low count" : ""})`;
}

const LOW_COUNT_HELP = `Low count: the term is on fewer than ${LOW_COUNT_MENUS} menus in both lists together, so its lift rests on a handful of restaurants (4 menus vs 0 already reads about ×4.8). Treat it as a hint, not a measurement.`;

const LIFT_HELP = `Crowd lift compares two Qloo lists for the city: the ~150 restaurants this crowd loves most (Qloo affinity) and the city's ~150 most popular restaurants, counting only the ones with menu tags in Qloo. For each food term in a dish name, it divides the share of the crowd's restaurants that serve it by the share of the city's that do (add-one smoothed). ×1.0 = no difference; above 1 = your crowd favours it. The ruler is Qloo's own menu tags: it measures whether dishes follow this crowd's Qloo signal, not demand. Computed by Tastecraft, never written by the model. The agent sees this crowd-vs-city contrast while planning, so a playbook's own score is in-sample; on restaurants the model never saw, the benchmark measured ${gainPct(HELD_OUT.ratio)} over the same model alone. ${LOW_COUNT_HELP} It says nothing about how many covers a dish will sell.`;

const VERIFY_HELP =
  "Each evidence line cites the Qloo names (places, artists, tags) and 0-100 scores it relies on. The server checks that every cited name was returned by Qloo in this run and that every cited score is within 1 of a number Qloo returned for that name. Other numbers in the sentence, such as menu shares, are not checked.";

function money(v: number, currency: string): string {
  try {
    return v.toLocaleString("en-GB", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 2 });
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

export type LiveState = {
  restaurant?: EntityRef & { lat?: number; lon?: number };
  resolution?: Resolution;
  dna: Record<string, EntityRef[]>;
  heatmap?: { cells: HeatCell[]; zones: Zone[]; center: [number, number] };
  baseline?: string;
  playbook?: Playbook;
  demographics?: { age: Record<string, number>; gender: Record<string, number> };
  compare?: { a: string; b: string; only_a: string[]; only_b: string[]; shared: string[] };
  shows?: ShowRef[];
  trends?: TrendLine[];
  draft?: Record<string, unknown>;
  tags: Partial<Record<"dishes" | "cuisines" | "ambience", { name: string; affinity?: number }[]>>;
  crowdMenu?: { city: string; crowd_n: number; city_n: number; favours: TermLift[]; avoids: TermLift[] };
};

export type Alternative = Resolution["alternatives"][number];

const ACTS = [
  ["act-read", "1 · Read the room"],
  ["act-moves", "2 · The moves"],
  ["act-premiere", "3 · Opening night"],
] as const;

export default function PlaybookView({
  live,
  running,
  language,
  onPickAlternative,
}: {
  live: LiveState;
  running: boolean;
  language?: "English" | "Español";
  onPickAlternative?: (alt: Alternative) => void;
}) {
  const p = live.playbook;
  const liveShows = live.shows;
  const domains = Object.keys(live.dna).filter((d) => live.dna[d]?.length);
  // Qloo's tags minus age buckets, health notices, landmarks, logistics and repeats (src/lib/place-tags.ts).
  const tags = headerTags(live.restaurant?.tags, 6);
  const lowDishes = p?.menu_moves.filter((mv) => mv.lift != null && dishLowCount(mv.lift_terms)).length ?? 0;

  return (
    <div className="space-y-5">
      {/* Restaurant + headline */}
      {(live.restaurant || p) && (
        <m.section
          initial="hidden"
          animate="shown"
          variants={REVEAL}
          className="on-dark relative overflow-hidden rounded-2xl border border-line bg-olive text-paper"
        >
          {/* A soft warm light in the corner, like the home page's. */}
          <span
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(221,154,46,0.22),transparent_65%)]"
          />
          <div className="grain relative px-6 py-6 sm:px-8 sm:py-8">
            <div className="flex items-start justify-between gap-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-paper/70">Taste playbook</p>
              {p && !running && (
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="no-print inline-flex min-h-8 items-center gap-1.5 pointer-coarse:min-h-11 pointer-coarse:px-4 rounded-full border border-paper/30 px-3 py-1 text-xs text-paper/90 transition hover:bg-paper/10 active:scale-[0.97]"
                >
                  <IconDownload size={13} /> Save as PDF
                </button>
              )}
            </div>
            <h2 className="font-display mt-1 text-3xl leading-tight sm:text-4xl">
              {p?.restaurant.name ?? live.restaurant?.name}
            </h2>
            <p className="mt-1 text-sm text-paper/80">
              {p ? `${p.restaurant.concept} · ${p.restaurant.city}` : live.restaurant?.subtitle}
            </p>
            {live.resolution && <MatchNote resolution={live.resolution} running={running} onPick={onPickAlternative} />}
            {tags.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {tags.map((t, i) => (
                  <m.li
                    key={t}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.15 + i * STAGGER }}
                    className="rounded-full border border-paper/25 px-2.5 py-0.5 text-xs text-paper/85"
                  >
                    {t}
                  </m.li>
                ))}
              </ul>
            )}
            {p?.headline ? (
              <m.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease: EASE_OUT }}
                className="font-display mt-5 max-w-3xl text-xl leading-snug text-paper sm:text-2xl"
              >
                “{p.headline}”
              </m.p>
            ) : null}
            {p?.crowd_lift?.score != null ? (
              <m.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease: EASE_OUT, delay: 0.12 }}
                className="mt-5 max-w-2xl rounded-2xl border border-paper/25 bg-paper/10 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="font-display text-4xl leading-none text-paper">
                    <NumberReveal value={Math.round(p.crowd_lift.score * 10) / 10} decimals={1} prefix="×" delay={150} />
                  </span>
                  <div className="leading-tight">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-paper/90">
                      Crowd lift · this run <span className="font-normal normal-case tracking-normal text-paper/80">(in-sample)</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-paper/80">
                      Your guests’ favourite restaurants serve dishes like these {liftLabel(p.crowd_lift.score).slice(1)}× as often as{" "}
                      {p.crowd_lift.city}’s most popular ones ({p.crowd_lift.matched} of {p.crowd_lift.total} dishes matched on local menus).
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-paper/75">
                  In-sample: the agent saw the crowd-vs-city contrast this score is computed from
                  {lowDishes > 0
                    ? `, and ${lowDishes} of ${p.crowd_lift.total} dishes rest on terms found on fewer than ${LOW_COUNT_MENUS} menus (low count)`
                    : ""}
                  . On restaurants the model never saw, Qloo’s contrast measured {gainPct(HELD_OUT.ratio)} over the same model alone.{" "}
                  <HowLink label="How is crowd lift measured?" title="Crowd lift" tone="dark">
                    {LIFT_HELP}
                  </HowLink>
                </p>
              </m.div>
            ) : null}
            {p?.verification && p.verification.checked > 0 ? (
              <m.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.24 }}
                className="mt-4 flex w-fit max-w-full items-start gap-2 rounded-2xl border border-paper/25 px-3 py-1.5 text-xs leading-snug text-paper/85"
              >
                <IconCheck size={13} className="mt-px shrink-0" />
                <span>
                  <NumberReveal value={p.verification.verified} delay={250} /> of {p.verification.checked} evidence lines check
                  out: every Qloo name and score they cite was returned in this run
                  <span aria-hidden className="px-1.5 opacity-60">·</span>
                  <HowLink label="What is checked?" title="What is checked" tone="dark">
                    {VERIFY_HELP}
                  </HowLink>
                </span>
              </m.p>
            ) : running ? (
              <p className="mt-5 text-sm text-paper/70">Building the playbook from live taste data…</p>
            ) : null}
          </div>
        </m.section>
      )}

      {/* The with/without-Qloo comparison comes first: it is what the playbook's number means. */}
      {p && live.baseline && <Compare baseline={live.baseline} playbook={p} />}

      {/* One compact row: it scrolls sideways on narrow phones instead of wrapping. */}
      {p && !running && <SectionNav items={ACTS} />}

      {(domains.length > 0 || live.demographics) && (
        <ActHeader id="act-read" n={1} title="Read the room" subtitle="Who your guests are and what they love, straight from Qloo’s taste graph." />
      )}

      {/* Audience DNA from live Qloo results */}
      {domains.length > 0 && (
        <Section icon={<IconUsers size={16} />} kicker="Audience taste DNA" title="What your guests also love">
          {p?.audience_dna.summary && <p className="mb-4 max-w-3xl text-[15px] leading-relaxed text-ink-2">{p.audience_dna.summary}</p>}
          <div className="mb-5">
            <TasteConstellation
              center={{ name: p?.restaurant.name ?? live.restaurant?.name ?? "Your restaurant", tags }}
              domains={live.dna}
            />
          </div>
          <InViewGroup amount={0.15} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {domains.map((d) => (
              <div key={d} className="lift min-w-0 rounded-xl border border-line bg-paper/50 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                  {DOMAIN_LABEL[d] ?? d}
                </p>
                <ul className="space-y-1.5">
                  {live.dna[d].slice(0, 6).map((e, i) => (
                    <li key={e.entity_id} className="flex items-center justify-between gap-3">
                      <span className="line-clamp-2 min-w-0 break-words text-sm leading-snug" title={e.subtitle ? `${e.name} · ${e.subtitle}` : e.name}>
                        {e.name}
                      </span>
                      <AffinityBar value={e.affinity} index={i} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </InViewGroup>
          <p className="mt-3 text-[11px] leading-snug text-muted">
            Scores (0–100) come straight from Qloo’s taste graph. They describe what people who like this restaurant tend to like, in
            aggregate, not what any one guest will do.
          </p>
        </Section>
      )}

      {live.trends && live.trends.length > 0 && <RisingAroundYou series={live.trends} restaurantId={live.restaurant?.entity_id} />}

      {!p && live.draft && <DraftPreview draft={live.draft} />}

      {(live.demographics || live.crowdMenu || Object.keys(live.tags).length > 0) && (
        <Section icon={<IconPlate size={16} />} kicker="Cravings & crowd" title="What they crave, and who they are">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {live.crowdMenu && live.crowdMenu.favours.length > 0 && <CrowdMenu data={live.crowdMenu} />}
              {(["dishes", "cuisines", "ambience"] as const)
                .filter((fam) => !(fam === "dishes" && live.crowdMenu?.favours.length))
                .map((fam) =>
                  live.tags[fam]?.length ? (
                    <div key={fam} className="rounded-xl border border-line bg-paper/50 p-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                        {{ dishes: "Dishes", cuisines: "Cuisines", ambience: "Vibe" }[fam]}
                      </p>
                      <ol className="space-y-1.5">
                        {live.tags[fam]!.slice(0, 6).map((t, i) => (
                          <li
                            key={t.name}
                            className="flex items-baseline gap-2 text-sm leading-snug"
                            title={typeof t.affinity === "number" ? `Qloo affinity ${Math.round(t.affinity * 1000) / 10}/100` : undefined}
                          >
                            <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted">{i + 1}</span>
                            <span className="min-w-0">{t.name}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null,
                )}
            </div>
            {live.demographics && <Demographics data={live.demographics} />}
          </div>
          <p className="mt-3 text-[11px] leading-snug text-muted">
            Qloo’s tag affinity puts what is popular everywhere near 100 for almost any audience, so cuisines and vibe are shown in Qloo’s
            order; the menu column compares this crowd with the city to show what is specific to it.
          </p>
        </Section>
      )}

      {/* Taste map */}
      {live.heatmap && live.heatmap.cells.length > 0 && (
        <Section icon={<IconMap size={16} />} kicker="Taste map" title="Where your kind of guest lives and goes out">
          <TasteMap
            cells={live.heatmap.cells}
            zones={live.heatmap.zones}
            center={live.heatmap.center}
            restaurant={live.restaurant}
          />
          {p?.marketing.target_zones?.length ? (
            <ol className="mt-4 grid gap-3 sm:grid-cols-3">
              {p.marketing.target_zones.map((z, i) => (
                <li key={z.name} className="rounded-xl border border-line bg-paper/50 p-3">
                  <p className="text-sm font-semibold">
                    {i + 1}. {z.name}
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-ink-2">{z.reason}</p>
                </li>
              ))}
            </ol>
          ) : null}
        </Section>
      )}

      {live.compare && (live.compare.only_a.length > 0 || live.compare.only_b.length > 0) && (
        <Section icon={<IconGap size={16} />} kicker="Head-to-head" title={`What sets you apart from ${live.compare.b}`}>
          <p className="mb-3 text-[13px] text-ink-2">
            Qloo’s head-to-head of the two places: what Qloo knows only one of you for (vibe, cuisine, occasion, crowd). It describes how
            each place is positioned, not a measured difference between the two audiences.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                [`Only ${live.compare.a}`, live.compare.only_a, "border-olive/30 bg-olive/5"],
                [`Only ${live.compare.b}`, live.compare.only_b, "border-line bg-paper/60"],
              ] as const
            ).map(([label, tags, tone]) => (
              <div key={label}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
                {tags.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {tags.map((t) => (
                      <li key={t} className={`rounded-full border px-3 py-1 text-sm ${tone}`}>
                        {t}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Nothing Qloo tags only here.</p>
                )}
              </div>
            ))}
          </div>
          {live.compare.shared.length > 0 && (
            <p className="mt-3 text-[12px] text-muted">Both: {live.compare.shared.slice(0, 6).join(" · ")}</p>
          )}
        </Section>
      )}

      {p && (
        <>
          <ActHeader
            id="act-moves"
            n={2}
            title="The moves"
            subtitle="What to cook, what to host and who to tell. ✓ marks evidence whose cited Qloo names and scores were returned in this run; the moves themselves are our read of them: bets to test, not predictions."
          />
          {p.taste_gaps.length > 0 && (
            <Section icon={<IconGap size={16} />} kicker="Taste gaps" title="What locals love that you don’t serve yet">
              <ul className="grid gap-3 md:grid-cols-2">
                {p.taste_gaps.map((g) => (
                  <li key={g.tag} className="lift rounded-xl border border-line bg-paper/50 p-4">
                    <Pill tone="terracotta">{g.tag}</Pill>
                    <p className="mt-2 text-sm leading-snug">{g.opportunity}</p>
                    <p className="mt-1.5 text-[12px] leading-snug text-muted">{g.evidence}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section icon={<IconPlate size={16} />} kicker="Menu moves" title="Three dishes to test next week">
            <div className="grid gap-4 lg:grid-cols-3">
              {p.menu_moves.map((mv, n) => {
                const cl = p.crowd_lift;
                const low = dishLowCount(mv.lift_terms);
                return (
                <Reveal as="article" key={mv.dish} delay={n * 0.08} amount={0.2} margin="0px" className="flex flex-col">
                <div className="lift flex flex-1 flex-col rounded-xl border border-line bg-paper/40 p-4">
                  <h4 className="font-display text-lg leading-tight">{mv.dish}</h4>
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    {mv.lift != null && cl ? (
                      <InfoPopover
                        // Starts with the visible text ("×2.9 crowd lift"), so voice control and screen readers agree (WCAG 2.5.3).
                        label={`${liftLabel(mv.lift)} ${low ? "crowd lift · low count" : "crowd lift"}: show the local menu counts behind it`}
                        title={`Crowd lift for this dish: ${liftLabel(mv.lift)}${low ? " (low count)" : ""}`}
                        trigger={
                          <>
                            {liftLabel(mv.lift)}{" "}
                            <span aria-hidden className="font-normal opacity-80">
                              {low ? "crowd lift · low count" : "crowd lift"}
                            </span>
                          </>
                        }
                        className={`relative inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold transition hover:brightness-95 before:absolute before:-inset-3 before:content-[''] ${
                          low
                            ? "border border-dashed border-ink-2/35 bg-paper text-ink-2"
                            : mv.lift >= 1
                              ? "bg-olive/10 text-olive"
                              : "bg-terracotta/10 text-terracotta-ink"
                        }`}
                      >
                        <ul className="space-y-1.5">
                          {(mv.lift_terms ?? []).map((t) => (
                            <li key={t.term}>{termLine(t, cl)}</li>
                          ))}
                        </ul>
                        {low && <p className="mt-2 text-muted">{LOW_COUNT_HELP}</p>}
                      </InfoPopover>
                    ) : (
                      <span />
                    )}
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-olive">
                      {money(mv.price, p.currency)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-snug text-ink-2">{mv.description}</p>
                  {cl && mv.lift_terms && mv.lift_terms.length > 0 && (
                    <p className="mt-1.5 text-[12px] leading-snug text-muted">
                      On local menus, your crowd’s vs the city’s:{" "}
                      {mv.lift_terms.map((t, i) => (
                        <span key={t.term}>
                          {i > 0 && " · "}
                          <span className="font-medium text-ink-2">{t.term}</span> {t.crowd} of {cl.crowd_n} vs {t.city} of {cl.city_n}
                          {isLowCount(t) && <span className="text-terracotta-ink"> (low count)</span>}
                        </span>
                      ))}
                    </p>
                  )}
                  <p className="mt-3 text-[13px] leading-snug">
                    <span className="font-semibold">Our read: </span>
                    {mv.why}
                  </p>
                  {mv.evidence.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-line pt-3" aria-label="Qloo evidence">
                      <li className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Qloo evidence</li>
                      {mv.evidence.map((ev, i) => (
                        <EvidenceLine key={`${mv.dish}-${i}`} evidence={ev} />
                      ))}
                    </ul>
                  )}
                </div>
                </Reveal>
                );
              })}
            </div>
            <p className="mt-3 text-[12px] leading-snug text-muted">
              Shares quoted in the agent’s text compare your guests’ ~150 favourite restaurants with the city’s ~150 most popular ones in
              Qloo (“citywide” means the latter, not every restaurant in the city). The agent quotes them; only the cited Qloo names and
              scores are checked.
            </p>
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section icon={<IconMusic size={16} />} kicker="Experience" title={p.experience.event_idea}>
              <p className="text-sm leading-relaxed text-ink-2">{p.experience.event_why}</p>
              <p className="mt-3 text-sm leading-relaxed">
                <span className="font-semibold">Ambience: </span>
                {p.experience.ambience}
              </p>
              {(p.experience.show_tieins?.length ?? 0) > 0 && (
                <>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Concerts & game days nearby</p>
                  <ul className="mt-2 space-y-2">
                    {p.experience.show_tieins!.map((sh) => {
                      const live = liveShows?.find((x) => x.artist === sh.artist && x.date === sh.date);
                      return (
                        <li key={`${sh.artist}-${sh.date}`} className="rounded-lg border border-line bg-paper/60 p-3 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 font-semibold">
                              {sh.artist} · {sh.date} · {sh.venue}
                              {live?.distance_km != null && <span className="font-normal text-muted"> ({live.distance_km} km)</span>}
                            </p>
                            {live?.fan_match != null && <FanMatch value={live.fan_match} />}
                          </div>
                          <p className="mt-0.5 leading-snug text-ink-2">{sh.idea}</p>
                          {live?.url && (
                            <a href={live.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-olive underline underline-offset-2">
                              Event page
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {p.experience.playlist.length > 0 && (
                <>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Playlist seeds</p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {p.experience.playlist.map((a) => (
                      <li key={a}>
                        <Pill>{a}</Pill>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>

            <Section
              icon={<IconMegaphone size={16} />}
              kicker="Local marketing"
              title="Ready-to-post"
              aside={<CopyButton text={p.marketing.instagram_post} label="Copy post" done="Post copied, ready to paste" />}
            >
              <p className="whitespace-pre-line rounded-xl border border-line bg-paper/50 p-4 text-sm leading-relaxed">
                {p.marketing.instagram_post}
              </p>
              {p.marketing.collab_partners.length > 0 && (
                <>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Collab partners</p>
                  <ul className="mt-2 space-y-2">
                    {p.marketing.collab_partners.map((c) => (
                      <li key={c.name} className="text-sm leading-snug">
                        <span className="font-semibold">{c.name}</span>
                        <span className="text-ink-2"> — {c.why}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>
          </div>

          <ActHeader id="act-premiere" n={3} title="Opening night" subtitle="Everything to launch it next week: print-ready assets, the supplier order and the plan." />

          <ShareAssets playbook={p} language={language} />

          <ShoppingList playbook={p} />

          {p.week_plan?.length > 0 && <WeekPlan playbook={p} />}

          {p.caveats.length > 0 && (
            <section className="rounded-2xl border border-dashed border-line px-5 py-4 text-[13px] leading-relaxed text-muted">
              <p className="font-semibold text-ink-2">What the data can’t tell us</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {p.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// Qloo affinity of the concert's artist for this restaurant's audience (harness rank workflow).
function FanMatch({ value }: { value: number }) {
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full bg-saffron/20 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink"
      title="How strongly your guests over-index on this artist (Qloo affinity, 0-100)"
    >
      Fan match {value}
    </span>
  );
}

const DIRECTION: Record<TrendLine["direction"], { label: string; tone: string; stroke: string }> = {
  rising: { label: "Rising", tone: "border-olive/25 bg-olive/10 text-olive", stroke: "var(--olive)" },
  falling: { label: "Falling", tone: "border-terracotta/25 bg-terracotta/10 text-terracotta-ink", stroke: "var(--terracotta)" },
  steady: { label: "Steady", tone: "border-line bg-paper text-ink-2", stroke: "var(--muted)" },
  no_data: { label: "No data", tone: "border-line bg-paper text-muted", stroke: "var(--muted)" },
};

const monthYear = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

function trendSentence(s: TrendLine): string {
  if (s.direction === "no_data" || s.change == null) return `${s.name}: no trend data from Qloo`;
  const unit = s.metric === "rank" ? "rank places" : "percentile points";
  const span = s.points.length > 1 ? ` between ${monthYear(s.points[0].date)} and ${monthYear(s.points[s.points.length - 1].date)}` : "";
  if (s.direction === "steady") return `${s.name}: steady popularity (${s.change >= 0 ? "+" : "minus "}${Math.abs(s.change)} ${unit})${span}`;
  return `${s.name}: ${s.direction}, ${s.change > 0 ? "up" : "down"} ${Math.abs(s.change)} ${unit}${span}`;
}

function Sparkline({ series }: { series: TrendLine }) {
  const W = 96;
  const H = 28;
  // Ranks: smaller is better, so flip them to make "up" mean more popular.
  const ys = series.points.map((pt) => (series.metric === "rank" ? -pt.value : pt.value));
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const coords = ys.map((v, i) => {
    const x = ys.length > 1 ? (i / (ys.length - 1)) * (W - 6) + 3 : W / 2;
    const y = max === min ? H / 2 : H - 3 - ((v - min) / (max - min)) * (H - 6);
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const;
  });
  const last = coords[coords.length - 1];
  const color = DIRECTION[series.direction].stroke;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={trendSentence(series)} className="shrink-0">
      <polyline points={coords.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      {last && <circle cx={last[0]} cy={last[1]} r={2.4} fill={color} />}
    </svg>
  );
}

// Act 1: which of the restaurant's local peers are gaining or losing popularity (Qloo trends, aggregate).
function RisingAroundYou({ series, restaurantId }: { series: TrendLine[]; restaurantId?: string }) {
  const order = { rising: 0, steady: 1, falling: 2, no_data: 3 } as const;
  const rows = [...series].sort(
    (a, b) =>
      Number(b.entity_id === restaurantId) - Number(a.entity_id === restaurantId) ||
      order[a.direction] - order[b.direction] ||
      (b.change ?? 0) - (a.change ?? 0),
  );
  const dates = series.flatMap((s) => s.points.map((pt) => pt.date)).sort();
  return (
    <Section icon={<IconTrend size={16} />} kicker="Rising around you" title="Which local favourites are gaining momentum">
      <p className="mb-3 max-w-2xl text-[13px] leading-snug text-ink-2">
        Qloo popularity trends for your restaurant and the places your guests love most nearby
        {dates.length > 1 ? `, ${monthYear(dates[0])} to ${monthYear(dates[dates.length - 1])}` : ""}. Rising peers show what is
        working around you right now.
      </p>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper/50">
        {rows.map((s) => {
          const d = DIRECTION[s.direction];
          const you = s.entity_id === restaurantId;
          const hasLine = s.direction !== "no_data" && s.points.length > 1;
          return (
            <li key={s.entity_id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="truncate font-medium" title={s.name}>
                    {s.name}
                  </span>
                  {you && (
                    <span className="shrink-0 rounded-full bg-olive px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.1em] text-paper">
                      You
                    </span>
                  )}
                </p>
                {!hasLine && <p className="text-[12px] text-muted">No trend data from Qloo for this place</p>}
              </div>
              {hasLine && <Sparkline series={s} />}
              {hasLine && s.change != null && (
                <span
                  aria-hidden
                  className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs tabular-nums ${d.tone}`}
                >
                  {d.label}
                  <span className="font-semibold">
                    {s.change > 0 ? "+" : s.change < 0 ? "−" : "±"}
                    {Math.abs(s.change)}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] leading-snug text-muted">
        Change = average popularity percentile over the last ~30 days minus the first ~30 days, in points out of 100. It describes
        aggregate momentum, not why it happens or what any one guest will do.
      </p>
    </Section>
  );
}

const MATCH_LABEL: Record<Resolution["match"], string> = {
  owner_confirmed: "Confirmed by you",
  exact: "Exact name match",
  close: "Close name match",
  best_guess: "Best guess",
};

// Shows which Qloo entity the analysis is about and lets the owner switch before relying on it.
function MatchNote({
  resolution,
  running,
  onPick,
}: {
  resolution: Resolution;
  running: boolean;
  onPick?: (alt: Alternative) => void;
}) {
  const unsure = resolution.status !== "resolved";
  // The call to action only appears where the owner can act on it (a live run with candidates to
  // pick from); a replay just states the match.
  const alts = onPick && !running ? resolution.alternatives : [];
  const weakName = resolution.match === "close" || resolution.match === "best_guess";
  return (
    <div className="no-print mt-3 text-xs text-paper/85">
      <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`rounded-full px-2 py-0.5 ${weakName ? "bg-saffron/90 text-ink" : "border border-paper/30"}`}>
          Qloo match: {MATCH_LABEL[resolution.match]}
        </span>
        {unsure && alts.length > 0 && (
          <span>{weakName ? "Qloo has no place with exactly this name. Check it is yours." : "Another place in Qloo has this exact name. Check it is yours."}</span>
        )}
      </p>
      {alts.length > 0 && (
        <details className="mt-2" open={unsure}>
          <summary className="cursor-pointer select-none text-paper/80 underline underline-offset-2">Not your restaurant?</summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {alts.map((a) => (
              <li key={a.entity_id}>
                <button
                  type="button"
                  onClick={() => onPick?.(a)}
                  className="rounded-full border border-paper/35 px-2.5 py-1 text-left text-paper transition hover:bg-paper/10"
                >
                  {a.name}
                  {a.subtitle && <span className="text-paper/65"> · {a.subtitle}</span>}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ActHeader({ id, n, title, subtitle }: { id: string; n: number; title: string; subtitle: string }) {
  return (
    <header id={id} className="scroll-mt-6 pt-8">
      <InViewGroup amount={0.5} className="flex items-center gap-3">
        <p className="font-display shrink-0 text-sm text-terracotta-ink">Act {n}</p>
        <span aria-hidden className="bar-fill h-px flex-1 bg-line" />
      </InViewGroup>
      <KineticText as="h2" trigger="view" text={title} className="font-display mt-1 text-3xl leading-tight sm:text-4xl" />
      <Reveal delay={0.15}>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">{subtitle}</p>
      </Reveal>
    </header>
  );
}

// Crowd vs city, term by term: the share of the crowd's favourite restaurants whose menus carry
// the term (olive) against the share of the city's most popular ones (grey), drawn to one scale.
function CrowdMenu({ data }: { data: NonNullable<LiveState["crowdMenu"]> }) {
  // Only terms that read as dishes or foods (src/lib/menu-terms.ts), better-supported ones first;
  // counts and lifts are unchanged.
  const rows = displayMenuTerms(supportedFirst(data.favours), 6);
  const anyLow = rows.some(isLowCount);
  const avoids = displayMenuTerms(data.avoids, 4, (t) => t.city);
  const share = (n: number, of: number) => (of > 0 ? n / of : 0);
  const top = Math.max(1e-6, ...rows.flatMap((t) => [share(t.crowd, data.crowd_n), share(t.city, data.city_n)]));
  const width = (v: number) => `${(v / top) * 100}%`;
  return (
    <div className="rounded-xl border border-olive/25 bg-olive/5 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-olive">On your crowd’s menus</p>
      <p className="mb-2 text-[11px] leading-snug text-muted">
        Of Qloo’s ~150 restaurants your guests love most and {data.city}’s ~150 most popular: menus at the {data.crowd_n} and{" "}
        {data.city_n} with menu data
      </p>
      <p aria-hidden className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-olive" /> Your crowd
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full bg-ink-2/35" /> The city
        </span>
      </p>
      <InViewGroup amount={0.2}>
        <ul className="space-y-2.5">
          {rows.map((t, i) => (
            <li key={t.term}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 text-sm leading-snug">{t.term}</span>
                {isLowCount(t) ? (
                  <span className="shrink-0 text-[11px] tabular-nums text-muted" title={LOW_COUNT_HELP}>
                    {liftLabel(t.lift)} · low count
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums text-olive">{liftLabel(t.lift)}</span>
                )}
              </div>
              <div aria-hidden className="mt-1 grid grid-cols-[1fr_3rem] items-center gap-x-2 gap-y-0.5 text-right text-[10px] tabular-nums text-muted">
                <span className="h-1.5 overflow-hidden rounded-full bg-paper-2">
                  <span
                    className="bar-fill block h-full rounded-full bg-olive"
                    style={{ width: width(share(t.crowd, data.crowd_n)), "--i": i } as React.CSSProperties}
                  />
                </span>
                <span>
                  {t.crowd}/{data.crowd_n}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-paper-2">
                  <span
                    className="bar-fill block h-full rounded-full bg-ink-2/35"
                    style={{ width: width(share(t.city, data.city_n)), "--i": i } as React.CSSProperties}
                  />
                </span>
                <span>
                  {t.city}/{data.city_n}
                </span>
              </div>
              <span className="sr-only">
                On {t.crowd} of the {data.crowd_n} restaurants your guests love most vs {t.city} of {data.city_n}
              </span>
            </li>
          ))}
        </ul>
      </InViewGroup>
      {avoids.length > 0 && (
        <p className="mt-2.5 text-[11px] leading-snug text-muted">
          Rarer with your crowd: {avoids.map((t) => t.term).join(" · ")}
        </p>
      )}
      {anyLow && (
        <p className="mt-2 text-[11px] leading-snug text-muted">
          Low count = on fewer than {LOW_COUNT_MENUS} menus in both lists together; listed after the better-supported terms.
        </p>
      )}
      <p className="mt-2 text-[11px]">
        <HowLink label="How is this measured?" title="Crowd lift">
          {LIFT_HELP}
        </HowLink>
      </p>
    </div>
  );
}

function DraftPreview({ draft }: { draft: Record<string, unknown> }) {
  const headline = typeof draft.headline === "string" ? draft.headline : "";
  const moves = Array.isArray(draft.menu_moves) ? (draft.menu_moves as Array<Record<string, unknown>>) : [];
  const gaps = Array.isArray(draft.taste_gaps) ? (draft.taste_gaps as Array<Record<string, unknown>>) : [];
  const exp = (draft.experience ?? {}) as Record<string, unknown>;
  const steps = [
    { label: "Headline", done: headline.length > 0 },
    { label: "Taste gaps", done: gaps.length > 0 },
    { label: "Menu moves", done: moves.length >= 3 },
    { label: "Event", done: typeof exp.event_idea === "string" },
    { label: "Marketing", done: draft.marketing != null },
    { label: "Shopping list", done: Array.isArray(draft.shopping_list) },
    { label: "7-day plan", done: Array.isArray(draft.week_plan) },
  ];
  return (
    <m.section
      aria-live="polite"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className="relative overflow-hidden rounded-2xl border border-dashed border-olive/40 bg-card p-5 sm:p-6"
    >
      <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-olive">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-olive" aria-hidden />
        Drafting live
      </p>
      <AnimatePresence mode="wait" initial={false}>
        {headline ? (
          <m.p
            key="headline"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE_OUT }}
            className="font-display mt-2 text-xl leading-snug sm:text-2xl"
          >
            {headline}
          </m.p>
        ) : (
          <m.p key="waiting" exit={{ opacity: 0 }} className="mt-2 text-sm text-muted">
            The agent is writing your playbook…
          </m.p>
        )}
      </AnimatePresence>
      {moves.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {moves.map((mv, i) =>
            typeof mv.dish === "string" && mv.dish ? (
              <m.li
                key={i}
                initial={{ opacity: 0, scale: 0.92, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE_OUT }}
                className="rounded-full border border-line bg-paper px-3 py-1 text-sm"
              >
                {mv.dish}
              </m.li>
            ) : null,
          )}
        </ul>
      )}
      <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
        {steps.map((st) => (
          <li key={st.label} className={`inline-flex items-center gap-1.5 transition-colors duration-300 ${st.done ? "text-olive" : "text-muted"}`}>
            <span
              aria-hidden
              className={`grid h-3.5 w-3.5 place-items-center rounded-full border text-[9px] leading-none transition-all duration-300 ${
                st.done ? "scale-100 border-olive bg-olive text-paper" : "scale-90 border-line bg-card"
              }`}
            >
              {st.done ? "✓" : ""}
            </span>
            <span className="sr-only">{st.done ? "Done:" : "To do:"}</span>
            {st.label}
          </li>
        ))}
      </ol>
    </m.section>
  );
}

const DAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function nextMonday(from: Date): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const delta = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function icsDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function WeekPlan({ playbook: p }: { playbook: Playbook }) {
  const items = [...p.week_plan].sort((a, b) => (DAY_INDEX[a.day] ?? 9) - (DAY_INDEX[b.day] ?? 9));
  const download = () => {
    const monday = nextMonday(new Date());
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tastecraft//Launch plan//EN"];
    items.forEach((it, i) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + (DAY_INDEX[it.day] ?? 0));
      const end = new Date(day);
      end.setDate(day.getDate() + 1);
      lines.push(
        "BEGIN:VEVENT",
        `UID:tastecraft-${i}-${icsDate(day)}@tastecraft`,
        `DTSTAMP:${icsDate(monday)}T000000Z`,
        `DTSTART;VALUE=DATE:${icsDate(day)}`,
        `DTEND;VALUE=DATE:${icsDate(end)}`,
        `SUMMARY:${icsEscape(`${p.restaurant.name}: ${it.action}`)}`,
        `DESCRIPTION:${icsEscape(`Owner: ${it.owner}. From your Tastecraft playbook.`)}`,
        "END:VEVENT",
      );
    });
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tastecraft-launch-week.ics";
    a.click();
    URL.revokeObjectURL(url);
    toast("Launch week saved as a calendar file");
  };
  return (
    <Section
      icon={<IconSpark size={16} />}
      kicker="Next week"
      title="Your 7-day launch plan"
      aside={
        <button
          type="button"
          onClick={download}
          className="no-print inline-flex min-h-8 items-center gap-1.5 pointer-coarse:min-h-11 pointer-coarse:px-4 rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-ink-2/40 hover:text-ink active:scale-[0.97]"
        >
          <IconDownload size={14} /> Add to calendar
        </button>
      }
    >
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((it, i) => (
          <li key={`${it.day}-${i}`} className="lift rounded-xl border border-line bg-paper/50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-terracotta-ink">{it.day}</p>
            <p className="mt-1 text-sm leading-snug">{it.action}</p>
            <p className="mt-1 text-[12px] text-muted">{it.owner}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

const AGE_LABEL: Record<string, string> = {
  "24_and_younger": "≤24",
  "25_to_29": "25–29",
  "30_to_34": "30–34",
  "35_to_44": "35–44",
  "45_to_54": "45–54",
  "55_and_older": "55+",
};

function Demographics({ data }: { data: { age: Record<string, number>; gender: Record<string, number> } }) {
  const ages = Object.keys(AGE_LABEL).filter((k) => k in data.age);
  const max = Math.max(0.01, ...Object.values(data.age).map(Math.abs), ...Object.values(data.gender).map(Math.abs));
  const Row = ({ label, v, i }: { label: string; v: number; i: number }) => (
    <li className="grid grid-cols-[52px_1fr] items-center gap-2 text-[12px]">
      <span className="text-ink-2">{label}</span>
      <span className="relative h-3">
        <span className="absolute left-1/2 top-0 h-full w-px bg-line" />
        <span
          className={`bar-fill absolute top-0.5 h-2 rounded-full ${v >= 0 ? "bg-olive" : "from-right bg-terracotta/70"}`}
          style={
            {
              ...(v >= 0 ? { left: "50%", width: `${(v / max) * 50}%` } : { right: "50%", width: `${(-v / max) * 50}%` }),
              "--i": i,
            } as unknown as React.CSSProperties
          }
          title={`${v > 0 ? "+" : ""}${v.toFixed(2)}`}
        />
      </span>
    </li>
  );
  return (
    <InViewGroup className="rounded-xl border border-line bg-paper/50 p-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Who over-indexes</p>
      <p className="mb-3 text-[11px] text-muted">Right = more than average, left = less (Qloo demographics)</p>
      <ul className="space-y-1.5">
        {ages.map((k, i) => (
          <Row key={k} label={AGE_LABEL[k]} v={data.age[k]} i={i} />
        ))}
        {Object.entries(data.gender).map(([g, v], i) => (
          <Row key={g} label={g === "female" ? "Women" : g === "male" ? "Men" : g} v={v} i={ages.length + i} />
        ))}
      </ul>
    </InViewGroup>
  );
}

function ShoppingList({ playbook: p }: { playbook: Playbook }) {
  const total = p.shopping_list.reduce((s, i) => s + (i.est_cost || 0), 0);
  const csv = [
    `item,qty,unit,supplier_category,est_cost_${p.currency.toLowerCase()}`,
    ...p.shopping_list.map((i) =>
      [i.item, i.qty, i.unit, i.supplier_category, i.est_cost]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(","),
    ),
  ].join("\n");
  const bySupplier = p.shopping_list.reduce<Record<string, typeof p.shopping_list>>((acc, i) => {
    (acc[i.supplier_category] ??= []).push(i);
    return acc;
  }, {});
  const orderEmail = Object.entries(bySupplier)
    .map(
      ([cat, items]) =>
        `— ${cat} —\n` + items.map((i) => `· ${i.item}: ${i.qty} ${i.unit}`).join("\n"),
    )
    .join("\n\n");
  const emailText = `Hello,\n\nFor ${p.restaurant.name}, we would like to order for next week's test menu:\n\n${orderEmail}\n\nPlease confirm availability and price.\n\nThank you!`;

  return (
    <Section
      icon={<IconBasket size={16} />}
      kicker="Supplier shopping list"
      title="What to buy for a one-week test"
      aside={
        <div className="flex flex-wrap justify-end gap-2">
          <CopyButton text={emailText} label="Copy order email" done="Order email copied" />
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
            download={`tastecraft-shopping-list.csv`}
            onClick={() => toast("Shopping list downloaded (CSV)")}
            className="inline-flex min-h-8 items-center gap-1.5 pointer-coarse:min-h-11 pointer-coarse:px-4 rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-ink-2/40 hover:text-ink active:scale-[0.97]"
          >
            <IconDownload size={14} /> CSV
          </a>
        </div>
      }
    >
      {/* Phones: one card per item, since four columns do not fit a 390 px screen. */}
      <ul className="space-y-2 sm:hidden">
        {p.shopping_list.map((i) => (
          <li key={`${i.item}-${i.supplier_category}`} className="rounded-xl border border-line bg-paper/50 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 text-sm font-medium leading-snug">{i.item}</p>
              <p className="shrink-0 text-sm tabular-nums">{money(i.est_cost, p.currency)}</p>
            </div>
            <p className="mt-0.5 text-[12px] leading-snug text-ink-2">
              {i.qty} {i.unit} · {i.supplier_category}
            </p>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 px-3 pt-1">
          <span className="text-xs uppercase tracking-[0.12em] text-muted">Estimated total</span>
          <span className="font-semibold tabular-nums">{money(total, p.currency)}</span>
        </li>
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.12em] text-muted">
              <th className="py-2 pr-3 font-semibold">Item</th>
              <th className="py-2 pr-3 text-right font-semibold">Qty</th>
              <th className="py-2 pr-3 font-semibold">Supplier</th>
              <th className="py-2 text-right font-semibold">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {p.shopping_list.map((i) => (
              <tr key={`${i.item}-${i.supplier_category}`} className="border-b border-line/60">
                <td className="py-2 pr-3">{i.item}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {i.qty} {i.unit}
                </td>
                <td className="py-2 pr-3 text-ink-2">{i.supplier_category}</td>
                <td className="py-2 text-right tabular-nums">
                  {money(i.est_cost, p.currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3 text-right text-xs uppercase tracking-[0.12em] text-muted">
                Estimated total
              </td>
              <td className="pt-3 text-right font-semibold tabular-nums">
                {money(total, p.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  );
}

function Compare({ baseline, playbook: p }: { baseline: string; playbook: Playbook }) {
  const cl = p.crowd_lift;
  const generic = cl?.baseline;
  const event = /^\s*(?:event|evento)\s*[:.-]\s*(.+)$/im.exec(baseline)?.[1];
  const lowTag = <span className="whitespace-nowrap font-normal text-muted"> · low count</span>;
  return (
    <Section icon={<IconSpark size={16} />} kicker="Why taste data matters" title="The same model, with and without Qloo">
      {cl?.score != null && generic?.score != null && (
        <p className="mb-3 text-[13px] leading-snug text-ink-2">
          Same crowd-lift formula on both sets of dishes, in this run: <span className="font-semibold text-terracotta-ink">{liftLabel(generic.score)}</span>{" "}
          without Qloo vs <span className="font-semibold text-olive">{liftLabel(cl.score)}</span> with Qloo (×1.0 = no different from{" "}
          {cl.city}’s most popular restaurants).{" "}
          <HowLink label="How is crowd lift measured?" title="Crowd lift">
            {LIFT_HELP}
          </HowLink>
        </p>
      )}
      <p className="mb-3 text-[12px] leading-snug text-muted">
        This run is not a like-for-like test. The left column is one quick call to the same model (no tools, no Qloo data, low
        effort, at most 90 words); the agent works with Qloo at medium effort and sees the crowd-vs-city contrast this score is built
        on. The fair test is the benchmark: same model and effort in every arm, scored on restaurants the model never saw. There,
        Qloo’s contrast scored ×{HELD_OUT.withQloo.toFixed(2)} against ×{HELD_OUT.alone.toFixed(2)} for the model alone:{" "}
        {gainPct(HELD_OUT.ratio)} per restaurant (95% CI {gainPct(HELD_OUT.ciLow)} to {gainPct(HELD_OUT.ciHigh)}), better in{" "}
        {HELD_OUT.better} of {HELD_OUT.restaurants}.{" "}
        <a href={HELD_OUT.url} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
          Benchmark
        </a>
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="lift rounded-xl border border-line bg-paper/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Same model without Qloo · one quick call</p>
          {generic?.score != null && (
            <p className="mt-1 text-[11px] font-semibold text-muted">
              Crowd lift {liftLabel(generic.score)} · {generic.matched} of {generic.total} dishes matched on local menus
            </p>
          )}
          {generic && generic.dishes.length > 0 ? (
            <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink-2">
              {generic.dishes.map((d) => (
                <li key={d.dish} title={cl ? d.terms.map((t) => termLine(t, cl)).join("\n") : undefined}>
                  <span className="font-semibold">{d.dish}</span> {d.lift != null ? `— ${liftLabel(d.lift)}` : "— no match on local menus"}
                  {d.lift != null && dishLowCount(d.terms) && lowTag}
                </li>
              ))}
              {event && (
                <li>
                  <span className="font-semibold">Event:</span> {event}
                </li>
              )}
            </ul>
          ) : (
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">{baseline}</p>
          )}
        </div>
        <div className="lift rounded-xl border border-olive/30 bg-olive/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-olive">Tastecraft, grounded in Qloo</p>
          {cl?.score != null && (
            <p className="mt-1 text-[11px] font-semibold text-olive">
              Crowd lift {liftLabel(cl.score)} · {cl.matched} of {cl.total} dishes matched on local menus
            </p>
          )}
          <ul className="mt-2 space-y-2 text-sm leading-relaxed">
            {p.menu_moves.map((mv) => (
              <li key={mv.dish}>
                <span className="font-semibold">{mv.dish}</span>
                {mv.lift != null ? ` (${liftLabel(mv.lift)}` : ""}
                {mv.lift != null && dishLowCount(mv.lift_terms) && <span className="text-muted">, low count</span>}
                {mv.lift != null ? ")" : ""} — {mv.evidence[0]?.text ?? mv.why}
              </li>
            ))}
            {p.taste_gaps[0] && (
              <li>
                <span className="font-semibold">Gap:</span> {p.taste_gaps[0].tag} — {p.taste_gaps[0].evidence}
              </li>
            )}
          </ul>
        </div>
      </div>
    </Section>
  );
}

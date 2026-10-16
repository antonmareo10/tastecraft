"use client";

import dynamic from "next/dynamic";
import type { EntityRef, HeatCell, Playbook, Zone } from "@/lib/types";
import {
  IconBasket,
  IconDownload,
  IconGap,
  IconMap,
  IconMegaphone,
  IconMusic,
  IconPlate,
  IconSpark,
  IconUsers,
} from "./icons";
import { AffinityBar, CopyButton, Pill, Section } from "./ui";

const TasteMap = dynamic(() => import("./TasteMap"), {
  ssr: false,
  loading: () => <div className="h-[380px] animate-pulse rounded-xl bg-paper-2" />,
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

function money(v: number, currency: string): string {
  try {
    return v.toLocaleString("en-GB", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 2 });
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

export type LiveState = {
  restaurant?: EntityRef & { lat?: number; lon?: number };
  dna: Record<string, EntityRef[]>;
  heatmap?: { cells: HeatCell[]; zones: Zone[]; center: [number, number] };
  baseline?: string;
  playbook?: Playbook;
  demographics?: { age: Record<string, number>; gender: Record<string, number> };
  compare?: { a: string; b: string; tags: { name: string; score?: number }[] };
  tags: Partial<Record<"dishes" | "cuisines" | "ambience", { name: string; affinity?: number }[]>>;
};

export default function PlaybookView({ live, running }: { live: LiveState; running: boolean }) {
  const p = live.playbook;
  const domains = Object.keys(live.dna).filter((d) => live.dna[d]?.length);

  return (
    <div className="space-y-5">
      {/* Restaurant + headline */}
      {(live.restaurant || p) && (
        <section className="rise overflow-hidden rounded-2xl border border-line bg-olive text-paper">
          <div className="grain px-6 py-6 sm:px-8 sm:py-8">
            <div className="flex items-start justify-between gap-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-paper/70">Taste playbook</p>
              {p && !running && (
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="no-print inline-flex items-center gap-1.5 rounded-full border border-paper/30 px-3 py-1 text-xs text-paper/90 transition hover:bg-paper/10"
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
            {live.restaurant?.tags && live.restaurant.tags.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {live.restaurant.tags.slice(0, 6).map((t) => (
                  <li key={t} className="rounded-full border border-paper/25 px-2.5 py-0.5 text-xs text-paper/85">
                    {t}
                  </li>
                ))}
              </ul>
            )}
            {p?.headline ? (
              <p className="font-display mt-5 max-w-3xl text-xl leading-snug text-paper sm:text-2xl">“{p.headline}”</p>
            ) : running ? (
              <p className="mt-5 text-sm text-paper/70">Building the playbook from live taste data…</p>
            ) : null}
          </div>
        </section>
      )}

      {/* Audience DNA from live Qloo results */}
      {domains.length > 0 && (
        <Section icon={<IconUsers size={16} />} kicker="Audience taste DNA" title="What your guests also love">
          {p?.audience_dna.summary && <p className="mb-4 max-w-3xl text-[15px] leading-relaxed text-ink-2">{p.audience_dna.summary}</p>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {domains.map((d) => (
              <div key={d} className="rounded-xl border border-line bg-paper/50 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                  {DOMAIN_LABEL[d] ?? d}
                </p>
                <ul className="space-y-1.5">
                  {live.dna[d].slice(0, 6).map((e) => (
                    <li key={e.entity_id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm" title={e.subtitle}>
                        {e.name}
                      </span>
                      <AffinityBar value={e.affinity} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted">Affinity scores come straight from Qloo’s taste graph (0–100).</p>
        </Section>
      )}

      {(live.demographics || Object.keys(live.tags).length > 0) && (
        <Section icon={<IconPlate size={16} />} kicker="Cravings & crowd" title="What they crave, and who they are">
          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {(["dishes", "cuisines", "ambience"] as const).map((fam) =>
                live.tags[fam]?.length ? (
                  <div key={fam} className="rounded-xl border border-line bg-paper/50 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                      {{ dishes: "Dishes", cuisines: "Cuisines", ambience: "Vibe" }[fam]}
                    </p>
                    <ul className="space-y-1.5">
                      {live.tags[fam]!.slice(0, 6).map((t) => (
                        <li key={t.name} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 text-sm leading-snug">{t.name}</span>
                          <AffinityBar value={t.affinity} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
            {live.demographics && <Demographics data={live.demographics} />}
          </div>
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

      {live.compare && live.compare.tags.length > 0 && (
        <Section icon={<IconGap size={16} />} kicker="Head-to-head" title={`What sets your crowd apart from ${live.compare.b}`}>
          <p className="mb-3 text-[13px] text-ink-2">
            Qloo’s comparison of the two audiences: the taste signals that most distinguish {live.compare.a}’s guests from {live.compare.b}’s.
          </p>
          <ul className="flex flex-wrap gap-2">
            {live.compare.tags.map((t) => (
              <li key={t.name} className="inline-flex items-center gap-2 rounded-full border border-line bg-paper/60 px-3 py-1 text-sm">
                {t.name}
                {typeof t.score === "number" && <span className="text-[11px] tabular-nums text-muted">{Math.round(t.score * 100)}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p && (
        <>
          {p.taste_gaps.length > 0 && (
            <Section icon={<IconGap size={16} />} kicker="Taste gaps" title="What locals love that you don’t serve yet">
              <ul className="grid gap-3 md:grid-cols-2">
                {p.taste_gaps.map((g) => (
                  <li key={g.tag} className="rounded-xl border border-line bg-paper/50 p-4">
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
              {p.menu_moves.map((m) => (
                <article key={m.dish} className="flex flex-col rounded-xl border border-line bg-paper/40 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h4 className="font-display text-lg leading-tight">{m.dish}</h4>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-olive">
                      {money(m.price, p.currency)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-snug text-ink-2">{m.description}</p>
                  <p className="mt-3 text-[13px] leading-snug">
                    <span className="font-semibold">Why: </span>
                    {m.why}
                  </p>
                  {m.evidence.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-line pt-3">
                      {m.evidence.map((ev) => (
                        <li key={ev} className="flex gap-2 text-[12px] leading-snug text-muted">
                          <IconSpark size={12} className="mt-0.5 shrink-0 text-saffron" />
                          {ev}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section icon={<IconMusic size={16} />} kicker="Experience" title={p.experience.event_idea}>
              <p className="text-sm leading-relaxed text-ink-2">{p.experience.event_why}</p>
              <p className="mt-3 text-sm leading-relaxed">
                <span className="font-semibold">Ambience: </span>
                {p.experience.ambience}
              </p>
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
              aside={<CopyButton text={p.marketing.instagram_post} label="Copy post" />}
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

          <ShoppingList playbook={p} />

          {p.week_plan?.length > 0 && <WeekPlan playbook={p} />}

          {live.baseline && <Compare baseline={live.baseline} playbook={p} />}

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
          className="no-print inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-ink-2/40 hover:text-ink"
        >
          <IconDownload size={14} /> Add to calendar
        </button>
      }
    >
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((it, i) => (
          <li key={`${it.day}-${i}`} className="rounded-xl border border-line bg-paper/50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-terracotta">{it.day}</p>
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
  const Row = ({ label, v }: { label: string; v: number }) => (
    <li className="grid grid-cols-[52px_1fr] items-center gap-2 text-[12px]">
      <span className="text-ink-2">{label}</span>
      <span className="relative h-3">
        <span className="absolute left-1/2 top-0 h-full w-px bg-line" />
        <span
          className={`absolute top-0.5 h-2 rounded-full ${v >= 0 ? "bg-olive" : "bg-terracotta/70"}`}
          style={v >= 0 ? { left: "50%", width: `${(v / max) * 50}%` } : { right: "50%", width: `${(-v / max) * 50}%` }}
          title={`${v > 0 ? "+" : ""}${v.toFixed(2)}`}
        />
      </span>
    </li>
  );
  return (
    <div className="rounded-xl border border-line bg-paper/50 p-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Who over-indexes</p>
      <p className="mb-3 text-[11px] text-muted">Right = more than average, left = less (Qloo demographics)</p>
      <ul className="space-y-1.5">
        {ages.map((k) => (
          <Row key={k} label={AGE_LABEL[k]} v={data.age[k]} />
        ))}
        {Object.entries(data.gender).map(([g, v]) => (
          <Row key={g} label={g === "female" ? "Women" : g === "male" ? "Men" : g} v={v} />
        ))}
      </ul>
    </div>
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
          <CopyButton text={emailText} label="Copy order email" />
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
            download={`tastecraft-shopping-list.csv`}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-ink-2/40 hover:text-ink"
          >
            <IconDownload size={14} /> CSV
          </a>
        </div>
      }
    >
      <div className="overflow-x-auto">
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
  return (
    <Section icon={<IconSpark size={16} />} kicker="Why taste data matters" title="Generic AI vs. Tastecraft">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-paper/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Same model, no Qloo</p>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">{baseline}</p>
        </div>
        <div className="rounded-xl border border-olive/30 bg-olive/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-olive">Tastecraft, grounded in Qloo</p>
          <ul className="mt-2 space-y-2 text-sm leading-relaxed">
            {p.menu_moves.map((m) => (
              <li key={m.dish}>
                <span className="font-semibold">{m.dish}</span> — {m.evidence[0] ?? m.why}
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

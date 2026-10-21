import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { KineticText, NumberReveal, Reveal } from "@/components/fx";
import { gainPct, HELD_OUT } from "@/lib/benchmark";

export const metadata: Metadata = {
  title: "About · Tastecraft",
  description: "Why independent restaurants need cultural intelligence, how Tastecraft works, how it stays honest, and how it becomes a business.",
};

const SOURCES = {
  technomic:
    "https://restaurantbusinessonline.com/operations/number-independent-restaurants-declined-23-2025",
  nrn: "https://www.nrn.com/independent-restaurants/the-independent-restaurant-sector-shrunk-by-2-3-in-2025",
  nra: "https://go.restaurant.org/rs/078-ZLA-461/images/SOI-2025-PocketGuide.pdf?version=0",
};

export default function About() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-6 sm:px-6">
      <Link
        href="/"
        className="group inline-flex min-h-9 items-center gap-1.5 text-sm text-ink-2 underline decoration-line underline-offset-4 hover:text-ink"
      >
        <span aria-hidden className="transition-transform duration-300 group-hover:-translate-x-1">
          ←
        </span>
        Back to Tastecraft
      </Link>

      <header className="mt-8">
        <p className="fade-up text-[11px] font-semibold uppercase tracking-[0.18em] text-terracotta-ink">About</p>
        <KineticText
          as="h1"
          text="The cultural intelligence chains buy, for the restaurants that can’t."
          className="font-display mt-3 text-4xl leading-[1.05] tracking-tight sm:text-5xl"
        />
      </header>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        <Stat
          value={<NumberReveal value={412498} grouping />}
          label="independent restaurants left in the US at the end of 2025"
          href={SOURCES.technomic}
          index={0}
        />
        <Stat
          value={<NumberReveal value={2.3} decimals={1} prefix="−" suffix="%" delay={80} />}
          label="independents in 2025, a net loss of more than 9,500 locations, while chains grew 1.4%"
          href={SOURCES.nrn}
          index={1}
        />
        <Stat
          value={<NumberReveal value={7} suffix=" in 10" delay={160} />}
          label="US restaurants are single-unit operations, with no insight team"
          href={SOURCES.nra}
          index={2}
        />
      </section>

      <Block title="The problem">
        <p>
          Chains decide menus, promotions and openings with data teams. An independent owner decides on instinct, between
          service and supplier calls. The cost of guessing wrong is a dish nobody orders, a quiet Tuesday, or a flyer handed
          out in the wrong neighborhood. Generic AI doesn’t fix this: it gives every tapas bar the same advice.
        </p>
      </Block>

      <Block title="What Tastecraft does">
        <p>
          It starts from the people who already love a restaurant — as seen in Qloo’s cross-domain taste graph — and reads
          what else they love: nearby places, music, brands, films, dishes, vibes, even where in the city they live. Then a
          Claude agent turns that into three dishes to test, an event, a ready-to-post campaign aimed at the right
          neighborhoods, a supplier shopping list and a 7-day launch plan.
        </p>
        <p>
          Every playbook carries a <strong>crowd lift</strong>. Qloo gives two lists for the city: the ~150 restaurants this
          crowd loves most and the city’s ~150 most popular. Tastecraft measures how much more often the crowd’s favourite places
          serve the proposed dishes, and shows the same score for a quick answer from the same model without Qloo, side by side.
          The ruler comes from Qloo too: crowd lift is computed from Qloo’s own menu tags, so it tests whether the dishes follow
          this crowd’s Qloo signal, not whether guests will order them.
        </p>
        <p>
          Does Qloo make the dishes better? On restaurants the model never saw (8 restaurants in 8 cities, same model and effort
          in every arm), Qloo’s crowd-vs-city signal gave {gainPct(HELD_OUT.ratio)} over the same model alone (95% CI{" "}
          {gainPct(HELD_OUT.ciLow)} to {gainPct(HELD_OUT.ciHigh)}), better in {HELD_OUT.better} of {HELD_OUT.restaurants}. A
          playbook’s own score is higher because the agent sees the contrast it is scored on; that is why the number above is
          the one to quote.{" "}
          <a href={HELD_OUT.url} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
            Method and limits
          </a>
          .
        </p>
      </Block>

      <Block title="Responsible by design">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>No personal data.</strong> Tastecraft only uses Qloo’s aggregated, privacy-first taste signals. It never
            sees or stores information about individual guests.
          </li>
          <li>
            <strong>Groups, not people.</strong> Qloo scores describe what people who like a restaurant tend to like, in
            aggregate. Tastecraft never presents them as a prediction about one guest, and keeps Qloo’s facts apart from its
            own interpretation.
          </li>
          <li>
            <strong>The right restaurant first.</strong> Every match is labelled exact, close or best guess, and the owner
            can switch to another candidate before relying on the results.
          </li>
          <li>
            <strong>Cited names and scores are checked.</strong> The server records every name and number Qloo returns in a
            run. Each piece of evidence in the playbook cites the Qloo names and scores it relies on, and the server checks every
            cited name against that record and every cited score to within 1 point. What fails is flagged, not hidden. Other
            numbers in the text, such as menu shares, are quoted by the agent and not checked.
          </li>
          <li>
            <strong>The owner decides.</strong> Tastecraft proposes; nothing is ordered, posted or booked without the owner.
          </li>
          <li>
            <strong>Honest gaps.</strong> Missing or thin data is listed in the playbook’s caveats. Playlists are inspiration:
            playing music in public still requires the usual performance licences.
          </li>
          <li>
            <strong>Qloo data stays private.</strong> Responses are cached server-side only and never published in the code
            repository.
          </li>
        </ul>
      </Block>

      <Block title="Why it’s a business">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Who pays:</strong> independent restaurants and small groups (2–10 locations), per location per month, with
            the first playbook free. Price hypothesis, not yet tested: US$49 per location per month.
          </li>
          <li>
            <strong>What a playbook costs to make:</strong> about US$0.32–0.37 of Claude (two logged runs at Claude Opus 5.5 list
            prices, mostly cached input) and roughly 17 to 34 Qloo API requests (counted from the code paths of the three
            recorded runs; the concert ranking adds one lookup per artist). A weekly playbook is about US$1.50 of Claude per
            location per month, before Qloo’s price, which is not public.
          </li>
          <li>
            <strong>How it reaches owners:</strong> the app marketplaces of POS systems (Toast, Square and Clover each run one),
            reservation platforms’ partner programs, and food distributors, because the shopping list is already an order.
          </li>
          <li>
            <strong>How big:</strong> 412,498 independent restaurants in the US, and more than 7 in 10 US restaurants are
            single-unit (sources above). At the hypothetical price, 1% of US independents would be about US$2.4M a year.
          </li>
          <li>
            <strong>Why it is good for Qloo:</strong> every playbook is recurring Qloo API usage, so every restaurant that
            subscribes is a Qloo API customer by proxy.
          </li>
          <li>
            <strong>Next:</strong> connect sales data to close the loop (did the new dish sell?), multi-location playbooks for
            small groups, and concert or game-day playbooks around live events.
          </li>
        </ul>
      </Block>

      <Block title="Who built it">
        <p>
          Antonio González Fernández, Business Administration and Data Science student at CUNEF (Madrid). Before this he
          built Supplora, an AI tool that reads supplier delivery notes for a family-run restaurant and loads them into its
          management system: 715 notes processed and €1,876 of supplier price increases flagged by September 2026. Watching
          that restaurant decide its specials on gut feel is where Tastecraft started.
        </p>
      </Block>
    </div>
  );
}

function Stat({ value, label, href, index }: { value: ReactNode; label: string; href: string; index: number }) {
  return (
    <Reveal delay={index * 0.08} className="h-full">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="lift block h-full rounded-2xl border border-line bg-card p-5 hover:border-ink-2/30"
      >
        <p className="font-display text-4xl text-olive">{value}</p>
        <p className="mt-2 text-sm leading-snug text-ink-2">{label}</p>
        <p className="mt-3 text-[11px] text-muted underline underline-offset-2">Source</p>
      </a>
    </Reveal>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <KineticText as="h2" trigger="view" text={title} className="font-display text-2xl sm:text-3xl" />
      <Reveal delay={0.1}>
        <div className="mt-3 space-y-3 text-[16px] leading-relaxed text-ink-2">{children}</div>
      </Reveal>
    </section>
  );
}

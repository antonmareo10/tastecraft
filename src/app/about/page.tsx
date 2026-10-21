import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { CountUp, KineticText, Reveal } from "@/components/fx";

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
        <p className="fade-up text-[11px] font-semibold uppercase tracking-[0.18em] text-terracotta">About</p>
        <KineticText
          as="h1"
          text="The cultural intelligence chains buy, for the restaurants that can’t."
          className="font-display mt-3 text-4xl leading-[1.05] tracking-tight sm:text-5xl"
        />
      </header>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        <Stat
          value={<CountUp value={412498} grouping duration={1400} />}
          label="independent restaurants left in the US at the end of 2025"
          href={SOURCES.technomic}
          index={0}
        />
        <Stat
          value={<CountUp value={2.3} decimals={1} prefix="−" suffix="%" duration={1200} />}
          label="independents lost in 2025 — about 9,500 closures — while chains grew 1.4%"
          href={SOURCES.nrn}
          index={1}
        />
        <Stat
          value={<CountUp value={7} suffix=" in 10" duration={1000} />}
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
            <strong>Who pays:</strong> independent restaurants and small groups (2–10 locations). A monthly subscription per
            location, with a free first playbook.
          </li>
          <li>
            <strong>Why now:</strong> agents can finally do the analyst’s job end to end, and Qloo makes the taste data
            available through an API.
          </li>
          <li>
            <strong>Distribution:</strong> restaurant software marketplaces (POS and reservations), food distributors who
            benefit from the shopping list turning into orders, and Supplora — the founder’s AI purchasing tool, used by a
            family-run restaurant in Spain.
          </li>
          <li>
            <strong>Expansion:</strong> connect sales data to close the loop (did the new dish sell?), multi-location
            playbooks for small groups, and concert or game-day playbooks around live events.
          </li>
        </ul>
      </Block>

      <Block title="Who built it">
        <p>
          Antonio González Fernández, Business Administration and Data Science student at CUNEF (Madrid). He built Supplora,
          an AI tool that reads supplier delivery notes for a family-run restaurant and loads them into its management
          system — 715 notes processed and €1,876 of supplier price increases flagged so far. Watching that restaurant
          decide its specials on gut feel is where Tastecraft started.
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

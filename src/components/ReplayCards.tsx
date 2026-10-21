"use client";

import { IconArrow } from "./icons";

export type DemoSummary = { slug: string; restaurant: string; city: string; goal?: string; recordedAt: string };

// UTC so the server and every visitor's browser print the same day (no hydration mismatch).
const recordedOn = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The instant replays of recorded real runs, as cards: "grid" inside the desktop form, "list"
 * (full-width rows, easy to tap) in the phone hero. Each card says it is a recorded run.
 */
export default function ReplayCards({
  demos,
  onPlay,
  disabled,
  variant,
}: {
  demos: DemoSummary[];
  onPlay: (d: DemoSummary) => void;
  disabled?: boolean;
  variant: "grid" | "list";
}) {
  if (variant === "list") {
    return (
      <ul className="mt-2.5 space-y-2">
        {demos.map((d) => (
          <li key={d.slug}>
            <button
              type="button"
              onClick={() => onPlay(d)}
              disabled={disabled}
              className="lift group flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-line bg-card/90 px-3.5 py-2.5 text-left active:scale-[0.99] disabled:opacity-60"
            >
              <span className="rec-dot shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-display block truncate text-[16px] leading-tight text-ink">{d.restaurant}</span>
                <span className="block truncate text-[12px] text-ink-2">
                  {d.city} · recorded run, {recordedOn(d.recordedAt)}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-olive px-3 py-1.5 text-[12px] font-medium text-paper">
                Replay <IconArrow size={12} className="transition-transform duration-300 group-hover:translate-x-0.5" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid grid-cols-3 gap-2">
      {demos.map((d) => (
        <li key={d.slug} className="min-w-0">
          <button
            type="button"
            onClick={() => onPlay(d)}
            disabled={disabled}
            className="lift group flex h-full w-full min-w-0 flex-col rounded-xl border border-line bg-paper/60 p-3 text-left hover:border-olive/35 hover:bg-card active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
          >
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.12em] text-terracotta-ink">
              <span className="rec-dot" aria-hidden />
              Recorded run
            </span>
            <span className="font-display mt-1.5 line-clamp-2 text-[16px] leading-[1.15] text-ink">{d.restaurant}</span>
            <span className="mt-0.5 truncate text-[12px] text-ink-2">{d.city}</span>
            <span className="mt-auto flex items-center justify-between gap-2 pt-2.5 text-[12px]">
              <span className="inline-flex items-center gap-1 font-medium text-olive">
                Replay
                <IconArrow size={12} className="transition-transform duration-300 group-hover:translate-x-1" />
              </span>
              <span className="truncate text-[11px] text-muted">{recordedOn(d.recordedAt)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

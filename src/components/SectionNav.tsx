"use client";

import { useEffect, useRef, useState } from "react";
import { m, useSpring } from "motion/react";
import { scrollToElement } from "@/lib/scroll";

const PILL_SPRING = { stiffness: 420, damping: 38, mass: 0.8 };

/**
 * The playbook's sticky act navigation. The act you are reading is marked by a pill that slides
 * between the links as you scroll; clicking a link glides to that act. One compact row that
 * scrolls sideways on narrow phones.
 */
export default function SectionNav({ items }: { items: readonly (readonly [id: string, label: string])[] }) {
  const [active, setActive] = useState(items[0]?.[0]);
  const navRef = useRef<HTMLElement | null>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const x = useSpring(0, PILL_SPRING);
  const width = useSpring(0, PILL_SPRING);
  const placed = useRef(false);

  // Which act is on screen: the last act header above the upper third of the viewport.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = window.innerHeight * 0.32;
      let current = items[0]?.[0];
      for (const [id] of items) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  // Slide the pill under the active link (the first placement jumps, later ones glide), and keep
  // the active link visible when the row scrolls sideways.
  useEffect(() => {
    const link = active ? links.current.get(active) : undefined;
    const nav = navRef.current;
    if (!link || !nav) return;
    const place = () => {
      if (placed.current) {
        x.set(link.offsetLeft);
        width.set(link.offsetWidth);
      } else {
        x.jump(link.offsetLeft);
        width.jump(link.offsetWidth);
        placed.current = true;
      }
    };
    place();
    if (link.offsetLeft < nav.scrollLeft || link.offsetLeft + link.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollTo({ left: link.offsetLeft - 8, behavior: "smooth" });
    }
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [active, x, width]);

  return (
    <nav
      ref={navRef}
      aria-label="Playbook sections"
      className="no-print sticky top-2 z-[1100] flex w-fit max-w-full flex-nowrap gap-1 overflow-x-auto whitespace-nowrap rounded-full border border-line bg-card/95 p-1 shadow-[0_8px_22px_-14px_rgba(29,27,23,0.5)] backdrop-blur [scrollbar-width:none]"
    >
      <div className="relative flex flex-nowrap gap-1">
        <m.span aria-hidden className="absolute inset-y-0 left-0 rounded-full bg-olive" style={{ x, width }} />
        {items.map(([id, label]) => (
          <a
            key={id}
            ref={(el) => {
              if (el) links.current.set(id, el);
              else links.current.delete(id);
            }}
            href={`#${id}`}
            aria-current={active === id ? "location" : undefined}
            onClick={(e) => {
              const target = document.getElementById(id);
              if (!target) return;
              e.preventDefault();
              setActive(id);
              scrollToElement(target, 64);
              history.replaceState(null, "", `#${id}`);
            }}
            className={`relative flex shrink-0 items-center rounded-full px-3 py-1.5 text-[12.5px] transition-colors duration-300 pointer-coarse:min-h-10 sm:text-[13px] ${
              active === id ? "text-paper" : "text-ink-2 hover:text-ink"
            }`}
          >
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}

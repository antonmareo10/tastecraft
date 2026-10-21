"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m } from "motion/react";
import { SPRING } from "@/lib/motion";

const noop = () => () => {};

type Place = { top: number; left: number; width: number; originX: number; above: boolean; maxHeight: number };

/**
 * A tap-or-click explanation (method notes, evidence checks, per-dish lift terms). It replaces
 * hover-only title tooltips, so it works on touch screens and from the keyboard: it opens with a
 * spring next to its trigger, takes focus so screen readers read it, and closes on Escape, Tab,
 * a click elsewhere or a resize. Rendered in a portal so cards with overflow hidden do not clip it.
 */
export function InfoPopover({
  trigger,
  label,
  title,
  children,
  className,
  width = 320,
}: {
  trigger: ReactNode;
  /** Accessible name of the trigger button. */
  label: string;
  title?: string;
  children: ReactNode;
  className?: string;
  width?: number;
}) {
  const [place, setPlace] = useState<Place | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  // False while hydrating, true afterwards: the portal only exists in the browser.
  const client = useSyncExternalStore(noop, () => true, () => false);

  const close = (refocus: boolean) => {
    setPlace(null);
    if (refocus) buttonRef.current?.focus();
  };

  const toggle = () => {
    if (place) return close(false);
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = Math.min(width, vw - 32);
    const left = Math.max(16, Math.min(vw - w - 16, r.left + r.width / 2 - w / 2));
    // Open on the side with more room when the trigger sits low; long notes scroll inside.
    const below = window.innerHeight - r.bottom - 20;
    const aboveRoom = r.top - 20;
    const above = below < 320 && aboveRoom > below;
    setPlace({
      top: (above ? r.top - 10 : r.bottom + 10) + window.scrollY,
      left: left + window.scrollX,
      width: w,
      originX: Math.max(12, Math.min(w - 12, r.left + r.width / 2 - left)),
      above,
      maxHeight: Math.max(160, above ? aboveRoom : below),
    });
  };

  useEffect(() => {
    if (!place) return;
    panelRef.current?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setPlace(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlace(null);
        buttonRef.current?.focus();
      }
    };
    const onResize = () => setPlace(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [place]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={place != null}
        aria-controls={place ? id : undefined}
        onClick={toggle}
        className={className}
      >
        {trigger}
      </button>
      {client &&
        createPortal(
          <AnimatePresence>
            {place && (
              <div
                className="no-print absolute z-[1200]"
                style={{
                  top: place.top,
                  left: place.left,
                  width: place.width,
                  transform: place.above ? "translateY(-100%)" : undefined,
                }}
              >
                <m.div
                  ref={panelRef}
                  id={id}
                  role="dialog"
                  aria-label={title ?? label}
                  tabIndex={-1}
                  onKeyDown={(e) => {
                    if (e.key === "Tab") {
                      e.preventDefault();
                      close(true);
                    }
                  }}
                  initial={{ opacity: 0, scale: 0.94, y: place.above ? 6 : -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0, transition: SPRING }}
                  exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
                  data-lenis-prevent
                  style={{ transformOrigin: `${place.originX}px ${place.above ? "bottom" : "top"}`, maxHeight: place.maxHeight }}
                  className="overflow-y-auto rounded-xl border border-line bg-card p-3.5 text-left text-[12.5px] leading-relaxed text-ink-2 shadow-[0_24px_48px_-22px_rgba(29,27,23,0.45)] outline-none"
                >
                  {title && <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</p>}
                  {children}
                </m.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

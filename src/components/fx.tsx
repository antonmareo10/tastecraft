"use client";

// Small motion building blocks shared by the app. Everything here follows the brief's rules:
// motion explains state, reveals stay under 600 ms, only transform and opacity animate, and
// prefers-reduced-motion turns movement off (MotionConfig reducedMotion="user" + CSS).
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
  type RefObject,
} from "react";
import { m, useInView, useMotionValue, useReducedMotion, useSpring, type HTMLMotionProps } from "motion/react";
import { REVEAL, SPRING_SOFT } from "@/lib/motion";

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  };
}

const FINE = "(hover: hover) and (pointer: fine)";
const subscribeFine = subscribeMedia(FINE);

/** True on devices with a mouse or trackpad (hover effects, magnetic pull, cursor light). */
export function useFinePointer(): boolean {
  return useSyncExternalStore(
    subscribeFine,
    () => window.matchMedia(FINE).matches,
    () => false,
  );
}

/** Once an element has scrolled into view it stays "in" (reveals run once). */
export function useInViewOnce<T extends Element>(amount = 0.25): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const inView = useInView(ref, { once: true, amount, margin: "0px 0px -8% 0px" });
  return [ref, inView];
}

/** A block that rises into place the first time it scrolls into view. */
export function Reveal({
  children,
  delay = 0,
  className,
  ...rest
}: { children: ReactNode; delay?: number; className?: string } & Omit<HTMLMotionProps<"div">, "children">) {
  return (
    <m.div
      data-reveal
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.15, margin: "0px 0px -6% 0px" }}
      variants={{ hidden: REVEAL.hidden, shown: { ...REVEAL.shown, transition: { ...REVEAL.shown.transition, delay } } }}
      {...rest}
    >
      {children}
    </m.div>
  );
}

/**
 * Words that slide up out of a mask, one after the other. The animation itself is CSS (.kinetic in
 * globals.css), so a server-rendered headline animates on first paint without waiting for JS;
 * `trigger="view"` waits until the heading scrolls into view instead.
 */
export function KineticText<T extends ElementType = "h2">({
  as,
  text,
  trigger = "load",
  delayMs = 0,
  accent,
  className,
  ...rest
}: {
  as?: T;
  text: string;
  trigger?: "load" | "view";
  delayMs?: number;
  /** Optional decoration per word index (e.g. a colour or an underline). */
  accent?: (word: string, index: number) => ReactNode | null;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "children" | "className">) {
  const Tag = (as ?? "h2") as ElementType;
  const ref = useRef<HTMLElement | null>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const on = trigger === "load" || inView;
  const words = text.split(" ");
  return (
    <Tag
      ref={ref}
      className={`kinetic ${className ?? ""}`}
      data-in={on ? "" : undefined}
      style={{ "--d0": `${delayMs}ms` } as React.CSSProperties}
      {...rest}
    >
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="kw">
            <span style={{ "--i": i } as React.CSSProperties}>{accent?.(w, i) ?? w}</span>
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </Tag>
  );
}

/** Rewrites the text of a counter's own text node in place (React keeps owning the node). */
function writeText(el: HTMLElement | null, text: string) {
  const node = el?.firstChild;
  if (node) node.nodeValue = text;
}

function formatNumber(v: number, decimals: number, grouping: boolean): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  });
}

/**
 * Counts up to the real value the first time it is seen. The final value is what the server
 * renders, what screen readers get and what reserves the width (no layout shift); only the
 * visible digits tick. `skipAfterMs` leaves a server-rendered number alone if it was already on
 * screen and the page took longer than that to hydrate, so a slow load never shows it jump back.
 */
export function CountUp({
  value,
  from = 0,
  decimals = 0,
  prefix = "",
  suffix = "",
  grouping = false,
  duration = 1100,
  delay = 0,
  skipAfterMs,
  className,
}: {
  value: number;
  from?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  grouping?: boolean;
  duration?: number;
  delay?: number;
  skipAfterMs?: number;
  className?: string;
}) {
  const box = useRef<HTMLSpanElement | null>(null);
  const digits = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(box, { once: true, amount: 0.5 });
  const reduce = useReducedMotion();
  const skip = useRef(false);
  const text = `${prefix}${formatNumber(value, decimals, grouping)}${suffix}`;

  useEffect(() => {
    const el = digits.current;
    if (skipAfterMs == null || !el) return;
    const r = el.getBoundingClientRect();
    skip.current = r.bottom > 0 && r.top < window.innerHeight && performance.now() > skipAfterMs;
  }, [skipAfterMs]);

  useEffect(() => {
    const el = digits.current;
    if (!el || !inView || reduce || skip.current) return;
    const show = (v: number) => writeText(el, `${prefix}${formatNumber(v, decimals, grouping)}${suffix}`);
    let raf = 0;
    let t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now + delay;
      const t = Math.min(1, Math.max(0, (now - t0) / duration));
      show(from + (value - from) * (1 - Math.pow(1 - t, 4)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    show(from);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      show(value);
    };
  }, [inView, reduce, value, from, decimals, prefix, suffix, grouping, duration, delay, skipAfterMs]);

  return (
    <span ref={box} className={`inline-grid tabular-nums ${className ?? ""}`}>
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {text}
      </span>
      <span ref={digits} aria-hidden className="col-start-1 row-start-1">
        {text}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

/**
 * The primary call to action: a gentle magnetic pull towards the cursor (at most `max` px), a
 * press that gives (scale 0.97). The pull is off on touch screens and with reduced motion.
 */
export function MagneticButton({
  children,
  max = 6,
  className,
  ...props
}: { children: ReactNode; max?: number; className?: string } & Omit<HTMLMotionProps<"button">, "children">) {
  const fine = useFinePointer();
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, SPRING_SOFT);
  const sy = useSpring(y, SPRING_SOFT);
  const active = fine && !reduce;
  const clamp = (v: number) => Math.max(-max, Math.min(max, v));
  return (
    <m.button
      className={className}
      style={{ x: sx, y: sy }}
      whileTap={{ scale: 0.97 }}
      onPointerMove={(e) => {
        if (!active || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set(clamp((e.clientX - (r.left + r.width / 2)) * 0.12));
        y.set(clamp((e.clientY - (r.top + r.height / 2)) * 0.3));
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
      {...props}
    >
      {children}
    </m.button>
  );
}

/**
 * Marks a group whose bars (.bar-fill) draw in together the first time it scrolls into view
 * (CSS in globals.css). Children set --i for a short stagger.
 */
export function InViewGroup({
  children,
  className,
  amount = 0.3,
  ...rest
}: { children: ReactNode; className?: string; amount?: number } & Omit<ComponentPropsWithoutRef<"div">, "children" | "className">) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(amount);
  return (
    <div ref={ref} className={className} data-bars="" data-in={inView ? "" : undefined} {...rest}>
      {children}
    </div>
  );
}

/**
 * A live counter for streaming values (the agent log): when the value changes it ticks from the
 * number on screen to the new one. Always the real value; the final text is what React renders.
 */
export function Ticker({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const shown = useRef(value);
  const reduce = useReducedMotion();
  // Layout effect: the old number is put back before the browser paints the new one, then ticks.
  useLayoutEffect(() => {
    const el = ref.current;
    const from = shown.current;
    shown.current = value;
    if (!el || reduce || from === value) return;
    writeText(el, String(from));
    let raf = 0;
    let t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const t = Math.min(1, (now - t0) / 420);
      writeText(el, String(Math.round(from + (value - from) * (1 - Math.pow(1 - t, 3)))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      writeText(el, String(value));
    };
  }, [value, reduce]);
  return (
    <span ref={ref} className={`tabular-nums ${className ?? ""}`}>
      {value}
    </span>
  );
}

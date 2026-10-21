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
import { SPRING_SOFT } from "@/lib/motion";
import { createReveals, isScrollKey, type RevealEnv, type RevealOptions } from "@/lib/reveal";

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

const isTextField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

// Scroll reveals (src/lib/reveal.ts): content is visible by default; blocks below the fold rise into
// place only once the person scrolls, so screenshots, print and automated browsers see everything.
const browserReveals: RevealEnv = {
  viewport: () => window.innerHeight,
  motion: () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches && !navigator.webdriver,
  whenInView(el, { amount, margin }, onEnter) {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        onEnter();
      },
      { threshold: amount, rootMargin: margin },
    );
    io.observe(el as Element);
    return () => io.disconnect();
  },
  onScrollIntent(onIntent) {
    const opts = { capture: true, passive: true } as const;
    const onKey = (e: KeyboardEvent) => {
      if (isScrollKey(e.key, isTextField(e.target))) onIntent();
    };
    window.addEventListener("wheel", onIntent, opts);
    window.addEventListener("touchmove", onIntent, opts);
    window.addEventListener("keydown", onKey, opts);
    return () => {
      window.removeEventListener("wheel", onIntent, opts);
      window.removeEventListener("touchmove", onIntent, opts);
      window.removeEventListener("keydown", onKey, opts);
    };
  },
};
let reveals: ReturnType<typeof createReveals> | null = null;
const revealController = () => (reveals ??= createReveals(browserReveals));

/** Call when the person asks to scroll somewhere (the act tabs): blocks still below the fold rise as they arrive. */
export function armReveals() {
  revealController().arm();
}

/**
 * Hooks an element marked for a reveal ([data-reveal], .kinetic, [data-bars], .tm-wrap) into the
 * scroll reveals. Runs before paint, so a block that has to wait is hidden before it is ever drawn.
 */
export function useScrollReveal<T extends HTMLElement>({ amount = 0.15, margin = "0px 0px -6% 0px" }: Partial<RevealOptions> = {}) {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    return revealController().watch(el, { amount, margin });
  }, [amount, margin]);
  return ref;
}

/** A block that rises into place: when it mounts, and below the fold as the person scrolls to it. */
export function Reveal({
  children,
  delay = 0,
  amount = 0.15,
  margin = "0px 0px -6% 0px",
  as,
  className,
}: {
  children: ReactNode;
  /** Seconds. */
  delay?: number;
  amount?: number;
  margin?: string;
  as?: "div" | "article" | "section";
  className?: string;
}) {
  const Tag = as ?? "div";
  const ref = useScrollReveal<HTMLElement>({ amount, margin });
  return (
    <Tag
      ref={ref as RefObject<never>}
      data-reveal=""
      className={className}
      style={delay ? ({ "--rd": `${Math.round(delay * 1000)}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}

/**
 * Words that slide up out of a mask, one after the other. The animation itself is CSS (.kinetic in
 * globals.css), so a server-rendered headline animates on first paint without waiting for JS;
 * `trigger="view"` also replays it as the person scrolls down to the heading (useScrollReveal).
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
  const ref = useScrollReveal<HTMLElement>({ amount: 0.6, margin: "0px" });
  const words = text.split(" ");
  return (
    <Tag
      ref={trigger === "view" ? ref : undefined}
      className={`kinetic ${className ?? ""}`}
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
 * A number that is right in every frame. The final value is what the server renders, what screen
 * readers get and what any still frame shows (a screenshot, a paused video, a slow device); the
 * first time it scrolls into view it only rises into place, it never counts through wrong values.
 * `skipAfterMs` leaves a server-rendered number alone if it was already on screen and the page took
 * longer than that to hydrate, so a slow load never shows it blink. Reduced motion: no animation.
 */
export function NumberReveal({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  grouping = false,
  duration = 700,
  delay = 0,
  skipAfterMs,
  className,
}: {
  value: number;
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
    if (!el || !inView || reduce || skip.current || typeof el.animate !== "function") return;
    const anim = el.animate(
      [
        { opacity: 0, transform: "translateY(0.4em)" },
        { opacity: 1, transform: "none" },
      ],
      { duration, delay, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" },
    );
    return () => anim.cancel();
  }, [inView, reduce, duration, delay]);

  return (
    <span ref={box} className={`inline-grid tabular-nums ${className ?? ""}`}>
      <span ref={digits} aria-hidden className="col-start-1 row-start-1 inline-block">
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
 * Marks a group whose bars (.bar-fill) draw in together when it mounts, and below the fold as the
 * person scrolls to it (CSS in globals.css, useScrollReveal). Children set --i for a short stagger.
 */
export function InViewGroup({
  children,
  className,
  amount = 0.3,
  ...rest
}: { children: ReactNode; className?: string; amount?: number } & Omit<ComponentPropsWithoutRef<"div">, "children" | "className">) {
  const ref = useScrollReveal<HTMLDivElement>({ amount, margin: "0px 0px -8% 0px" });
  return (
    <div ref={ref} className={className} data-bars="" {...rest}>
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

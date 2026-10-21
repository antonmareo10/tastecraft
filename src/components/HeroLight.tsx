"use client";

import { useEffect, useRef } from "react";

// The hero's backdrop: a faint taste graph (dots in the brand's domain colours: olive places,
// terracotta music, saffron brands, plum podcasts, like the playbook's constellation) and a warm
// light that follows the cursor and wakes up the part of the graph it passes over.
// It is decorative and abstract (no data): a 2D canvas redrawn only while the light moves.
// Touch screens and reduced motion get the same graph, drawn once, with the light at rest.

type Dot = { x: number; y: number; r: number; c: string };

const COLORS: [string, number][] = [
  ["47,74,53", 0.46], // olive
  ["192,83,44", 0.2], // terracotta
  ["221,154,46", 0.2], // saffron
  ["107,59,90", 0.14], // plum
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function HeroLight({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const interactive =
      window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let dots: Dot[] = [];
    let edges: [number, number][] = [];
    // Where the light never moves, a CSS glow in the page stands in for it (see TastecraftApp).
    const light = { x: 0, y: 0, tx: 0, ty: 0, a: 0, ta: interactive ? 1 : 0 };
    let raf = 0;
    let visible = true;
    let built = false;

    const radius = () => (w < 640 ? 210 : 320);

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      if (!w || !h) return;
      // Faint dots and hairlines need no retina canvas: cap the resolution (cheaper to clear and draw).
      const dpr = Math.min(interactive ? 1.5 : 1, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rand = rng(20261030);
      const cell = w < 640 ? 64 : 96;
      dots = [];
      for (let gy = 0; gy * cell < h; gy++) {
        for (let gx = 0; gx * cell < w; gx++) {
          if (rand() < 0.2) continue;
          let pick = rand();
          let c = COLORS[0][0];
          for (const [color, weight] of COLORS) {
            if ((pick -= weight) <= 0) {
              c = color;
              break;
            }
          }
          dots.push({ x: (gx + 0.15 + rand() * 0.7) * cell, y: (gy + 0.15 + rand() * 0.7) * cell, r: 1 + rand() * 1.6, c });
        }
      }
      // Each dot links to its two nearest neighbours: a sparse, organic web.
      const seen = new Set<number>();
      edges = [];
      const maxD = (cell * 1.7) ** 2;
      dots.forEach((d, i) => {
        dots
          .map((o, j) => [j, (o.x - d.x) ** 2 + (o.y - d.y) ** 2] as const)
          .filter(([j, dist]) => j !== i && dist < maxD)
          .sort((a, b) => a[1] - b[1])
          .slice(0, 2)
          .forEach(([j]) => {
            const key = Math.min(i, j) * 100000 + Math.max(i, j);
            if (!seen.has(key)) {
              seen.add(key);
              edges.push([i, j]);
            }
          });
      });
      if (!built) {
        // Resting place: just right of the headline (phones: the top right corner).
        light.x = light.tx = w * (w < 640 ? 0.82 : 0.44);
        light.y = light.ty = h * (w < 640 ? 0.16 : 0.3);
        built = true;
      }
    };

    const glow = (x: number, y: number) => {
      const rad = radius();
      const d = Math.hypot(x - light.x, y - light.y);
      return d >= rad ? 0 : light.a * (1 - d / rad) ** 2;
    };

    // Everything outside the light is drawn in a handful of batched paths (one per colour); only the
    // few dots and links inside the light get their own alpha.
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const rad = radius();
      if (light.a > 0.01) {
        const g = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, rad);
        g.addColorStop(0, `rgba(221,154,46,${0.22 * light.a})`);
        g.addColorStop(0.5, `rgba(192,83,44,${0.07 * light.a})`);
        g.addColorStop(1, "rgba(221,154,46,0)");
        ctx.fillStyle = g;
        ctx.fillRect(light.x - rad, light.y - rad, rad * 2, rad * 2);
      }
      ctx.lineWidth = 1;
      const litEdges: [Dot, Dot, number][] = [];
      ctx.strokeStyle = "rgba(47,74,53,0.045)";
      ctx.beginPath();
      for (const [i, j] of edges) {
        const a = dots[i];
        const b = dots[j];
        const k = glow((a.x + b.x) / 2, (a.y + b.y) / 2);
        if (k > 0.01) litEdges.push([a, b, k]);
        else {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();
      for (const [a, b, k] of litEdges) {
        ctx.strokeStyle = `rgba(47,74,53,${0.045 + k * 0.34})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const litDots: [Dot, number][] = [];
      for (const [color] of COLORS) {
        ctx.fillStyle = `rgba(${color},0.15)`;
        ctx.beginPath();
        for (const d of dots) {
          if (d.c !== color) continue;
          const k = glow(d.x, d.y);
          if (k > 0.01) litDots.push([d, k]);
          else {
            ctx.moveTo(d.x + d.r, d.y);
            ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
          }
        }
        ctx.fill();
      }
      for (const [d, k] of litDots) {
        ctx.fillStyle = `rgba(${d.c},${0.15 + k * 0.62})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r + k * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const step = () => {
      raf = 0;
      light.x += (light.tx - light.x) * 0.1;
      light.y += (light.ty - light.y) * 0.1;
      light.a += (light.ta - light.a) * 0.06;
      draw();
      const moving =
        Math.abs(light.tx - light.x) > 0.4 || Math.abs(light.ty - light.y) > 0.4 || Math.abs(light.ta - light.a) > 0.004;
      if (moving && visible) raf = requestAnimationFrame(step);
    };
    const kick = () => {
      if (!raf && visible && built) raf = requestAnimationFrame(step);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = canvas.getBoundingClientRect();
      light.tx = Math.max(-80, Math.min(r.width + 80, e.clientX - r.left));
      light.ty = Math.max(-80, Math.min(r.height + 40, e.clientY - r.top));
      light.ta = 1;
      kick();
    };
    const onLeave = () => {
      light.ta = 0.6;
      kick();
    };

    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        build();
        draw();
      });
    });
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) kick();
    });

    // Start once the page is idle: the graph is decoration and must not compete with loading. On touch
    // screens and with reduced motion, where it never moves, it waits until the page has settled.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
    let handle = 0;
    let timer = 0;
    const start = () => {
      handle = idle(() => {
        build();
        draw();
        canvas.dataset.ready = "";
        ro.observe(canvas);
        io.observe(canvas);
        if (interactive) {
          window.addEventListener("pointermove", onMove, { passive: true });
          document.documentElement.addEventListener("pointerleave", onLeave);
          kick(); // fades the light in
        }
      });
    };
    const settled = () => {
      timer = window.setTimeout(start, 2500);
    };
    if (interactive) start();
    else if (document.readyState === "complete") settled();
    else window.addEventListener("load", settled, { once: true });

    return () => {
      cancelIdle(handle);
      window.clearTimeout(timer);
      window.removeEventListener("load", settled);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(resizeRaf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={`hero-light pointer-events-none ${className ?? ""}`} />;
}

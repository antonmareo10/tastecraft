"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { SPRING } from "@/lib/motion";
import { IconCheck } from "./icons";

// Confirmation toasts for copy, download and calendar actions. Any component can call toast()
// without a provider; the single <Toaster /> in the layout listens and announces them politely.
const EVENT = "tastecraft:toast";

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

type Item = { id: number; message: string };

let nextId = 0;

export default function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onToast = (e: Event) => {
      const message = (e as CustomEvent<string>).detail;
      const id = ++nextId;
      setItems((prev) => [...prev.filter((t) => t.message !== message).slice(-2), { id, message }]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, 2800);
      timers.add(timer);
    };
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print pointer-events-none fixed inset-x-0 bottom-5 z-[1300] flex flex-col items-center gap-2 px-4"
    >
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <m.div
            key={t.id}
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: SPRING }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.18 } }}
            className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm text-paper shadow-[0_18px_40px_-18px_rgba(29,27,23,0.6)]"
          >
            <span className="grid h-5 w-5 place-items-center rounded-full bg-paper/15 text-saffron">
              <IconCheck size={13} />
            </span>
            {t.message}
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

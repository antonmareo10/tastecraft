"use client";

import type { ReactNode } from "react";
import { LazyMotion, MotionConfig } from "motion/react";
import SmoothScroll from "./SmoothScroll";
import Toaster from "./Toaster";

// Motion is loaded lazily with the DOM feature set only (`m` components, features fetched after the
// first render), and every animation respects the visitor's reduced-motion setting.
const loadFeatures = () => import("./motion-features").then((mod) => mod.default);

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">
        <SmoothScroll />
        {children}
        <Toaster />
      </MotionConfig>
    </LazyMotion>
  );
}

// One motion language for the whole app (mirrored by --ease-out in globals.css):
// entrances ease out on the same curve, interactive elements settle on a soft spring.
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const DURATION = { reveal: 0.55, small: 0.3 } as const;

/** Stagger between items of a list, in seconds (40-80 ms). */
export const STAGGER = 0.05;

/** Popovers, toasts and the section pill. */
export const SPRING = { type: "spring", stiffness: 460, damping: 34, mass: 0.7 } as const;

/** Magnetic pull on the primary buttons: soft, never more than a few pixels. */
export const SPRING_SOFT = { stiffness: 260, damping: 18, mass: 0.5 } as const;

/** Entrance used by every revealed block: a short rise and fade. */
export const REVEAL = {
  hidden: { opacity: 0, y: 16 },
  shown: { opacity: 1, y: 0, transition: { duration: DURATION.reveal, ease: EASE_OUT } },
} as const;

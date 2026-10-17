import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge only knows Tailwind's default theme. Teach it our custom
 * shadow and animation names (tailwind.config.ts) so a later class really
 * replaces an earlier one, e.g. cn("shadow-soft", "shadow-xs") → "shadow-xs"
 * instead of keeping both and letting CSS source order decide.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ["soft", "lifted", "float", "glow"] }],
      animate: [
        {
          animate: [
            "fade-in",
            "fade-up",
            "scale-in",
            "shimmer",
            "aurora",
            "pulse-ring",
            "blink",
            "accordion-down",
            "accordion-up",
          ],
        },
      ],
      "font-size": [{ text: ["2xs"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

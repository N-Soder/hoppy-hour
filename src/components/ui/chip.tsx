import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Pill toggle for filters, tags, days and presets. Every selectable chip in
 * the app uses this so "selected" always looks the same: a solid primary fill.
 * Renders a real <button> with aria-pressed; hit area is ≥44px on touch.
 */
const chipVariants = cva(
  "touch-target inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      selected: {
        true: "border-primary bg-primary text-primary-foreground hover:bg-primary-hover hover:border-primary-hover",
        false: "border-input bg-card text-foreground hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-9 px-3.5 text-sm",
        lg: "min-h-[44px] px-4 text-sm",
      },
    },
    defaultVariants: { selected: false, size: "default" },
  },
);

export interface ChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed">,
    Omit<VariantProps<typeof chipVariants>, "selected"> {
  selected: boolean;
}

const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, selected, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(chipVariants({ selected, size }), className)}
      {...props}
    />
  ),
);
Chip.displayName = "Chip";

export { Chip };

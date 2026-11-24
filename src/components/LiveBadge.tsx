import type { SelectionLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "Live" (with a pulsing dot) only when the filter is the present moment;
 * otherwise a plain "On Sat 5:15 pm" so a future or past selection is never
 * described as happening now.
 */
export default function LiveBadge({ selection, className }: { selection: SelectionLabel; className?: string }) {
  if (selection.isNow) {
    return (
      <span
        className={cn(
          "flex flex-shrink-0 items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary",
          className,
        )}
      >
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        Live
      </span>
    );
  }
  return (
    <span className={cn("flex-shrink-0 whitespace-nowrap text-[11px] font-semibold text-primary", className)}>
      {selection.badge}
    </span>
  );
}

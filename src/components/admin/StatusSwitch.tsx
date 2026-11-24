import { cn } from "@/lib/utils";

/**
 * On/off switch (role="switch") with its visible state word beside it. The
 * caller supplies an accessible name that says what is switched, e.g.
 * "Active: Bobeche"; assistive tech then reads "Active: Bobeche, switch, on".
 */
export function StatusSwitch({
  checked,
  onCheckedChange,
  label,
  onText = "Active",
  offText = "Inactive",
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
  onText?: string;
  offText?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="touch-target group inline-flex items-center gap-2 rounded-full text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cn(
            "block h-5 w-5 rounded-full bg-background shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </span>
      <span
        aria-hidden="true"
        className={cn("hidden w-14 text-left sm:inline", checked ? "text-foreground" : "text-muted-foreground")}
      >
        {checked ? onText : offText}
      </span>
    </button>
  );
}

import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readableError } from "@/lib/admin";

/** Failed list load: says what failed, why, and offers Retry. Never the empty message. */
export function AdminErrorState({
  what,
  error,
  onRetry,
  retrying,
  compact = false,
}: {
  /** "submissions", "venues", "deals" — completes "Couldn't load …". */
  what: string;
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`rounded-lg border border-destructive/40 bg-destructive/5 text-center ${compact ? "p-3 space-y-2" : "py-10 px-4 space-y-3"}`}
    >
      <p className="flex items-center justify-center gap-2 font-medium text-destructive-text">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Couldn't load {what}
      </p>
      <p className="text-sm text-muted-foreground">{readableError(error)}</p>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying} className="gap-1.5">
        {retrying ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
        Retry
      </Button>
    </div>
  );
}

export function AdminLoading({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-2 text-sm text-muted-foreground ${compact ? "py-4" : "py-12"}`}>
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

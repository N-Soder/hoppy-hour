import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TidyState } from "@/hooks/use-tidy-suggestions";

interface Props {
  state: TidyState;
  /** Human label for the deal ("deal 2"), used in button names. */
  dealLabel: string;
  onUse: (text: string) => void;
  onKeep: () => void;
}

/**
 * The compact row under a deal's description offering the tidied text. The
 * polite live region is always mounted so the suggestion is announced when it
 * arrives; while loading or on error it holds a single muted line.
 */
export function TidySuggestion({ state, dealLabel, onUse, onKeep }: Props) {
  return (
    <div aria-live="polite" aria-atomic="true" className="empty:!mt-0">
      {state?.kind === "loading" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Tidying the text…
        </p>
      )}
      {state?.kind === "error" && <p className="text-xs text-muted-foreground">Couldn't tidy the text</p>}
      {state?.kind === "suggestion" && (
        <div className="rounded-md border border-dashed border-border bg-muted/40 px-2.5 py-2 text-sm">
          <p className="break-words">
            <Sparkles className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-primary" aria-hidden="true" />
            <span className="font-medium">Tidied: </span>
            {state.text}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8"
              onClick={() => onUse(state.text)}
              aria-label={`Use the tidied text for ${dealLabel}`}
            >
              Use this
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={onKeep}
              aria-label={`Keep the original text for ${dealLabel}`}
            >
              Keep original
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

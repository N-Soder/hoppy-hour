import { MapPin, MapPinOff, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MapMessageProps {
  kind: "loading" | "error" | "offline";
  title: string;
  detail?: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** Cover a rendered map (translucent) instead of filling an empty pane. */
  overlay?: boolean;
}

/** Centred status panel for the map pane: loading, failure with retry, offline. */
export function MapMessage({ kind, title, detail, onRetry, retrying, overlay }: MapMessageProps) {
  const Icon = kind === "offline" ? WifiOff : kind === "error" ? MapPinOff : MapPin;
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center",
        overlay ? "absolute inset-0 z-20 rounded-lg bg-background/85 backdrop-blur-sm" : "bg-muted",
      )}
    >
      <Icon
        className={cn("h-8 w-8 text-muted-foreground", kind === "loading" && "animate-pulse")}
        aria-hidden="true"
      />
      <p className="text-sm font-semibold">{title}</p>
      {detail && <p className="max-w-xs text-sm text-muted-foreground">{detail}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2 gap-1.5" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} aria-hidden="true" />
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      )}
    </div>
  );
}

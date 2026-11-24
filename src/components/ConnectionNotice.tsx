import { useEffect, useRef, useState, type ReactNode } from "react";
import { History, Wifi, WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { cn } from "@/lib/utils";

const BACK_ONLINE_MS = 4000;

/**
 * A quiet, persistent line while the device is offline, and a brief "Back
 * online" when the connection returns. The role="status" region is always
 * mounted, so screen readers hear both changes as they happen.
 *
 * `detail` follows "You're offline." (what still works, what will happen).
 * `extra` is shown whether or not the device is offline (e.g. the saved
 * results note when the server couldn't be reached).
 */
export function ConnectionNotice({
  detail,
  extra,
  className,
}: {
  detail?: ReactNode;
  extra?: ReactNode;
  className?: string;
}) {
  const online = useOnlineStatus();
  const [backOnline, setBackOnline] = useState(false);
  const wasOffline = useRef(!online);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setBackOnline(false);
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setBackOnline(true);
    const t = window.setTimeout(() => setBackOnline(false), BACK_ONLINE_MS);
    return () => window.clearTimeout(t);
  }, [online]);

  const show = !online || backOnline || !!extra;
  return (
    <div role="status" aria-live="polite" className={cn(!show && "sr-only", className)}>
      {show && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
            online
              ? "border-border bg-muted/60 text-muted-foreground"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
          )}
        >
          {(() => {
            const Icon = !online ? WifiOff : backOnline ? Wifi : History;
            return <Icon className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />;
          })()}
          <p className="min-w-0 flex-1">
            {!online ? (
              <>
                <span className="font-semibold">You're offline.</span>
                {detail && <> {detail}</>}
              </>
            ) : backOnline ? (
              <span className="font-semibold">Back online.</span>
            ) : null}
            {extra && <>{!online || backOnline ? " " : ""}{extra}</>}
          </p>
        </div>
      )}
    </div>
  );
}

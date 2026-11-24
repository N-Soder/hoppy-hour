import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronUp, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import VenueDetail, { ScrollCue, VenueStatusLine, type VenueStatus } from "@/components/VenueDetail";
import type { VenueWithHappyHours } from "@/hooks/use-venues";
import { formatDistance, formatTimeRange, type SelectionLabel } from "@/lib/format";
import { groupHappyHours } from "@/lib/happy-hour-utils";
import { cn } from "@/lib/utils";

export type SheetMode = "compact" | "expanded";

interface VenueSheetProps {
  venue: VenueWithHappyHours;
  status: VenueStatus;
  mode: SheetMode;
  onModeChange: (mode: SheetMode) => void;
  onClose: () => void;
  selection: SelectionLabel;
  filteredHappyHourIds: Set<string>;
  selectedDay: number;
  selectedIsToday: boolean;
  /** "Perth time" when the venue's clock differs from the viewer's. */
  zoneNote?: string | null;
  outsideRadiusNote?: string | null;
  /** Reports the sheet's height, so the map can keep the pin above it. */
  onHeightChange?: (px: number) => void;
}

const HEADING_ID = "venue-sheet-title";
const SWIPE_PX = 40;

/**
 * Phone venue detail: one bottom sheet with a compact state (name, status,
 * distance and the current or next deal) that expands to the full detail.
 * Compact leaves the map usable behind it; expanded is modal (the page behind
 * is made inert by the caller). Swipe or tap the handle to expand/collapse;
 * swipe down from compact, the close button or Esc to close.
 */
export default function VenueSheet({
  venue,
  status,
  mode,
  onModeChange,
  onClose,
  selection,
  filteredHappyHourIds,
  selectedDay,
  selectedIsToday,
  zoneNote,
  outsideRadiusNote,
  onHeightChange,
}: VenueSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const expanded = mode === "expanded";

  // Focus the venue name when a venue opens, so screen readers announce it
  // and Tab continues inside the sheet.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [venue.id]);

  useEffect(() => {
    if (expanded) scrollRef.current?.scrollTo({ top: 0 });
  }, [expanded, venue.id]);

  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el || !onHeightChange) return;
    const report = () => onHeightChange(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => {
      ro.disconnect();
      onHeightChange(0);
    };
  }, [onHeightChange]);

  // Pointer swipe on the header: up expands; down collapses, then closes.
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button:not([data-sheet-handle]), a")) return;
    dragStart.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragStart.current === null) return;
    setDragY(Math.max(0, e.clientY - dragStart.current));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragStart.current === null) return;
    const dy = e.clientY - dragStart.current;
    dragStart.current = null;
    setDragY(0);
    if (dy < -SWIPE_PX && !expanded) onModeChange("expanded");
    else if (dy > SWIPE_PX) {
      if (expanded) onModeChange("compact");
      else onClose();
    }
  };

  const grouped = groupHappyHours(venue.happy_hours);
  const onNow = grouped.filter((g) => g.ids.some((id) => filteredHappyHourIds.has(id)));

  return (
    <>
      {expanded && (
        <div className="fixed inset-0 z-40 bg-black/40 animate-in fade-in-0" aria-hidden="true" onClick={onClose} />
      )}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal={expanded}
        aria-labelledby={HEADING_ID}
        data-venue-sheet=""
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border border-b-0 bg-background shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.25)]",
          "pb-[env(safe-area-inset-bottom)] animate-in slide-in-from-bottom-4 duration-200",
          expanded ? "max-h-[calc(100dvh-3rem)]" : "max-h-[60dvh]",
        )}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragY ? "none" : "transform 0.2s ease",
        }}
      >
        {/* Header: handle, name, status, close. The swipe target. */}
        <div
          className="touch-none select-none px-4 pt-1"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragStart.current = null;
            setDragY(0);
          }}
        >
          <button
            type="button"
            data-sheet-handle=""
            onClick={() => onModeChange(expanded ? "compact" : "expanded")}
            aria-expanded={expanded}
            aria-controls="venue-sheet-body"
            className="mx-auto flex h-6 w-full items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="h-1.5 w-12 rounded-full bg-muted-foreground/40" aria-hidden="true" />
            <span className="sr-only">{expanded ? "Show less" : "Show full details"}</span>
          </button>
          <div className="flex items-start gap-2 pb-3">
            <div className="min-w-0 flex-1">
              <h2
                id={HEADING_ID}
                ref={headingRef}
                tabIndex={-1}
                className="truncate text-base font-semibold leading-tight focus:outline-none"
              >
                {venue.name}
              </h2>
              {!expanded && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  <span className="font-medium text-primary">{formatDistance(venue.distance_meters)}</span> · {venue.address}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 -mt-1 h-9 w-9 flex-shrink-0 rounded-full"
              onClick={onClose}
              aria-label="Close venue details"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div id="venue-sheet-body" className="min-h-0 flex-1 flex flex-col">
          {expanded ? (
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
              <VenueStatusLine status={status} selection={selection} zoneNote={zoneNote} className="mb-3" />
              <VenueDetail
                venue={venue}
                status={status}
                selection={selection}
                filteredHappyHourIds={filteredHappyHourIds}
                selectedDay={selectedDay}
                selectedIsToday={selectedIsToday}
                zoneNote={zoneNote}
                outsideRadiusNote={outsideRadiusNote}
                headingId="venue-sheet-detail"
                hideHeader
              />
              <ScrollCue scrollRef={scrollRef} />
            </div>
          ) : (
            <div className="space-y-2 px-4 pb-4">
              <VenueStatusLine status={status} selection={selection} zoneNote={zoneNote} />
              {onNow[0] && (
                <p className="flex items-center gap-2 text-sm">
                  <Clock className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden="true" />
                  <span className="whitespace-nowrap font-semibold tabular-nums text-primary">
                    {formatTimeRange(onNow[0].start_time, onNow[0].end_time)}
                  </span>
                  <span className="min-w-0 truncate">{onNow[0].description}</span>
                </p>
              )}
              <Button variant="outline" className="w-full gap-1.5" onClick={() => onModeChange("expanded")}>
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
                Details and directions
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

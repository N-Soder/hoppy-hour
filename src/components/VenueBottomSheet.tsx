import { Drawer as DrawerPrimitive } from "vaul";
import { Drawer, DrawerPortal, DrawerOverlay } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VenueWithHappyHours } from "@/hooks/use-venues";
import { formatDistance, formatTimeRange, plural, type SelectionLabel } from "@/lib/format";
import { groupHappyHours, type GroupedHappyHour } from "@/lib/happy-hour-utils";
import LiveBadge from "@/components/LiveBadge";

interface VenueBottomSheetProps {
  venue: VenueWithHappyHours | null;
  open: boolean;
  onClose: () => void;
  onViewDetails: (id: string) => void;
  filteredHappyHourIds: Set<string>;
  liveVenueIds: Set<string>;
  selection: SelectionLabel;
}

function HappyHourRow({ hh }: { hh: GroupedHappyHour }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Clock className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="whitespace-nowrap tabular-nums text-muted-foreground">
        {formatTimeRange(hh.start_time, hh.end_time)}
      </span>
      <span className="flex-1 truncate font-medium">{hh.description}</span>
      <div className="flex flex-shrink-0 gap-1">
        {hh.tags?.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-[10px] capitalize">
            {tag}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default function VenueBottomSheet({
  venue,
  open,
  onClose,
  onViewDetails,
  filteredHappyHourIds,
  liveVenueIds,
  selection,
}: VenueBottomSheetProps) {
  if (!venue) return null;

  const isLive = liveVenueIds.has(venue.id);
  const matchingHH = venue.happy_hours.filter((hh) => filteredHappyHourIds.has(hh.id));
  const groupedMatchingHH = groupHappyHours(matchingHH);
  const dealCount = groupHappyHours(venue.happy_hours).length;

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerPortal>
        <DrawerOverlay className="bg-black/20" />
        <DrawerPrimitive.Content className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-xl border bg-background focus:outline-none">
          {/* Drag handle */}
          <div className="mx-auto mb-1 mt-3 h-1.5 w-12 rounded-full bg-muted" aria-hidden="true" />

          <div className="px-4 pb-6 pt-2">
            {/* Header row */}
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <DrawerPrimitive.Title className="truncate text-base font-semibold">
                    {venue.name}
                  </DrawerPrimitive.Title>
                  {isLive && <LiveBadge selection={selection} />}
                </div>
                <DrawerPrimitive.Description className="sr-only">
                  {isLive
                    ? `${plural(matchingHH.length, "deal")} on ${selection.phrase}`
                    : `${plural(dealCount, "deal")} listed`}
                  , {formatDistance(venue.distance_meters)} away
                </DrawerPrimitive.Description>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ', ' + venue.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 block truncate text-xs text-muted-foreground underline decoration-muted-foreground/60 underline-offset-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  {venue.address}
                </a>
              </div>
              <span
                className={cn(
                  "whitespace-nowrap pt-0.5 text-xs font-medium",
                  isLive ? "text-primary" : "text-muted-foreground",
                )}
              >
                {formatDistance(venue.distance_meters)}
              </span>
            </div>

            {/* Deals on at the selected time */}
            {groupedMatchingHH.length > 0 ? (
              <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                {groupedMatchingHH.slice(0, 3).map((group) => (
                  <HappyHourRow key={group.ids[0]} hh={group} />
                ))}
                {groupedMatchingHH.length > 3 && (
                  <p className="text-xs text-muted-foreground">
                    +{plural(groupedMatchingHH.length - 3, "more deal")}
                  </p>
                )}
              </div>
            ) : (
              dealCount > 0 && (
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  No matching deal on {selection.phrase} · {plural(dealCount, "deal")} listed
                </p>
              )
            )}

            <Button className="mt-4 w-full" onClick={() => onViewDetails(venue.id)}>
              View details
            </Button>
          </div>
        </DrawerPrimitive.Content>
      </DrawerPortal>
    </Drawer>
  );
}

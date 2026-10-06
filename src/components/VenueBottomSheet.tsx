import { Drawer as DrawerPrimitive } from "vaul";
import { Drawer, DrawerPortal, DrawerOverlay } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VenueWithHappyHours } from "@/hooks/use-venues";
import { formatDistance, formatTime } from "@/lib/format";
import { groupHappyHours, type GroupedHappyHour } from "@/lib/happy-hour-utils";

interface VenueBottomSheetProps {
  venue: VenueWithHappyHours | null;
  open: boolean;
  onClose: () => void;
  onViewDetails: (id: string) => void;
  filteredHappyHourIds: Set<string>;
  liveVenueIds: Set<string>;
}

function HappyHourRow({ hh }: { hh: GroupedHappyHour }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
      <span className="text-muted-foreground">
        {formatTime(hh.start_time)}–{formatTime(hh.end_time)}
      </span>
      <span className="truncate flex-1 font-medium">{hh.description}</span>
      <div className="flex gap-1 flex-shrink-0">
        {hh.tags?.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 capitalize">
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
}: VenueBottomSheetProps) {
  if (!venue) return null;

  const isLive = liveVenueIds.has(venue.id);
  const matchingHH = venue.happy_hours.filter((hh) => filteredHappyHourIds.has(hh.id));
  const groupedMatchingHH = groupHappyHours(matchingHH);

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerPortal>
        <DrawerOverlay className="bg-black/20" />
        <DrawerPrimitive.Content className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-xl border bg-background focus:outline-none">
          {/* Drag handle */}
          <div className="mx-auto mt-3 mb-1 h-1.5 w-12 rounded-full bg-muted" />

          <div className="px-4 pt-2 pb-6">
            {/* Header row */}
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className={cn(
                    "font-semibold text-base truncate",
                    !isLive && "text-muted-foreground"
                  )}>
                    {venue.name}
                  </h3>
                  {isLive && (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary flex-shrink-0">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                      </span>
                      Live
                    </span>
                  )}
                </div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ', ' + venue.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "text-xs mt-0.5 truncate block underline underline-offset-2 decoration-muted-foreground/40",
                    isLive ? "text-muted-foreground" : "text-muted-foreground/60"
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  {venue.address}
                </a>
              </div>
              <span className={cn(
                "text-xs font-medium whitespace-nowrap pt-0.5",
                isLive ? "text-primary" : "text-muted-foreground/60"
              )}>
                {formatDistance(venue.distance_meters)}
              </span>
            </div>

            {/* Happy hours */}
            {groupedMatchingHH.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                {groupedMatchingHH.slice(0, 3).map((group) => (
                  <HappyHourRow key={group.ids[0]} hh={group} />
                ))}
                {groupedMatchingHH.length > 3 && (
                  <p className="text-xs text-muted-foreground">
                    +{groupedMatchingHH.length - 3} more deals
                  </p>
                )}
              </div>
            )}

            {/* View details */}
            <Button
              className="w-full mt-4"
              onClick={() => onViewDetails(venue.id)}
            >
              View Details
            </Button>
          </div>
        </DrawerPrimitive.Content>
      </DrawerPortal>
    </Drawer>
  );
}

import { useRef, useEffect } from "react";
import { MapPin, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import type { VenueWithHappyHours } from "@/hooks/use-venues";
import { formatDistance, formatTime } from "@/lib/format";
import { groupHappyHours, type GroupedHappyHour } from "@/lib/happy-hour-utils";

interface VenueListProps {
  venues: VenueWithHappyHours[];
  selectedVenueId: string | null;
  onSelectVenue: (id: string) => void;
  filteredHappyHourIds: Set<string>;
  liveVenueIds: Set<string>;
}

export default function VenueList({
  venues,
  selectedVenueId,
  onSelectVenue,
  filteredHappyHourIds,
  liveVenueIds,
}: VenueListProps) {
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    if (selectedVenueId) {
      itemRefs.current.get(selectedVenueId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedVenueId]);

  if (venues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4 text-muted-foreground">
        <MapPin className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">No hoppy hours found nearby</p>
        <p className="text-xs mt-1 mb-4">Try expanding your search radius or adjusting the filters</p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/submit">Be the first to add one</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {venues.map((venue) => {
        const isLive = liveVenueIds.has(venue.id);
        const matchingHH = venue.happy_hours.filter((hh) =>
          filteredHappyHourIds.has(hh.id)
        );
        const groupedMatchingHH = groupHappyHours(matchingHH);
        const isSelected = venue.id === selectedVenueId;

        return (
          <button
            key={venue.id}
            ref={(el) => { if (el) itemRefs.current.set(venue.id, el); else itemRefs.current.delete(venue.id); }}
            onClick={() => onSelectVenue(venue.id)}
            className={cn(
              "w-full text-left p-4 rounded-xl border transition-all",
              isSelected
                ? "border-primary bg-accent shadow-[0_6px_18px_-6px_hsl(var(--primary)/0.45)]"
                : isLive
                  ? "border-primary/25 bg-card shadow-[0_6px_18px_-6px_hsl(var(--primary)/0.3)] hover:border-primary/50"
                  : "border-border/60 bg-transparent opacity-70 hover:opacity-100"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className={cn(
                    "font-semibold text-sm truncate",
                    !isLive && "text-muted-foreground"
                  )}>{venue.name}</h3>
                  {isLive && (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                      </span>
                      Live
                    </span>
                  )}
                </div>
                <p className={cn(
                  "text-xs mt-0.5 truncate",
                  isLive ? "text-muted-foreground" : "text-muted-foreground/60"
                )}>
                  {venue.address}
                </p>
              </div>
              <span className={cn(
                "text-xs font-medium whitespace-nowrap",
                isLive ? "text-primary" : "text-muted-foreground/60"
              )}>
                {formatDistance(venue.distance_meters)}
              </span>
            </div>

            {groupedMatchingHH.length > 0 && (
              <div className="mt-2.5 space-y-1.5">
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

            {!isLive && venue.happy_hours.length > 0 && (
              <p className="text-xs text-muted-foreground/60 mt-2">
                {venue.happy_hours.length} hoppy hour{venue.happy_hours.length !== 1 ? "s" : ""} available
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

function HappyHourRow({ hh }: { hh: GroupedHappyHour }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Clock className="h-3 w-3 text-primary/70 flex-shrink-0" />
      <span className="text-primary font-semibold tabular-nums">
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

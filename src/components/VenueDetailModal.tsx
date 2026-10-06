import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { MapPin, Clock, Navigation } from "lucide-react";
import type { VenueWithHappyHours } from "@/hooks/use-venues";
import { formatDistance, formatTime } from "@/lib/format";
import { groupHappyHours, formatDayRange, type GroupedHappyHour } from "@/lib/happy-hour-utils";

/**
 * Groups deals that share the exact same days_of_week set under one header,
 * then sorts those sections by their first day (Sun→Sat).
 * Deals within each section are sorted by start_time.
 */
function groupByDaySet(
  groups: GroupedHappyHour[]
): { days: number[]; deals: GroupedHappyHour[] }[] {
  const map = new Map<string, { days: number[]; deals: GroupedHappyHour[] }>();
  for (const group of groups) {
    const key = group.days_of_week.join(",");
    const existing = map.get(key);
    if (existing) {
      existing.deals.push(group);
    } else {
      map.set(key, { days: group.days_of_week, deals: [group] });
    }
  }
  return Array.from(map.values())
    .sort((a, b) => (a.days[0] ?? 0) - (b.days[0] ?? 0))
    .map(({ days, deals }) => ({
      days,
      deals: deals.slice().sort((a, b) => a.start_time.localeCompare(b.start_time)),
    }));
}

interface VenueDetailModalProps {
  venue: VenueWithHappyHours | null;
  open: boolean;
  onClose: () => void;
}

export default function VenueDetailModal({ venue, open, onClose }: VenueDetailModalProps) {
  if (!venue) return null;

  const grouped = groupHappyHours(venue.happy_hours);
  const byDaySet = groupByDaySet(grouped);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{venue.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ', ' + venue.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 text-sm text-muted-foreground hover:text-primary transition-colors group"
          >
            <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span className="underline underline-offset-2 decoration-muted-foreground/40 group-hover:decoration-primary">
              {venue.address}
            </span>
          </a>

          <div className="flex items-center gap-2 text-sm">
            <Navigation className="h-4 w-4 text-primary" />
            <span className="font-medium text-primary">
              {formatDistance(venue.distance_meters)} away
            </span>
          </div>

          <div className="border-t border-border pt-4">
            <h4 className="font-semibold text-sm mb-4">Hoppy Hours</h4>
            {byDaySet.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hoppy hours listed</p>
            ) : (
              <div className="space-y-5">
                {byDaySet.map(({ days, deals }) => (
                  <div key={days.join(",")} className="pl-3 border-l-2 border-primary/30">
                    {/* Day range header — rendered once per unique day set */}
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      {formatDayRange(days)}
                    </p>

                    {/* Deals for this day, in time order */}
                    <div className="space-y-3">
                      {deals.map((deal) => (
                        <div key={deal.ids[0]}>
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span>{formatTime(deal.start_time)} – {formatTime(deal.end_time)}</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
                            {deal.description}
                          </p>
                          {deal.tags && deal.tags.length > 0 && (
                            <div className="flex gap-1 mt-1.5 flex-wrap">
                              {deal.tags.map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-xs capitalize">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

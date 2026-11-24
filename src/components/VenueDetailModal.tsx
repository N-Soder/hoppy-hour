import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { MapPin, Clock, Navigation } from "lucide-react";
import type { VenueWithHappyHours } from "@/hooks/use-venues";
import { formatDistance, formatTimeRange, plural } from "@/lib/format";
import { groupHappyHours, groupByDaySet, formatDayRange } from "@/lib/happy-hour-utils";

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
      <DialogContent className="max-h-[80vh] max-w-md overflow-y-auto">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-lg">{venue.name}</DialogTitle>
          <DialogDescription className="sr-only">
            {plural(grouped.length, "deal")} at this venue, {formatDistance(venue.distance_meters)} away.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ', ' + venue.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="underline decoration-muted-foreground/60 underline-offset-2 group-hover:decoration-primary">
              {venue.address}
            </span>
          </a>

          <div className="flex items-center gap-2 text-sm">
            <Navigation className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="font-medium text-primary">{formatDistance(venue.distance_meters)} away</span>
          </div>

          <section className="border-t border-border pt-4" aria-labelledby="venue-deals-heading">
            <h3 id="venue-deals-heading" className="mb-4 text-sm font-semibold">
              Deals
            </h3>
            {byDaySet.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deals listed</p>
            ) : (
              <div className="space-y-5">
                {byDaySet.map(({ days, deals }) => (
                  <div key={days.join(",")} className="border-l-2 border-primary/30 pl-3">
                    {/* Day range header — rendered once per unique day set */}
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {formatDayRange(days)}
                    </h4>

                    {/* Deals for these days, in time order */}
                    <ul className="space-y-3">
                      {deals.map((deal) => (
                        <li key={deal.ids[0]}>
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            <Clock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span>{formatTimeRange(deal.start_time, deal.end_time)}</span>
                          </div>
                          <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{deal.description}</p>
                          {deal.tags && deal.tags.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {deal.tags.map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-xs capitalize">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

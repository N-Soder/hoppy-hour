// A venue's status at the selected date and time, for cards, sheet and panel.
import type { VenueWithHappyHours } from "./api-types";
import { groupHappyHours } from "./happy-hour-utils";

/** What the venue has going on at the selected date and time. */
export interface VenueStatus {
  isLive: boolean;
  /** Deals on at the selection. */
  liveCount: number;
  /** "Fri 4–6 pm" — the next deal, for a venue with nothing on. */
  nextLabel: string | null;
  /** Total distinct deals listed. */
  dealCount: number;
}

export function venueStatus(
  venue: VenueWithHappyHours,
  liveVenueCounts: Map<string, number>,
  nextLabels: Map<string, string>,
): VenueStatus {
  const liveCount = liveVenueCounts.get(venue.id) ?? 0;
  return {
    isLive: liveCount > 0,
    liveCount,
    nextLabel: nextLabels.get(venue.id) ?? null,
    dealCount: groupHappyHours(venue.happy_hours).length,
  };
}


import { Badge } from "@/components/ui/badge";
import { formatTimeRange } from "@/lib/format";
import { formatDayRange } from "@/lib/happy-hour-utils";
import { endsNextDay } from "@/lib/admin";
import type { SubmissionDeal } from "@/lib/api-types";

/** "Mon–Fri · 5–6 pm" line for one deal, with "ends next day" for overnight deals. */
export function DealWhen({ deal }: { deal: Pick<SubmissionDeal, "days_of_week" | "start_time" | "end_time"> }) {
  return (
    <span className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{formatDayRange(deal.days_of_week) || "No days"}</span>
      {" · "}
      {formatTimeRange(deal.start_time, deal.end_time)}
      {endsNextDay(deal.start_time, deal.end_time) && " (ends next day)"}
    </span>
  );
}

/** Read-only list of a submission's deals, used on queue cards and in the review dialog. */
export function SubmissionDealList({ deals }: { deals: SubmissionDeal[] }) {
  return (
    <ul className="divide-y divide-dashed divide-border">
      {deals.map((deal, i) => (
        <li key={i} className="space-y-1 py-2 first:pt-0 last:pb-0">
          <p className="text-sm">{deal.description}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <DealWhen deal={deal} />
            {deal.tags?.map((t) => (
              <Badge key={t} variant="outline" className="text-xs capitalize">
                {t}
              </Badge>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

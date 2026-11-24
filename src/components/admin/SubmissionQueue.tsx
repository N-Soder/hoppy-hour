import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Clock, Pencil, RotateCcw, X } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { dealsOf, formatShortDate, locationLabel, readableError } from "@/lib/admin";
import type { Submission } from "@/lib/api-types";
import { AdminErrorState, AdminLoading } from "./AdminStates";
import ReviewDialog from "./ReviewDialog";
import { SubmissionDealList } from "./SubmissionDeals";

type Status = Submission["status"];
const FILTERS: { value: Status; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const UNDO_MS = 10_000;

export default function SubmissionQueue() {
  const [filter, setFilter] = useState<Status>("pending");
  const [editing, setEditing] = useState<Submission | null>(null);
  // Card that opened the review dialog, so focus can return to it.
  const openerId = useRef<string | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: submissions = [], isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin_submissions", filter],
    queryFn: async () =>
      (await api.get<{ submissions: Submission[] }>(`/api/admin/submissions?status=${filter}`)).submissions,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin_submissions"] });

  const restore = useMutation({
    mutationFn: (sub: Submission) => api.post(`/api/admin/submissions/${sub.id}/restore`),
    onSuccess: (_r, sub) => {
      invalidate();
      toast({ title: "Moved back to pending", description: `${sub.venue_name} is waiting for review again.` });
    },
    onError: (err) => {
      invalidate();
      toast({ title: "Couldn't undo the rejection", description: readableError(err), variant: "destructive" });
    },
  });

  const reject = useMutation({
    mutationFn: (sub: Submission) => api.post(`/api/admin/submissions/${sub.id}/reject`),
    onSuccess: (_r, sub) => {
      invalidate();
      toast({
        title: "Rejected",
        description: `${sub.venue_name} moved to Rejected.`,
        duration: UNDO_MS,
        action: (
          <ToastAction altText={`Undo: move ${sub.venue_name} back to pending`} onClick={() => restore.mutate(sub)}>
            Undo
          </ToastAction>
        ),
      });
    },
    onError: (err) => {
      invalidate();
      toast({ title: "Couldn't reject", description: readableError(err), variant: "destructive" });
    },
  });

  const openReview = (sub: Submission) => {
    openerId.current = sub.id;
    setEditing(sub);
  };

  /** The card's Review button if the card is still listed, else the list heading. */
  const focusAfterClose = (): HTMLElement | null => {
    const id = openerId.current;
    const btn = id ? document.querySelector<HTMLElement>(`[data-review-button="${CSS.escape(id)}"]`) : null;
    return btn ?? listHeading.current;
  };

  const busyId = reject.isPending ? reject.variables?.id : restore.isPending ? restore.variables?.id : null;

  return (
    <div className="space-y-4">
      <h2 ref={listHeading} tabIndex={-1} className="sr-only">
        {FILTERS.find((f) => f.value === filter)?.label} submissions
      </h2>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show submissions">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? "default" : "outline"}
            size="sm"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <AdminLoading label="Loading submissions…" />
      ) : isError ? (
        <AdminErrorState what={`${filter} submissions`} error={error} onRetry={() => refetch()} retrying={isRefetching} />
      ) : submissions.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <Clock className="mx-auto mb-2 h-8 w-8" aria-hidden="true" />
          <p>
            {filter === "pending" ? "Nothing to review. New submissions will appear here." : `No ${filter} submissions.`}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3" aria-label={`${FILTERS.find((f) => f.value === filter)?.label} submissions`}>
          {submissions.map((sub) => (
            <li key={sub.id}>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {sub.image_key && (
                        <a
                          href={`/api/admin/submissions/${sub.id}/image`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0"
                        >
                          <img
                            src={`/api/admin/submissions/${sub.id}/image`}
                            alt={`Photo for ${sub.venue_name} (opens full size)`}
                            loading="lazy"
                            className="h-14 w-14 rounded-md border border-border object-cover"
                          />
                        </a>
                      )}
                      <div className="min-w-0">
                        <CardTitle className="flex flex-wrap items-center gap-1.5 text-base">
                          <span className="break-words">{sub.venue_name}</span>
                          {sub.source === "photo" && (
                            <Badge variant="outline" className="shrink-0 gap-1 text-xs font-normal">
                              <Camera className="h-3 w-3" aria-hidden="true" /> Photo
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription>{locationLabel(sub) || "No location given"}</CardDescription>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                      {sub.status !== "pending" && (
                        <Badge variant={sub.status === "approved" ? "default" : "secondary"}>
                          {sub.status === "approved" ? "Approved" : "Rejected"}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">Submitted {formatShortDate(sub.created_at)}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SubmissionDealList deals={dealsOf(sub)} />
                  {sub.status === "approved" && sub.venue_id && (
                    <p className="text-xs text-muted-foreground">Deals were added to an existing venue.</p>
                  )}
                  {filter === "pending" && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        data-review-button={sub.id}
                        disabled={busyId === sub.id}
                        onClick={() => openReview(sub)}
                        aria-label={`Review ${sub.venue_name}`}
                      >
                        <Pencil aria-hidden="true" /> Review
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-destructive/50 text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                        disabled={busyId === sub.id}
                        onClick={() => reject.mutate(sub)}
                        aria-label={`Reject ${sub.venue_name}`}
                      >
                        <X aria-hidden="true" /> Reject
                      </Button>
                    </div>
                  )}
                  {filter === "rejected" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === sub.id}
                      onClick={() => restore.mutate(sub)}
                      aria-label={`Move ${sub.venue_name} back to pending`}
                    >
                      <RotateCcw aria-hidden="true" /> Move back to pending
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ReviewDialog
          key={editing.id}
          submission={editing}
          onClose={() => setEditing(null)}
          onReject={(sub) => {
            setEditing(null);
            reject.mutate(sub);
          }}
          focusAfterClose={focusAfterClose}
        />
      )}
    </div>
  );
}

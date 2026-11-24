import { useId, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Scissors, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { useToast } from "@/hooks/use-toast";
import { VALID_TAGS, WEEK_DAYS, DAYS_SHORT, sortDaysInWeekOrder } from "@/lib/constants";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { HappyHour } from "@/hooks/use-venues";
import { groupHappyHours, ungroupHappyHour, type GroupedHappyHour } from "@/lib/happy-hour-utils";
import { formatTimeRange } from "@/lib/format";
import { dealSummary, dealTimeError, endsNextDay, readableError } from "@/lib/admin";
import { AdminErrorState, AdminLoading } from "./AdminStates";
import { DealWhen } from "./SubmissionDeals";

type HHForm = {
  days_of_week: number[];
  start_time: string;
  end_time: string;
  description: string;
  tags: string[];
  is_active: boolean;
};

const emptyHHForm: HHForm = {
  days_of_week: [],
  start_time: "16:00",
  end_time: "19:00",
  description: "",
  tags: [],
  is_active: true,
};

/** "“$8 pints” (Mon–Fri, 5–6 pm)": names a deal exactly in confirmations and toasts. */
function dealName(g: Pick<GroupedHappyHour, "description" | "days_of_week" | "start_time" | "end_time">): string {
  const desc = g.description.length > 60 ? `${g.description.slice(0, 60)}…` : g.description;
  return `“${desc}” (${dealSummary(g)})`;
}

export default function HappyHourManager({ venueId, venueName }: { venueId: string; venueName: string }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingGroupIds, setEditingGroupIds] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<HHForm>(emptyHHForm);
  const [attempted, setAttempted] = useState(false);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<GroupedHappyHour | null>(null);
  const [pendingSplitGroup, setPendingSplitGroup] = useState<GroupedHappyHour | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const ids = useId();
  const fid = (n: string) => `${ids}-${n}`;

  const { data: happyHours = [], isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin_happy_hours", venueId],
    queryFn: async () =>
      (await api.get<{ happy_hours: HappyHour[] }>(`/api/admin/venues/${venueId}/happy-hours`)).happy_hours,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin_happy_hours", venueId] });
    // The venues table shows a deal count.
    queryClient.invalidateQueries({ queryKey: ["admin_venues"] });
  };

  const onMutationError = (title: string) => (err: unknown) =>
    toast({ title, description: readableError(err), variant: "destructive" });

  const body = (f: HHForm) => ({
    days_of_week: f.days_of_week,
    start_time: f.start_time,
    end_time: f.end_time,
    description: f.description.trim(),
    tags: f.tags,
    is_active: f.is_active,
  });

  const createHH = useMutation({
    mutationFn: (f: HHForm) => api.post("/api/admin/happy-hours", { venue_id: venueId, ...body(f) }),
    onSuccess: (_r, f) => {
      invalidate();
      toast({ title: "Deal added", description: `${dealName(f)} at ${venueName}.` });
      resetForm();
    },
    onError: onMutationError("Couldn't add the deal"),
  });

  const updateHH = useMutation({
    mutationFn: ({ id, ...f }: HHForm & { id: string }) => api.put(`/api/admin/happy-hours/${id}`, body(f)),
    onSuccess: (_r, f) => {
      invalidate();
      toast({ title: "Deal updated", description: `${dealName(f)} at ${venueName}.` });
      resetForm();
    },
    onError: onMutationError("Couldn't update the deal"),
  });

  const updateGroupHH = useMutation({
    // Server updates the canonical record and deletes the duplicates atomically
    mutationFn: ({ ids, ...f }: HHForm & { ids: string[] }) =>
      api.post("/api/admin/happy-hours/group-update", { ids, fields: body(f) }),
    onSuccess: (_r, f) => {
      invalidate();
      toast({ title: "Deal updated", description: `${dealName(f)} at ${venueName}.` });
      resetForm();
    },
    onError: onMutationError("Couldn't update the deal"),
  });

  const deleteGroupHH = useMutation({
    mutationFn: (group: GroupedHappyHour) => api.post("/api/admin/happy-hours/group-delete", { ids: group.ids }),
    onSuccess: (_r, group) => {
      invalidate();
      toast({ title: "Deal deleted", description: `${dealName(group)} was removed from ${venueName}.` });
      setPendingDeleteGroup(null);
    },
    onError: onMutationError("Couldn't delete the deal"),
  });

  const splitGroupHH = useMutation({
    // Server deletes the source records and inserts the per-day records atomically
    mutationFn: (group: GroupedHappyHour) =>
      api.post("/api/admin/happy-hours/split", { ids: group.ids, records: ungroupHappyHour(group) }),
    onSuccess: (_r, group) => {
      invalidate();
      toast({
        title: `Split into ${group.days_of_week.length} single-day records`,
        description: `${dealName(group)} is now stored once per day.`,
      });
      setPendingSplitGroup(null);
    },
    onError: onMutationError("Couldn't split the deal"),
  });

  const resetForm = () => {
    setForm(emptyHHForm);
    setEditingId(null);
    setEditingGroupIds([]);
    setShowForm(false);
    setAttempted(false);
  };

  const startEditGroup = (group: GroupedHappyHour) => {
    setShowForm(false);
    setAttempted(false);
    setForm({
      days_of_week: group.days_of_week,
      start_time: group.start_time.slice(0, 5),
      end_time: group.end_time.slice(0, 5),
      description: group.description,
      tags: (group.tags ?? []).filter((t) => (VALID_TAGS as readonly string[]).includes(t)),
      is_active: group.is_active,
    });
    setEditingId(group.ids[0]);
    setEditingGroupIds(group.ids);
  };

  const timeError = dealTimeError(form.start_time, form.end_time);
  const formErrors = {
    days: form.days_of_week.length === 0 ? "Pick at least one day." : null,
    description: !form.description.trim() ? "Add a description." : null,
    time: timeError,
  };
  const formValid = !formErrors.days && !formErrors.description && !formErrors.time;

  const handleSave = () => {
    setAttempted(true);
    if (!formValid) return;
    if (editingGroupIds.length > 1) updateGroupHH.mutate({ ...form, ids: editingGroupIds });
    else if (editingId) updateHH.mutate({ ...form, id: editingId });
    else createHH.mutate(form);
  };

  const isPending =
    createHH.isPending || updateHH.isPending || updateGroupHH.isPending || splitGroupHH.isPending || deleteGroupHH.isPending;

  const showErr = (msg: string | null) => (attempted ? msg : null);

  const renderFormFields = () => (
    <>
      <div role="group" aria-labelledby={fid("days")} className="space-y-1.5">
        <p id={fid("days")} className="text-sm font-medium">
          Days <span aria-hidden="true" className="text-destructive-text">*</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {WEEK_DAYS.map((d) => (
            <Chip
              key={d.value}
              size="sm"
              aria-label={d.long}
              selected={form.days_of_week.includes(d.value)}
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  days_of_week: f.days_of_week.includes(d.value)
                    ? f.days_of_week.filter((x) => x !== d.value)
                    : [...f.days_of_week, d.value].sort((a, b) => a - b),
                }))
              }
            >
              {d.short}
            </Chip>
          ))}
        </div>
        {showErr(formErrors.days) && <p className="text-xs text-destructive-text">{formErrors.days}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={fid("start")}>
            Starts <span aria-hidden="true" className="text-destructive-text">*</span>
          </Label>
          <Input
            id={fid("start")}
            type="time"
            required
            value={form.start_time}
            onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={fid("end")}>
            Ends <span aria-hidden="true" className="text-destructive-text">*</span>
          </Label>
          <Input
            id={fid("end")}
            type="time"
            required
            value={form.end_time}
            aria-describedby={fid("when")}
            aria-invalid={!!showErr(formErrors.time) || undefined}
            onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
          />
        </div>
      </div>
      <p id={fid("when")} className="text-xs" aria-live="polite">
        {timeError ? (
          <span className={attempted ? "text-destructive-text" : "text-muted-foreground"}>{timeError}</span>
        ) : (
          <span className="text-muted-foreground">
            {formatTimeRange(form.start_time, form.end_time)}
            {endsNextDay(form.start_time, form.end_time) && (
              <span className="font-medium text-foreground"> · ends next day</span>
            )}
          </span>
        )}
      </p>
      <div className="space-y-1">
        <Label htmlFor={fid("desc")}>
          Description <span aria-hidden="true" className="text-destructive-text">*</span>
        </Label>
        <Input
          id={fid("desc")}
          required
          placeholder="e.g. 2-for-1 cocktails"
          value={form.description}
          aria-invalid={!!showErr(formErrors.description) || undefined}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        {showErr(formErrors.description) && <p className="text-xs text-destructive-text">{formErrors.description}</p>}
      </div>
      <div role="group" aria-labelledby={fid("tags")} className="space-y-1.5">
        <p id={fid("tags")} className="text-sm font-medium">Tags</p>
        <div className="flex flex-wrap gap-1.5">
          {VALID_TAGS.map((tag) => (
            <Chip
              key={tag}
              size="sm"
              className="capitalize"
              selected={form.tags.includes(tag)}
              onClick={() =>
                setForm((f) => ({ ...f, tags: f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag] }))
              }
            >
              {tag}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={fid("active")}
          checked={form.is_active}
          onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: !!v }))}
        />
        <Label htmlFor={fid("active")}>Active (shown on the map)</Label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={resetForm}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={isPending}>
          {isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {editingId ? "Save deal" : "Add deal"}
        </Button>
      </div>
    </>
  );

  const grouped = groupHappyHours(happyHours);

  return (
    <section aria-labelledby={fid("heading")} className="mt-2 space-y-3 border-t pt-4">
      <div className="flex items-center justify-between">
        <h3 id={fid("heading")} className="text-sm font-semibold">
          Deals{!isLoading && !isError ? ` (${grouped.length})` : ""}
        </h3>
        {!showForm && !editingId && !isError && (
          <Button type="button" variant="outline" size="sm" onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus aria-hidden="true" /> Add a deal
          </Button>
        )}
      </div>

      {isLoading && <AdminLoading label="Loading deals…" compact />}
      {isError && (
        <AdminErrorState what={`deals for ${venueName}`} error={error} onRetry={() => refetch()} retrying={isRefetching} compact />
      )}

      {grouped.map((group) => {
        const summary = dealSummary(group);
        return editingId === group.ids[0] ? (
          <div key={group.ids[0]} className="space-y-3 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-medium">
              Edit deal
              {editingGroupIds.length > 1 && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  (stored as {editingGroupIds.length} records; saving merges them into one)
                </span>
              )}
            </p>
            {renderFormFields()}
          </div>
        ) : (
          <div key={group.ids[0]} className="space-y-1 rounded-md border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <DealWhen deal={group} />
                {!group.is_active && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    Inactive
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => startEditGroup(group)}
                  disabled={isPending}
                  aria-label={`Edit deal: ${summary}`}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                {group.days_of_week.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground"
                    onClick={() => setPendingSplitGroup(group)}
                    disabled={isPending}
                    aria-label={`Split into one deal per day: ${summary}`}
                    title="Split into one deal per day"
                  >
                    <Scissors aria-hidden="true" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-destructive-text hover:text-destructive-text"
                  onClick={() => setPendingDeleteGroup(group)}
                  disabled={isPending}
                  aria-label={`Delete deal: ${summary}`}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
            <p className="text-muted-foreground">{group.description}</p>
            {group.tags && group.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {group.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs capitalize">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {!isLoading && !isError && grouped.length === 0 && !showForm && (
        <p className="py-2 text-center text-sm text-muted-foreground">No deals yet.</p>
      )}

      <AlertDialog
        open={!!pendingDeleteGroup}
        onOpenChange={(open) => !open && !deleteGroupHH.isPending && setPendingDeleteGroup(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this deal?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteGroup && (
                <>
                  {dealName(pendingDeleteGroup)} will be removed from <strong>{venueName}</strong>
                  {pendingDeleteGroup.ids.length > 1 ? ` (${pendingDeleteGroup.ids.length} stored records)` : ""}. This
                  can't be undone. To hide it instead, edit it and untick Active.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteGroupHH.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteGroupHH.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDeleteGroup) deleteGroupHH.mutate(pendingDeleteGroup);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteGroupHH.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Delete deal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingSplitGroup}
        onOpenChange={(open) => !open && !splitGroupHH.isPending && setPendingSplitGroup(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Split into {pendingSplitGroup?.days_of_week.length ?? 0} single-day records?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingSplitGroup && (
                <>
                  {dealName(pendingSplitGroup)} at <strong>{venueName}</strong> will be stored as a separate record
                  for each of{" "}
                  {sortDaysInWeekOrder(pendingSplitGroup.days_of_week)
                    .map((d) => DAYS_SHORT[d])
                    .join(", ")}
                  , with the same times, description and tags. Records that still match are listed together here.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={splitGroupHH.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={splitGroupHH.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingSplitGroup) splitGroupHH.mutate(pendingSplitGroup);
              }}
            >
              {splitGroupHH.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Split
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showForm && !editingId && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <p className="text-sm font-medium">New deal</p>
          {renderFormFields()}
        </div>
      )}
    </section>
  );
}

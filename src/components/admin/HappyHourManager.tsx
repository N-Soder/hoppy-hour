import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isAuthError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Loader2, Scissors } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { VALID_TAGS } from "@/lib/constants";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { HappyHour } from "@/hooks/use-venues";
import { groupHappyHours, formatDayRange, ungroupHappyHour, type GroupedHappyHour } from "@/lib/happy-hour-utils";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ALLOWED_TAGS = VALID_TAGS;

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

export default function HappyHourManager({ venueId }: { venueId: string }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingGroupIds, setEditingGroupIds] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<HHForm>(emptyHHForm);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<GroupedHappyHour | null>(null);
  const [pendingSplitGroup, setPendingSplitGroup] = useState<GroupedHappyHour | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: happyHours = [], isLoading } = useQuery({
    queryKey: ["admin_happy_hours", venueId],
    queryFn: async () => {
      const { happy_hours } = await api.get<{ happy_hours: HappyHour[] }>(
        `/api/admin/venues/${venueId}/happy-hours`,
      );
      return happy_hours;
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin_happy_hours", venueId] });

  const onMutationError = (err: unknown) => {
    toast({
      title: isAuthError(err)
        ? "Your admin session expired — reload to sign in again"
        : err instanceof Error
          ? err.message
          : "Something went wrong",
      variant: "destructive",
    });
  };

  const createHH = useMutation({
    mutationFn: async (f: HHForm) => {
      await api.post("/api/admin/happy-hours", {
        venue_id: venueId,
        days_of_week: f.days_of_week,
        start_time: f.start_time,
        end_time: f.end_time,
        description: f.description,
        tags: f.tags,
        is_active: f.is_active,
      });
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Hoppy hour added" });
      resetForm();
    },
    onError: onMutationError,
  });

  const updateHH = useMutation({
    mutationFn: async ({ id, ...f }: HHForm & { id: string }) => {
      await api.put(`/api/admin/happy-hours/${id}`, {
        days_of_week: f.days_of_week,
        start_time: f.start_time,
        end_time: f.end_time,
        description: f.description,
        tags: f.tags,
        is_active: f.is_active,
      });
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Hoppy hour updated" });
      resetForm();
    },
    onError: onMutationError,
  });

  const updateGroupHH = useMutation({
    mutationFn: async ({ ids, ...f }: HHForm & { ids: string[] }) => {
      // Server updates the canonical record and deletes the duplicates atomically
      await api.post("/api/admin/happy-hours/group-update", {
        ids,
        fields: {
          days_of_week: f.days_of_week,
          start_time: f.start_time,
          end_time: f.end_time,
          description: f.description,
          tags: f.tags,
          is_active: f.is_active,
        },
      });
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Hoppy hour updated" });
      resetForm();
    },
    onError: onMutationError,
  });

  const deleteGroupHH = useMutation({
    mutationFn: async (ids: string[]) => {
      await api.post("/api/admin/happy-hours/group-delete", { ids });
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Hoppy hour deleted" });
    },
    onError: onMutationError,
  });

  const splitGroupHH = useMutation({
    mutationFn: async (group: GroupedHappyHour) => {
      // Server deletes the source records and inserts the per-day records atomically
      await api.post("/api/admin/happy-hours/split", {
        ids: group.ids,
        records: ungroupHappyHour(group),
      });
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Split into per-day records" });
    },
    onError: onMutationError,
  });

  const resetForm = () => {
    setForm(emptyHHForm);
    setEditingId(null);
    setEditingGroupIds([]);
    setShowForm(false);
  };

  const startEditGroup = (group: GroupedHappyHour) => {
    setShowForm(false);
    setForm({
      days_of_week: group.days_of_week,
      start_time: group.start_time,
      end_time: group.end_time,
      description: group.description,
      tags: (group.tags ?? []).filter((t) => (ALLOWED_TAGS as readonly string[]).includes(t)),
      is_active: group.is_active,
    });
    setEditingId(group.ids[0]);
    setEditingGroupIds(group.ids);
  };

  const handleSave = () => {
    if (!form.description.trim()) return;
    if (form.end_time <= form.start_time) {
      toast({ title: "End time must be after start time", variant: "destructive" });
      return;
    }
    if (editingGroupIds.length > 1) {
      updateGroupHH.mutate({ ...form, ids: editingGroupIds });
    } else if (editingId) {
      updateHH.mutate({ ...form, id: editingId });
    } else {
      createHH.mutate(form);
    }
  };

  const isPending =
    createHH.isPending ||
    updateHH.isPending ||
    updateGroupHH.isPending ||
    splitGroupHH.isPending ||
    deleteGroupHH.isPending;

  const renderFormFields = () => (
    <>
      <div className="space-y-1">
        <Label className="text-xs">Days</Label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={i} className="flex items-center gap-1 text-xs">
              <Checkbox
                checked={form.days_of_week.includes(i)}
                onCheckedChange={(checked) => {
                  setForm((f) => ({
                    ...f,
                    days_of_week: checked
                      ? [...f.days_of_week, i].sort()
                      : f.days_of_week.filter((x) => x !== i),
                  }));
                }}
              />
              {d.slice(0, 3)}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Start</Label>
          <Input
            type="time"
            className="h-9 text-xs"
            value={form.start_time}
            onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">End</Label>
          <Input
            type="time"
            className="h-9 text-xs"
            value={form.end_time}
            onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Input
          className="h-9 text-xs"
          placeholder="e.g. 2-for-1 cocktails"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Tags</Label>
        <div className="flex flex-wrap gap-2">
          {ALLOWED_TAGS.map((tag) => (
            <label
              key={tag}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs cursor-pointer transition-colors capitalize ${
                form.tags.includes(tag)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border hover:bg-accent"
              }`}
            >
              <Checkbox
                className="sr-only"
                checked={form.tags.includes(tag)}
                onCheckedChange={(checked) =>
                  setForm((f) => ({
                    ...f,
                    tags: checked ? [...f.tags, tag] : f.tags.filter((t) => t !== tag),
                  }))
                }
              />
              {tag}
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="hh-active"
          checked={form.is_active}
          onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: !!v }))}
        />
        <Label htmlFor="hh-active" className="text-xs">Active</Label>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={resetForm}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={isPending || !form.description.trim() || form.days_of_week.length === 0}>
          {isPending ? "Saving…" : editingId ? "Update" : "Add"}
        </Button>
      </div>
    </>
  );

  const grouped = groupHappyHours(happyHours);

  return (
    <div className="space-y-3 border-t pt-4 mt-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">Hoppy Hours</h4>
        {!showForm && !editingId && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { resetForm(); setShowForm(true); }}
          >
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* List */}
      {grouped.map((group) =>
        editingId === group.ids[0] ? (
          /* Inline edit form — replaces the item being edited */
          <div key={group.ids[0]} className="border rounded-md p-3 space-y-3 bg-muted/30">
            <p className="text-sm font-medium">
              Edit Hoppy Hour
              {editingGroupIds.length > 1 && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  (updating {editingGroupIds.length} records)
                </span>
              )}
            </p>
            {renderFormFields()}
          </div>
        ) : (
          <div
            key={group.ids[0]}
            className="border rounded-md p-3 space-y-1 text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-medium">{formatDayRange(group.days_of_week)}</span>
                <span className="text-muted-foreground ml-2">
                  {group.start_time.slice(0, 5)} – {group.end_time.slice(0, 5)}
                </span>
                {!group.is_active && (
                  <Badge variant="secondary" className="ml-2 text-xs">Inactive</Badge>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEditGroup(group)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                {group.days_of_week.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    title="Split into per-day records"
                    onClick={() => setPendingSplitGroup(group)}
                    disabled={isPending}
                  >
                    <Scissors className="h-3 w-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  onClick={() => setPendingDeleteGroup(group)}
                  disabled={isPending}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <p className="text-muted-foreground">{group.description}</p>
            {group.tags && group.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {group.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {!isLoading && grouped.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground text-center py-2">No hoppy hours yet</p>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!pendingDeleteGroup} onOpenChange={(open) => !open && setPendingDeleteGroup(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete hoppy hour?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteGroup && pendingDeleteGroup.ids.length > 1
                ? `This will permanently delete ${pendingDeleteGroup.ids.length} linked records. This action cannot be undone.`
                : "This will permanently remove this deal. This action cannot be undone."
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteGroup) {
                  deleteGroupHH.mutate(pendingDeleteGroup.ids);
                  setPendingDeleteGroup(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Split confirmation */}
      <AlertDialog open={!!pendingSplitGroup} onOpenChange={(open) => !open && setPendingSplitGroup(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Split into per-day records?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace this entry with {pendingSplitGroup?.days_of_week.length ?? 0} separate
              single-day records so you can edit each day independently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSplitGroup) {
                  splitGroupHH.mutate(pendingSplitGroup);
                  setPendingSplitGroup(null);
                }
              }}
            >
              Split
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add new form — only shown when adding, not editing */}
      {showForm && !editingId && (
        <div className="border rounded-md p-3 space-y-3 bg-muted/30">
          <p className="text-sm font-medium">New Hoppy Hour</p>
          {renderFormFields()}
        </div>
      )}
    </div>
  );
}

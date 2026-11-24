import { useId, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Globe, Loader2, MapPin, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Venue } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ToastAction } from "@/components/ui/toast";
import { CountryPicker } from "@/components/submit/CountryPicker";
import { useToast } from "@/hooks/use-toast";
import { geocodeAddress } from "@/lib/geocode";
import { countryByCode } from "@/lib/countries";
import { plural } from "@/lib/format";
import {
  filterVenues, keepRowOrder, readableError, sortVenues, venueCountLabel, VENUE_SORT_OPTIONS, type VenueSort,
  type VenueSortKey,
} from "@/lib/admin";
import HappyHourManager from "./HappyHourManager";
import { AdminErrorState, AdminLoading } from "./AdminStates";
import { StatusSwitch } from "./StatusSwitch";
import { TimeZonePicker } from "./TimeZonePicker";

type VenueForm = {
  name: string;
  address: string;
  /** ISO 3166-1 alpha-2, or "" when not set. */
  country: string;
  lat: number | null;
  lng: number | null;
  /** IANA zone the deal times are in; only edited for an existing venue. */
  timezone: string | null;
};

const emptyForm: VenueForm = { name: "", address: "", country: "", lat: null, lng: null, timezone: null };
const UNDO_MS = 10_000;

function SortButton({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: VenueSortKey;
  sort: VenueSort;
  onSort: (key: VenueSortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="touch-target -mx-2 inline-flex items-center gap-1 rounded px-2 py-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
      <Icon className={`h-3.5 w-3.5 ${active ? "text-foreground" : "opacity-60"}`} aria-hidden="true" />
      <span className="sr-only">
        {active ? `, sorted ${sort.dir === "asc" ? "ascending" : "descending"}. Activate to reverse.` : ", activate to sort"}
      </span>
    </button>
  );
}

export default function VenueManager() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<VenueSort>({ key: "name", dir: "asc" });
  const [editVenue, setEditVenue] = useState<Venue | null>(null);
  const [formData, setFormData] = useState<VenueForm>(emptyForm);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeNote, setGeocodeNote] = useState<string | null>(null);
  const [deleteVenue, setDeleteVenue] = useState<Venue | null>(null);
  // The form as the dialog opened, to tell whether there are unsaved changes.
  const [formStart, setFormStart] = useState<VenueForm>(emptyForm);
  const [dealsDirty, setDealsDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Whether the database has venues.timezone yet (migration 0005); the time
  // zone field is hidden until it does.
  const [timezoneSupported, setTimezoneSupported] = useState(false);
  const [isDetectingZone, setIsDetectingZone] = useState(false);
  const [zoneNote, setZoneNote] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const ids = useId();
  const fid = (n: string) => `${ids}-${n}`;

  const { data: venues = [], isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin_venues"],
    queryFn: async () => {
      const res = await api.get<{ venues: Venue[]; timezone_supported?: boolean }>("/api/admin/venues");
      setTimezoneSupported(res.timezone_supported === true);
      return res.venues;
    },
  });

  // Rows keep their place while the admin works on them (switching a venue
  // off under a Status sort mustn't move it away from its Undo toast). The
  // order is recomputed on an explicit sort or search, when venues are added
  // or removed, and on reload.
  const rowOrder = useRef<{ basis: string; ids: string[] } | null>(null);
  const visible = useMemo(() => {
    const sorted = sortVenues(filterVenues(venues, search), sort);
    const basis = `${sort.key}|${sort.dir}|${search.trim().toLowerCase()}`;
    const kept = keepRowOrder(rowOrder.current?.basis === basis ? rowOrder.current.ids : null, sorted);
    rowOrder.current = { basis, ids: kept.map((v) => v.id) };
    return kept;
  }, [venues, search, sort]);
  // Names that appear more than once: their buttons also name the address.
  const duplicateNames = useMemo(() => {
    const seen = new Map<string, number>();
    venues.forEach((v) => seen.set(v.name.toLowerCase(), (seen.get(v.name.toLowerCase()) ?? 0) + 1));
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [venues]);
  const venueLabel = (v: Venue) => (duplicateNames.has(v.name.toLowerCase()) ? `${v.name} (${v.address})` : v.name);

  const toggleSort = (key: VenueSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const onError = (title: string) => (err: unknown) =>
    toast({ title, description: readableError(err), variant: "destructive" });

  const invalidateVenues = () => queryClient.invalidateQueries({ queryKey: ["admin_venues"] });

  const updateVenue = useMutation({
    mutationFn: async ({ id, lat, lng, timezone, sendTimezone, ...f }: VenueForm & { id: string; sendTimezone: boolean }) => {
      await api.put(`/api/admin/venues/${id}`, {
        name: f.name.trim(),
        address: f.address.trim(),
        country: f.country || null,
        ...(lat != null && lng != null ? { lat, lng } : {}),
        // Only a zone the admin changed is sent: otherwise a new pin lets the
        // server derive the zone again from the new coordinates.
        ...(sendTimezone ? { timezone } : {}),
      });
    },
    onSuccess: (_r, v) => {
      invalidateVenues();
      toast({ title: "Venue saved", description: `${v.name.trim()} is updated.` });
      closeDialog();
    },
    onError: onError("Couldn't save the venue"),
  });

  const createVenue = useMutation({
    mutationFn: async (form: VenueForm) => {
      await api.post<{ id: string }>("/api/admin/venues", {
        name: form.name.trim(),
        address: form.address.trim(),
        country: form.country || null,
        lat: form.lat,
        lng: form.lng,
      });
    },
    onSuccess: (_r, f) => {
      invalidateVenues();
      toast({ title: "Venue added", description: `${f.name.trim()} is on the map. Add its deals from the venue's edit screen.` });
      closeDialog();
    },
    onError: onError("Couldn't add the venue"),
  });

  const deleteVenueMutation = useMutation({
    mutationFn: async (venue: Venue) => {
      await api.del(`/api/admin/venues/${venue.id}`);
    },
    onSuccess: (_r, venue) => {
      invalidateVenues();
      queryClient.invalidateQueries({ queryKey: ["admin_happy_hours", venue.id] });
      toast({ title: "Venue deleted", description: `${venueLabel(venue)} and its deals were removed.` });
      setDeleteVenue(null);
    },
    onError: onError("Couldn't delete the venue"),
  });

  // Status switch: optimistic, with a toast that can undo the change.
  const setStatus = useMutation({
    mutationFn: async ({ venue, status }: { venue: Venue; status: Venue["status"]; isUndo?: boolean }) => {
      await api.put(`/api/admin/venues/${venue.id}`, { status });
    },
    onMutate: async ({ venue, status }) => {
      await queryClient.cancelQueries({ queryKey: ["admin_venues"] });
      const previous = queryClient.getQueryData<Venue[]>(["admin_venues"]);
      queryClient.setQueryData<Venue[]>(["admin_venues"], (list) =>
        list?.map((v) => (v.id === venue.id ? { ...v, status } : v)),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["admin_venues"], ctx.previous);
      onError("Couldn't change the venue's status")(err);
    },
    onSuccess: (_r, { venue, status, isUndo }) => {
      const name = venueLabel(venue);
      toast({
        title: isUndo ? "Change undone" : status === "active" ? `${venue.name} is active` : `${venue.name} is inactive`,
        description:
          status === "active" ? `${name} shows on the public map again.` : `${name} is hidden from the public map.`,
        ...(isUndo
          ? {}
          : {
              duration: UNDO_MS,
              action: (
                <ToastAction
                  altText={`Undo: set ${name} back to ${status === "active" ? "inactive" : "active"}`}
                  onClick={() =>
                    setStatus.mutate({ venue, status: status === "active" ? "inactive" : "active", isUndo: true })
                  }
                >
                  Undo
                </ToastAction>
              ),
            }),
      });
    },
    onSettled: invalidateVenues,
  });

  const openEdit = (venue: Venue) => {
    const start: VenueForm = {
      name: venue.name,
      address: venue.address,
      country: venue.country ?? "",
      lat: null,
      lng: null,
      timezone: venue.timezone ?? null,
    };
    setEditVenue(venue);
    setFormData(start);
    setFormStart(start);
    setDealsDirty(false);
    setGeocodeNote(null);
    setZoneNote(null);
    setDialogOpen(true);
  };

  const openAdd = () => {
    setEditVenue(null);
    setFormData(emptyForm);
    setFormStart(emptyForm);
    setDealsDirty(false);
    setGeocodeNote(null);
    setZoneNote(null);
    setDialogOpen(true);
  };

  // "Detect from location": the zone the server derives for the pin (the new
  // one if the address was looked up again, else the venue's current one).
  const handleDetectZone = async () => {
    const lat = formData.lat ?? editVenue?.lat ?? null;
    const lng = formData.lng ?? editVenue?.lng ?? null;
    if (lat == null || lng == null) return;
    setIsDetectingZone(true);
    setZoneNote(null);
    try {
      const { timezone } = await api.get<{ timezone: string }>(`/api/admin/timezone?lat=${lat}&lng=${lng}`);
      setFormData((f) => ({ ...f, timezone }));
      setZoneNote(
        timezone === formData.timezone
          ? "The location gives the same time zone."
          : `Detected ${timezone.replace(/_/g, " ")}. Save to keep it.`,
      );
    } catch (err) {
      setZoneNote(`Couldn't detect the time zone: ${readableError(err)}`);
    } finally {
      setIsDetectingZone(false);
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setConfirmDiscard(false);
    setEditVenue(null);
    setFormData(emptyForm);
    setDealsDirty(false);
  };

  // Same rule as the review dialog: closing with unsaved edits asks first.
  const venueDirty = JSON.stringify(formData) !== JSON.stringify(formStart);
  const requestClose = () => {
    if (venueDirty || dealsDirty) setConfirmDiscard(true);
    else closeDialog();
  };

  const handleGeocode = async () => {
    const address = formData.address.trim();
    if (!address) return;
    setIsGeocoding(true);
    setGeocodeNote(null);
    try {
      const countryName = countryByCode(formData.country)?.name;
      const query = countryName && !address.toLowerCase().includes(countryName.toLowerCase()) ? `${address}, ${countryName}` : address;
      const { coords, country } = await geocodeAddress(formData.name, query, formData.country || null);
      if (coords) {
        setFormData((f) => ({ ...f, lat: coords.lat, lng: coords.lng, country: f.country || country || "" }));
      } else {
        setGeocodeNote("Couldn't find that address. Include the suburb or city, and check the country.");
      }
    } catch (err) {
      const mapbox = err instanceof Error && err.message.startsWith("Mapbox error:");
      setGeocodeNote(
        mapbox
          ? `The address lookup is not working (${(err as Error).message}). Check MAPBOX_ACCESS_TOKEN in the Cloudflare Pages settings.`
          : "The address lookup failed (network). Try again.",
      );
    } finally {
      setIsGeocoding(false);
    }
  };

  const saveBlockers: string[] = [];
  if (!formData.name.trim()) saveBlockers.push("Add the venue name.");
  if (!formData.address.trim()) saveBlockers.push("Add the address.");
  if (!editVenue && formData.lat === null) saveBlockers.push("Look up the address so the venue has a map pin.");

  const handleSave = () => {
    if (saveBlockers.length) return;
    if (editVenue) {
      updateVenue.mutate({
        id: editVenue.id,
        ...formData,
        sendTimezone: timezoneSupported && formData.timezone !== formStart.timezone,
      });
    }
    else createVenue.mutate(formData);
  };

  const isSaving = updateVenue.isPending || createVenue.isPending;
  const countLabel = venueCountLabel(visible.length, venues.length);
  const ariaSort = (key: VenueSortKey) =>
    sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
          <Label htmlFor={fid("search")} className="sr-only">
            Search venues by name or address
          </Label>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={fid("search")}
            ref={searchRef}
            type="search"
            placeholder="Search venues…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {!isLoading && !isError && (
          <Badge variant="secondary" role="status" aria-live="polite">
            {countLabel}
          </Badge>
        )}
        <Button size="sm" onClick={openAdd} className="ml-auto sm:ml-0">
          <Plus aria-hidden="true" /> Add venue
        </Button>
        {/* Phones hide the column headers; this select sorts instead. */}
        {!isLoading && !isError && (
          <div className="flex w-full items-center gap-2 sm:hidden">
            <Label htmlFor={fid("sort")} className="shrink-0 text-sm text-muted-foreground">
              Sort by
            </Label>
            <select
              id={fid("sort")}
              className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":") as [VenueSortKey, VenueSort["dir"]];
                setSort({ key, dir });
              }}
            >
              {VENUE_SORT_OPTIONS.map((o) => (
                <option key={`${o.key}:${o.dir}`} value={`${o.key}:${o.dir}`}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {isLoading ? (
        <AdminLoading label="Loading venues…" />
      ) : isError ? (
        <AdminErrorState what="venues" error={error} onRetry={() => refetch()} retrying={isRefetching} />
      ) : (
        <div className="max-h-[calc(100dvh-13rem)] overflow-auto rounded-lg border">
          <table className="w-full caption-bottom text-sm [&_td]:px-2 [&_th]:px-2 sm:[&_td]:px-4 sm:[&_th]:px-4">
            <caption className="sr-only">Venues, {countLabel}</caption>
            <TableHeader className="sticky top-0 z-10 hidden bg-card shadow-[0_1px_0_hsl(var(--border))] sm:table-header-group">
              <TableRow className="hover:bg-transparent">
                <TableHead aria-sort={ariaSort("name")}>
                  <SortButton label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
                </TableHead>
                <TableHead className="hidden sm:table-cell">Address</TableHead>
                <TableHead aria-sort={ariaSort("deals")} className="hidden w-[5.5rem] text-right sm:table-cell">
                  <SortButton label="Deals" sortKey="deals" sort={sort} onSort={toggleSort} />
                </TableHead>
                <TableHead aria-sort={ariaSort("status")} className="w-[5.5rem] sm:w-[9rem]">
                  <SortButton label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                </TableHead>
                <TableHead className="w-[6.5rem]">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((venue) => (
                <TableRow key={venue.id}>
                  <TableCell className="py-3 font-medium">
                    {venue.name}
                    {!venue.country && (
                      <span className="ml-2 inline-block whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[11px] font-medium leading-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                        No country
                      </span>
                    )}
                    {/* Narrow screens hide the Address and Deals columns: the address goes
                        here, the deal count beside the status. */}
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground sm:hidden">
                      {venue.address}
                    </span>
                  </TableCell>
                  <TableCell className="hidden py-3 text-sm text-muted-foreground sm:table-cell">{venue.address}</TableCell>
                  <TableCell className="hidden py-3 text-right tabular-nums sm:table-cell">
                    <span aria-hidden="true">{venue.deal_count ?? "–"}</span>
                    <span className="sr-only">{venue.deal_count != null ? plural(venue.deal_count, "deal") : "Unknown"}</span>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex flex-col items-start gap-1.5">
                      <StatusSwitch
                        checked={venue.status === "active"}
                        label={`Active: ${venueLabel(venue)}`}
                        disabled={setStatus.isPending && setStatus.variables?.venue.id === venue.id}
                        onCheckedChange={(on) => setStatus.mutate({ venue, status: on ? "active" : "inactive" })}
                      />
                      <span className="whitespace-nowrap text-xs text-muted-foreground sm:hidden">
                        {venue.status === "inactive" ? "Inactive · " : ""}
                        {venue.deal_count != null ? plural(venue.deal_count, "deal") : "– deals"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(venue)} aria-label={`Edit ${venueLabel(venue)}`}>
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteVenue(venue)}
                        aria-label={`Delete ${venueLabel(venue)}`}
                        className="text-destructive-text hover:text-destructive-text"
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {venues.length === 0 ? (
                      "No venues yet. Add one, or approve a submission."
                    ) : (
                      <>
                        No venues match “{search.trim()}”.{" "}
                        <button
                          type="button"
                          className="text-primary underline underline-offset-2"
                          onClick={() => {
                            setSearch("");
                            searchRef.current?.focus();
                          }}
                        >
                          Clear search
                        </button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => (o ? setDialogOpen(true) : requestClose())}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto sm:w-[calc(100vw-2rem)]">
          <DialogHeader className="pr-10 text-left">
            <DialogTitle>{editVenue ? `Edit ${editVenue.name}` : "Add a venue"}</DialogTitle>
            <DialogDescription>
              {editVenue ? "Change the venue's details, or manage its deals below." : "Fields marked * are required."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={fid("name")}>
                Name <span aria-hidden="true" className="text-destructive-text">*</span>
              </Label>
              <Input
                id={fid("name")}
                required
                value={formData.name}
                onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={fid("country")}>Country</Label>
              <CountryPicker
                id={fid("country")}
                value={formData.country || null}
                onChange={(code) => setFormData((f) => ({ ...f, country: code }))}
                // An existing venue saved without a country: flag it, but let
                // every other edit save as before.
                needsValue={!!editVenue && !formData.country}
                aria-describedby={editVenue && !formData.country ? fid("country-missing") : undefined}
              />
              {editVenue && !formData.country && (
                <p id={fid("country-missing")} className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  This venue has no country. Pick one so address look-ups search the right country. You can still save
                  other changes without it.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={fid("address")}>
                Address <span aria-hidden="true" className="text-destructive-text">*</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id={fid("address")}
                  required
                  className="flex-1"
                  value={formData.address}
                  onChange={(e) => setFormData((f) => ({ ...f, address: e.target.value, lat: null, lng: null }))}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGeocode}
                  disabled={isGeocoding || !formData.address.trim()}
                  className="shrink-0"
                >
                  {isGeocoding ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MapPin aria-hidden="true" />}
                  {editVenue ? "Look up again" : "Look up"}
                </Button>
              </div>
              <div aria-live="polite" className="text-sm">
                {formData.lat != null && formData.lng != null ? (
                  <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    New pin: <span className="font-mono text-xs">{formData.lat.toFixed(5)}, {formData.lng.toFixed(5)}</span>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${formData.lat},${formData.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Check on Google Maps <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </p>
                ) : editVenue ? (
                  <p className="text-xs text-muted-foreground">
                    {editVenue.lat != null && editVenue.lng != null
                      ? `Current pin: ${editVenue.lat.toFixed(5)}, ${editVenue.lng.toFixed(5)}. Look up again to move it.`
                      : "This venue has no map pin. Look up the address to add one."}
                  </p>
                ) : null}
                {geocodeNote && <p className="mt-1 text-amber-700 dark:text-amber-400">{geocodeNote}</p>}
              </div>
            </div>
            {editVenue && timezoneSupported && (
              <div className="space-y-2">
                <Label htmlFor={fid("timezone")}>Time zone</Label>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <TimeZonePicker
                      id={fid("timezone")}
                      value={formData.timezone}
                      onChange={(zone) => {
                        setZoneNote(null);
                        setFormData((f) => ({ ...f, timezone: zone }));
                      }}
                      aria-describedby={fid("timezone-help")}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleDetectZone}
                    disabled={
                      isDetectingZone ||
                      (formData.lat ?? editVenue.lat) == null ||
                      (formData.lng ?? editVenue.lng) == null
                    }
                    className="shrink-0"
                  >
                    {isDetectingZone ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Globe aria-hidden="true" />}
                    Detect from location
                  </Button>
                </div>
                <div id={fid("timezone-help")} aria-live="polite" className="text-xs text-muted-foreground">
                  {zoneNote ? (
                    <p>{zoneNote}</p>
                  ) : (
                    <p>
                      Deal times are read in this zone. It is set from the pin automatically; near a border the
                      lookup can pick the neighbouring zone, so correct it here if needed.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 border-t pt-3">
            {saveBlockers.length > 0 && (formData.name || formData.address || editVenue) && (
              <ul id={fid("save-blockers")} className="list-disc pl-5 text-sm text-amber-700 dark:text-amber-400" aria-live="polite">
                {saveBlockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={requestClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || saveBlockers.length > 0}
                aria-describedby={saveBlockers.length > 0 ? fid("save-blockers") : undefined}
              >
                {isSaving && <Loader2 className="animate-spin" aria-hidden="true" />}
                {editVenue ? "Save venue" : "Add venue"}
              </Button>
            </div>
          </div>

          {editVenue && (
            <HappyHourManager venueId={editVenue.id} venueName={venueLabel(editVenue)} onDirtyChange={setDealsDirty} />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {editVenue
                ? `You changed ${editVenue.name}${venueDirty && dealsDirty ? " and one of its deals" : dealsDirty ? "'s deals" : ""} without saving. Closing now throws those changes away.`
                : "You started adding a venue. Closing now throws it away."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={closeDialog}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteVenue} onOpenChange={(open) => !open && !deleteVenueMutation.isPending && setDeleteVenue(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteVenue?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{deleteVenue?.name}</strong> at {deleteVenue?.address}
              {deleteVenue?.deal_count != null && deleteVenue.deal_count > 0
                ? `, and its ${plural(deleteVenue.deal_count, "deal")}`
                : ""}
              . It can't be undone. To hide it from the map instead, switch it to inactive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteVenueMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteVenue) deleteVenueMutation.mutate(deleteVenue);
              }}
              disabled={deleteVenueMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteVenueMutation.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Delete venue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isAuthError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Clock, Loader2, Pencil, MapPin, Navigation, Camera, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { VALID_TAGS, DAYS_SHORT } from "@/lib/constants";
import { geocodeAddress, type Coords } from "@/lib/geocode";
import { countryByCode } from "@/lib/countries";
import { suggestVenueMatches } from "@/lib/venue-match";
import type { ApproveDeal, ApproveInput, HappyHour, Submission, SubmissionDeal, Venue } from "@/lib/api-types";

/** Human-readable location line for a submission (street + city + country). */
function locationLabel(sub: Submission): string {
  const country = countryByCode(sub.country);
  return [sub.venue_address, sub.city, country?.name].filter(Boolean).join(", ");
}

/**
 * Geocode query for a submission's address: the street address enriched with
 * the stored city + country. "5 Main St" is ambiguous; "5 Main St, Fremantle,
 * Australia" isn't — and a city with no street address still geocodes to a
 * usable city-centre pin. City/country are never typed at review time; they
 * flow in from the submitter's picks (form) or the Snap-a-Deal fields.
 */
function geocodeQuery(address: string, sub: Submission | null): string {
  return [address.trim(), sub?.city, countryByCode(sub?.country ?? null)?.name]
    .filter(Boolean)
    .join(", ");
}

/** All deals of a submission: deal #1 from its own columns + extra_deals. */
function dealsOf(sub: Submission): SubmissionDeal[] {
  return [
    {
      days_of_week: sub.days_of_week,
      start_time: sub.start_time,
      end_time: sub.end_time,
      description: sub.description,
      tags: sub.tags,
    },
    ...(sub.extra_deals ?? []),
  ];
}

/** A deal the admin can approve: at least one day, times, and a description. */
function dealIsComplete(d: SubmissionDeal): boolean {
  return d.days_of_week.length > 0 && !!d.start_time && !!d.end_time && !!d.description.trim();
}

/** Compact one-line label for an existing happy hour in the replaces dropdown. */
function happyHourLabel(h: HappyHour): string {
  const days = h.days_of_week.map((d) => DAYS_SHORT[d]).join(", ");
  const desc = h.description.length > 45 ? `${h.description.slice(0, 45)}…` : h.description;
  return `${days} ${h.start_time.slice(0, 5)}–${h.end_time.slice(0, 5)} — ${desc}`;
}

/**
 * Rough same-day time-window overlap, used only to WARN the reviewer that an
 * incoming deal probably duplicates/supersedes an existing one. Deliberately
 * ignores midnight-crossing ranges — it's a hint, not a validator.
 */
function dealOverlapsExisting(d: SubmissionDeal, existing: HappyHour): boolean {
  if (!d.days_of_week.some((day) => existing.days_of_week.includes(day))) return false;
  const s1 = d.start_time.slice(0, 5);
  const e1 = d.end_time.slice(0, 5);
  const s2 = existing.start_time.slice(0, 5);
  const e2 = existing.end_time.slice(0, 5);
  return s1 < e2 && s2 < e1;
}

const DAYS = DAYS_SHORT;
const ALLOWED_TAGS = VALID_TAGS;

/**
 * A geocode result whose coordinates are guaranteed present — the only form
 * allowed into component state or the approval flow. (The shared GeocodeResult
 * from "@/lib/geocode" has nullable coords; the null case is handled at the
 * runGeocode / quick-approve boundaries and never travels further.)
 */
type ResolvedGeocode = { coords: Coords; country: string | null };

export default function SubmissionQueue() {
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected">("pending");
  const [editing, setEditing] = useState<Submission | null>(null);
  const [editForm, setEditForm] = useState<Partial<Submission>>({});
  // Deals under edit in the review dialog — one entry per deal, individually
  // editable and removable (a submission can carry several). When attached to
  // an existing venue, each deal may carry replaces_id (supersedes an existing
  // active deal instead of adding a duplicate).
  const [editDeals, setEditDeals] = useState<ApproveDeal[]>([]);
  // Existing venue the reviewer attached this submission to (null = create new).
  const [attachedVenueId, setAttachedVenueId] = useState<string | null>(null);
  // When attached: also apply the name/address fields to the venue row.
  const [updateVenueDetails, setUpdateVenueDetails] = useState(false);
  const [geocodeResult, setGeocodeResult] = useState<ResolvedGeocode | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: submissions = [], isLoading } = useQuery({
    queryKey: ["admin_submissions", filter],
    queryFn: async () => {
      const { submissions } = await api.get<{ submissions: Submission[] }>(
        `/api/admin/submissions?status=${filter}`
      );
      return submissions;
    },
  });

  // Venue list for attach-to-existing matching; shares VenueManager's cache.
  const { data: venues = [] } = useQuery({
    queryKey: ["admin_venues"],
    queryFn: async () => {
      const { venues } = await api.get<{ venues: Venue[] }>("/api/admin/venues");
      return venues;
    },
    enabled: !!editing,
  });

  // Current deals of the attached venue, for the per-deal replace flow.
  const { data: attachedVenueDeals = [] } = useQuery({
    queryKey: ["admin_happy_hours", attachedVenueId],
    queryFn: async () => {
      const { happy_hours } = await api.get<{ happy_hours: HappyHour[] }>(
        `/api/admin/venues/${attachedVenueId}/happy-hours`
      );
      return happy_hours;
    },
    enabled: !!attachedVenueId,
  });
  const attachedVenue = attachedVenueId ? venues.find((v) => v.id === attachedVenueId) ?? null : null;
  const activeVenueDeals = useMemo(
    () => attachedVenueDeals.filter((h) => h.is_active),
    [attachedVenueDeals]
  );

  // Existing venues this submission plausibly matches: photo-flow GPS or the
  // submitter's city-pick coords (proximity), plus name similarity. Attaching
  // avoids creating a duplicate venue on approve.
  const venueCandidates = useMemo(() => {
    if (!editing) return [];
    const coords =
      geocodeResult?.coords ??
      (editing.lat != null && editing.lng != null ? { lat: editing.lat, lng: editing.lng } : null);
    return suggestVenueMatches(editForm.venue_name ?? editing.venue_name, coords, venues);
  }, [editing, editForm.venue_name, geocodeResult, venues]);

  const updateStatus = useMutation({
    mutationFn: async ({
      id,
      status,
      sub,
      updates,
      deals,
      geocode,
      attachVenue,
      applyVenueUpdate,
    }: {
      id: string;
      status: string;
      sub: Submission;
      updates?: Partial<Submission>;
      /** Reviewed deals (edited/removed in the dialog); defaults to the submission's own. */
      deals?: ApproveDeal[];
      geocode?: ResolvedGeocode;
      /** Existing venue to attach to instead of creating a new one. */
      attachVenue?: Venue | null;
      /** With attachVenue: also apply the edited name/address to the venue row. */
      applyVenueUpdate?: boolean;
    }) => {
      if (status === "approved") {
        const merged = {
          venue_name: (updates?.venue_name ?? sub.venue_name) as string,
          venue_address: (updates?.venue_address ?? sub.venue_address ?? "") as string,
        };
        const happyHours: ApproveDeal[] = deals ?? dealsOf(sub);
        if (happyHours.length === 0 || !happyHours.every(dealIsComplete)) {
          throw new Error("Every deal needs at least one day, times, and a description — fix or remove incomplete deals.");
        }
        // Street address is optional now, but venues require a non-empty
        // address — fall back to city (+ country) when no street was given.
        const country = countryByCode(sub.country)?.name;
        const venueAddress =
          merged.venue_address.trim() ||
          [sub.city, country].filter(Boolean).join(", ") ||
          merged.venue_name;

        let body: ApproveInput;
        if (attachVenue) {
          // Attaching to an existing venue: its coordinates already exist, so
          // geocoding is only needed if the reviewer is moving the venue.
          body = {
            venue_id: attachVenue.id,
            happy_hours: happyHours.map((d) => ({ ...d, replaces_id: d.replaces_id ?? null })),
          };
          if (applyVenueUpdate) {
            const lat = geocode?.coords.lat ?? attachVenue.lat;
            const lng = geocode?.coords.lng ?? attachVenue.lng;
            if (lat == null || lng == null) {
              throw new Error("This venue has no coordinates — geocode the address before updating its details.");
            }
            body.venue_update = {
              name: merged.venue_name,
              address: venueAddress,
              country: geocode?.country ?? attachVenue.country,
              lat,
              lng,
            };
          }
        } else {
          if (!geocode) {
            throw new Error("Cannot approve without coordinates — geocode the address or enter them manually first.");
          }
          body = {
            venue: {
              name: merged.venue_name,
              address: venueAddress,
              country: geocode.country ?? sub.country,
              lat: geocode.coords.lat,
              lng: geocode.coords.lng,
            },
            happy_hours: happyHours.map(({ replaces_id: _replaces, ...d }) => d),
          };
        }
        await api.post<{ venue_id: string }>(`/api/admin/submissions/${id}/approve`, body);
      } else if (status === "rejected") {
        await api.post(`/api/admin/submissions/${id}/reject`);
      }
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin_submissions"] });
      queryClient.invalidateQueries({ queryKey: ["admin_venues"] });
      queryClient.invalidateQueries({ queryKey: ["admin_happy_hours"] });
      setEditing(null);
      resetGeocodeState();
      if (variables.status === "approved") {
        const n = (variables.deals ?? dealsOf(variables.sub)).length;
        toast({
          title: "Submission approved",
          description: n > 1 ? `Venue and its ${n} deals are now live.` : "Venue and happy hour are now live.",
        });
      } else {
        toast({ title: "Submission updated" });
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: isAuthError(err)
          ? "Your admin session expired — reload the page to sign in again."
          : err.message,
        variant: "destructive",
      });
    },
  });

  const resetGeocodeState = () => {
    setGeocodeResult(null);
    setGeocodeFailed(false);
    setShowManual(false);
    setManualLat("");
    setManualLng("");
  };

  // Attempt geocoding, automatically showing the manual fallback on failure
  const runGeocode = async (name: string, address: string): Promise<ResolvedGeocode | null> => {
    if (!address.trim()) return null;
    setIsGeocoding(true);
    setGeocodeFailed(false);
    try {
      const { coords, country } = await geocodeAddress(name, address);
      if (coords) {
        const result: ResolvedGeocode = { coords, country };
        setGeocodeResult(result);
        setGeocodeFailed(false);
        setShowManual(false);
        toast({ title: "Coordinates found", description: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` });
        return result;
      } else {
        setGeocodeFailed(true);
        setShowManual(true); // automatically reveal manual entry on failure
        toast({
          title: "Address not found",
          description: "Mapbox couldn't locate this address. Enter coordinates manually below.",
          variant: "destructive",
        });
        return null;
      }
    } catch (err) {
      setGeocodeFailed(true);
      setShowManual(true);
      const isApiError = err instanceof Error && err.message.startsWith("Mapbox error:");
      toast({
        title: isApiError ? "Mapbox configuration error" : "Geocoding failed",
        description: isApiError
          ? `${err.message} — check MAPBOX_ACCESS_TOKEN and GEOCODE_COUNTRY in the Cloudflare Pages settings.`
          : "Network error. Enter coordinates manually below.",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsGeocoding(false);
    }
  };

  // Validate and apply manually entered coordinates
  const applyManualCoords = () => {
    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      toast({
        title: "Invalid coordinates",
        description: "Latitude must be −90 to 90, longitude −180 to 180.",
        variant: "destructive",
      });
      return;
    }
    const result: ResolvedGeocode = { coords: { lat, lng }, country: null };
    setGeocodeResult(result);
    setShowManual(false);
    toast({ title: "Coordinates set", description: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
  };

  const openEditDialog = (sub: Submission) => {
    setEditForm({ ...sub });
    setEditDeals(dealsOf(sub).map((d) => ({ ...d, days_of_week: [...d.days_of_week], tags: d.tags ? [...d.tags] : null, replaces_id: null })));
    resetGeocodeState();
    setAttachedVenueId(null);
    setUpdateVenueDetails(false);
    setEditing(sub);
    // New submissions carry coordinates from the submitter's city pick — seed
    // them directly. Older ones (no coords) fall back to geocoding the address.
    if (sub.lat != null && sub.lng != null) {
      setGeocodeResult({ coords: { lat: sub.lat, lng: sub.lng }, country: sub.country });
    } else {
      runGeocode(sub.venue_name, geocodeQuery(sub.venue_address ?? "", sub));
    }
  };

  const handleGeocode = async () => {
    setGeocodeResult(null);
    setShowManual(false); // hide manual panel while retrying
    await runGeocode(editForm.venue_name ?? "", geocodeQuery(editForm.venue_address ?? "", editing));
  };

  const updateDeal = (idx: number, patch: Partial<ApproveDeal>) => {
    setEditDeals((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const toggleDealDay = (idx: number, day: number) => {
    setEditDeals((prev) =>
      prev.map((d, i) => {
        if (i !== idx) return d;
        const days = d.days_of_week.includes(day)
          ? d.days_of_week.filter((v) => v !== day)
          : [...d.days_of_week, day].sort();
        return { ...d, days_of_week: days };
      })
    );
  };

  const toggleDealTag = (idx: number, tag: string) => {
    setEditDeals((prev) =>
      prev.map((d, i) => {
        if (i !== idx) return d;
        const current = d.tags ?? [];
        return {
          ...d,
          tags: current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
        };
      })
    );
  };

  const removeDeal = (idx: number) => {
    setEditDeals((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <Button
            key={s}
            variant={filter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(s)}
            className="capitalize"
          >
            {s}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : submissions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Clock className="h-8 w-8 mx-auto mb-2" />
          <p>No {filter} submissions</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {submissions.map((sub) => (
            <Card key={sub.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {sub.image_key && (
                      <a
                        href={`/api/admin/submissions/${sub.id}/image`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open photo"
                        className="shrink-0"
                      >
                        <img
                          src={`/api/admin/submissions/${sub.id}/image`}
                          alt="Submitted menu"
                          loading="lazy"
                          className="h-14 w-14 rounded-md border border-border object-cover"
                        />
                      </a>
                    )}
                    <div className="min-w-0">
                      <CardTitle className="text-base flex items-center gap-1.5">
                        <span className="truncate">{sub.venue_name}</span>
                        {sub.source === "photo" && (
                          <Badge variant="outline" className="text-xs gap-1 shrink-0">
                            <Camera className="h-3 w-3" /> photo
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription>{locationLabel(sub)}</CardDescription>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(sub.created_at).toLocaleDateString()}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="divide-y divide-dashed divide-border">
                  {dealsOf(sub).map((deal, i) => (
                    <div key={i} className="space-y-1.5 py-2 first:pt-0 last:pb-0">
                      <p className="text-sm">{deal.description}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {deal.days_of_week.map((d) => (
                          <Badge key={d} variant="secondary" className="text-xs">{DAYS[d]}</Badge>
                        ))}
                        <span className="text-xs text-muted-foreground ml-1">
                          {deal.start_time.slice(0, 5)} – {deal.end_time.slice(0, 5)}
                        </span>
                        {deal.tags?.map((t) => (
                          <Badge key={t} variant="outline" className="text-xs capitalize">{t}</Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {filter === "pending" && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={updateStatus.isPending}
                      onClick={() => openEditDialog(sub)}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Review & Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-1.5"
                      disabled={updateStatus.isPending}
                      onClick={() => updateStatus.mutate({ id: sub.id, status: "rejected", sub })}
                    >
                      <X className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit & Approve Dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review & Approve Submission</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Source photo — the reviewer verifies extracted fields against it. */}
            {editing?.image_key && (
              <a
                href={`/api/admin/submissions/${editing.id}/image`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open full size"
                className="block"
              >
                <img
                  src={`/api/admin/submissions/${editing.id}/image`}
                  alt="Submitted menu"
                  className="max-h-64 w-full rounded-md border border-border object-contain bg-muted/40"
                />
              </a>
            )}

            <div className="space-y-1.5">
              <Label>Venue Name</Label>
              <Input
                value={editForm.venue_name ?? ""}
                onChange={(e) => setEditForm({ ...editForm, venue_name: e.target.value })}
              />
            </div>

            {/* Attach to an existing venue instead of creating a duplicate. */}
            {(venueCandidates.length > 0 || attachedVenueId) && (
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
                <p className="text-xs font-medium flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  Venue
                </p>
                <div className="space-y-1.5">
                  <button
                    type="button"
                    className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                      attachedVenueId === null
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent"
                    }`}
                    onClick={() => {
                      setAttachedVenueId(null);
                      setUpdateVenueDetails(false);
                      setEditDeals((prev) => prev.map((d) => ({ ...d, replaces_id: null })));
                    }}
                  >
                    Create new venue
                  </button>
                  {venueCandidates.map(({ venue, distance_m }) => (
                    <button
                      key={venue.id}
                      type="button"
                      className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                        attachedVenueId === venue.id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-accent"
                      }`}
                      onClick={() => {
                        setAttachedVenueId(venue.id);
                        setEditDeals((prev) => prev.map((d) => ({ ...d, replaces_id: null })));
                      }}
                    >
                      <span className="font-medium">{venue.name}</span>
                      {distance_m != null && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {distance_m < 1000 ? `${Math.round(distance_m)}m away` : `${(distance_m / 1000).toFixed(1)}km away`}
                        </Badge>
                      )}
                      <span className="block text-xs text-muted-foreground truncate">{venue.address}</span>
                    </button>
                  ))}
                </div>
                {attachedVenueId && (
                  <>
                    <label className="flex items-center gap-2 text-xs pt-1">
                      <Checkbox
                        checked={updateVenueDetails}
                        onCheckedChange={(v) => setUpdateVenueDetails(v === true)}
                      />
                      Also update the venue's name/address from the fields in this dialog
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Deals will be added to this venue. No new venue is created
                      {updateVenueDetails ? "" : ", and the name/address fields here stay on the submission record only"}.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Address + Geocode */}
            <div className="space-y-1.5">
              <Label>Address</Label>
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  value={editForm.venue_address ?? ""}
                  onChange={(e) => {
                    setEditForm({ ...editForm, venue_address: e.target.value });
                    setGeocodeResult(null);
                    setGeocodeFailed(false);
                    setShowManual(false);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGeocode}
                  disabled={isGeocoding || !editForm.venue_address?.trim()}
                  className="shrink-0"
                >
                  {isGeocoding ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                  <span className="ml-1 hidden sm:inline">Geocode</span>
                </Button>
              </div>

              {/* Geocode status. Attached venues already have coordinates, so
                  geocoding is only needed when creating a new venue (or moving
                  an attached one via the update-details toggle). */}
              {geocodeResult ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono text-xs">
                    ✓ {geocodeResult.coords.lat.toFixed(5)}, {geocodeResult.coords.lng.toFixed(5)}
                  </Badge>
                  <button
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:no-underline"
                    onClick={() => { setShowManual(true); setGeocodeResult(null); }}
                  >
                    Edit manually
                  </button>
                </div>
              ) : attachedVenueId && (attachedVenue?.lat != null || !updateVenueDetails) ? (
                <p className="text-xs text-muted-foreground">
                  Using the attached venue's existing coordinates.
                </p>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {isGeocoding
                    ? "Searching for address…"
                    : geocodeFailed
                      ? "Address not found — enter coordinates manually below, or edit the address and try again."
                      : "Geocode the address above before approving."}
                </p>
              )}

              {/* Manual coordinate entry — always accessible via toggle or auto-shown on failure */}
              {!showManual && !geocodeResult && !isGeocoding && (
                <button
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:no-underline"
                  onClick={() => setShowManual(true)}
                >
                  Enter coordinates manually instead
                </button>
              )}

              {showManual && !geocodeResult && (
                <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <Navigation className="h-3.5 w-3.5" />
                    Enter coordinates manually
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Search{" "}
                    <a
                      href={`https://www.google.com/maps/search/${encodeURIComponent(
                        `${editForm.venue_name ?? ""} ${geocodeQuery(editForm.venue_address ?? "", editing)}`.trim()
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:no-underline text-primary"
                    >
                      Google Maps
                    </a>
                    {" "}→ right-click the correct pin → "Copy coordinates".
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Latitude</Label>
                      <Input
                        className="h-8 text-sm font-mono"
                        placeholder="-31.95004"
                        value={manualLat}
                        onChange={(e) => setManualLat(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Longitude</Label>
                      <Input
                        className="h-8 text-sm font-mono"
                        placeholder="115.86056"
                        value={manualLng}
                        onChange={(e) => setManualLng(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={!manualLat || !manualLng}
                      onClick={applyManualCoords}
                    >
                      Set coordinates
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowManual(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Deals — a submission can carry several; each is editable and
                individually removable so one bad deal doesn't sink the rest. */}
            <div className="space-y-3">
              {editDeals.length > 1 && <Label>Deals ({editDeals.length})</Label>}
              {editDeals.map((deal, idx) => (
                <div key={idx} className="rounded-lg border border-border p-3 space-y-3">
                  {editDeals.length > 1 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Deal {idx + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={() => removeDeal(idx)}
                      >
                        <X className="h-3.5 w-3.5 mr-1" /> Remove
                      </Button>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <Textarea
                      value={deal.description}
                      onChange={(e) => updateDeal(idx, { description: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Start Time</Label>
                      <Input
                        type="time"
                        value={deal.start_time.slice(0, 5)}
                        onChange={(e) => updateDeal(idx, { start_time: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>End Time</Label>
                      <Input
                        type="time"
                        value={deal.end_time.slice(0, 5)}
                        onChange={(e) => updateDeal(idx, { end_time: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Days</Label>
                    <div className="flex flex-wrap gap-2">
                      {DAYS.map((day, i) => (
                        <label key={i} className="flex items-center gap-1.5 text-sm">
                          <Checkbox
                            checked={deal.days_of_week.includes(i)}
                            onCheckedChange={() => toggleDealDay(idx, i)}
                          />
                          {day}
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* Attached to an existing venue: an incoming deal can supersede
                      one of the venue's current deals instead of piling up. */}
                  {attachedVenueId && activeVenueDeals.length > 0 && (
                    <div className="space-y-1.5">
                      <Label>Replaces existing deal</Label>
                      <select
                        className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={deal.replaces_id ?? ""}
                        onChange={(e) => updateDeal(idx, { replaces_id: e.target.value || null })}
                      >
                        <option value="">None — add as a new deal</option>
                        {activeVenueDeals.map((h) => (
                          <option
                            key={h.id}
                            value={h.id}
                            disabled={editDeals.some((d, i) => i !== idx && d.replaces_id === h.id)}
                          >
                            {happyHourLabel(h)}
                          </option>
                        ))}
                      </select>
                      {!deal.replaces_id && activeVenueDeals.some((h) => dealOverlapsExisting(deal, h)) && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          This overlaps one of the venue's existing deals — pick it under
                          "Replaces" if this is a correction, to avoid duplicates.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>Tags</Label>
                    <div className="flex flex-wrap gap-2">
                      {ALLOWED_TAGS.map((tag) => (
                        <label
                          key={tag}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-colors capitalize ${
                            (deal.tags ?? []).includes(tag)
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-card border-border hover:bg-accent"
                          }`}
                        >
                          <Checkbox
                            className="sr-only"
                            checked={(deal.tags ?? []).includes(tag)}
                            onCheckedChange={() => toggleDealTag(idx, tag)}
                          />
                          {tag}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={(() => {
                // Attached venues bring their own coordinates; geocoding is
                // only a blocker when creating a new venue, or when moving an
                // attached venue that has no stored coords.
                const needsCoords = attachedVenueId
                  ? updateVenueDetails && attachedVenue?.lat == null && !geocodeResult
                  : !geocodeResult || isGeocoding;
                return (
                  updateStatus.isPending ||
                  needsCoords ||
                  editDeals.length === 0 ||
                  !editDeals.every(dealIsComplete)
                );
              })()}
              title={
                !editDeals.every(dealIsComplete)
                  ? "Every deal needs at least one day, times, and a description"
                  : !attachedVenueId && !geocodeResult
                    ? "Set coordinates first (geocode or enter manually)"
                    : undefined
              }
              onClick={() => {
                if (!editing) return;
                updateStatus.mutate({
                  id: editing.id,
                  status: "approved",
                  sub: editing,
                  updates: editForm,
                  deals: editDeals,
                  geocode: geocodeResult ?? undefined,
                  attachVenue: attachedVenue,
                  applyVenueUpdate: updateVenueDetails,
                });
              }}
            >
              {(updateStatus.isPending || isGeocoding) && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save & Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

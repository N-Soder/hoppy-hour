import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building2, Camera, Check, ChevronDown, Loader2, MapPin, Navigation, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { VALID_TAGS, WEEK_DAYS } from "@/lib/constants";
import { countryByCode } from "@/lib/countries";
import { formatDistance, plural } from "@/lib/format";
import { geocodeAddress } from "@/lib/geocode";
import { suggestVenueMatches } from "@/lib/venue-match";
import {
  approveBlockers, checkCoordInputs, cityUnrecognised, dealSummary, dealsOf, describePin, endsNextDay,
  formatShortDate, geocodeQuery, initialPin, isConfirmedPin, lookupPinSource, readableError, splitCoordPair,
  type CoordInputs, type ReviewPin,
} from "@/lib/admin";
import type { ApproveDeal, ApproveInput, ApproveLocationSource, HappyHour, Submission, Venue } from "@/lib/api-types";
import { SubmissionDealList } from "./SubmissionDeals";

/** Matches a CSS media query, updating on change. */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener?.("change", onChange);
      return () => mql.removeEventListener?.("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}

const imageUrl = (sub: Submission) => `/api/admin/submissions/${sub.id}/image`;

/** The submission exactly as it arrived. Read-only; the reviewer compares the edits against it. */
function OriginalSubmission({ sub }: { sub: Submission }) {
  const country = countryByCode(sub.country);
  return (
    <div className="space-y-4 text-sm">
      {sub.image_key && (
        <a href={imageUrl(sub)} target="_blank" rel="noopener noreferrer" className="block">
          <img
            src={imageUrl(sub)}
            alt={`Photo submitted for ${sub.venue_name} (opens full size in a new tab)`}
            className="max-h-80 w-full rounded-md border border-border bg-muted/40 object-contain"
          />
        </a>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-muted-foreground">Venue</dt>
        <dd className="font-medium break-words">{sub.venue_name}</dd>
        <dt className="text-muted-foreground">Address</dt>
        <dd className="break-words">{sub.venue_address?.trim() || <span className="text-muted-foreground">Not given</span>}</dd>
        <dt className="text-muted-foreground">City</dt>
        <dd className="break-words">{sub.city || <span className="text-muted-foreground">Not given</span>}</dd>
        <dt className="text-muted-foreground">Country</dt>
        <dd>{country?.name ?? sub.country ?? <span className="text-muted-foreground">Not given</span>}</dd>
        <dt className="text-muted-foreground">Location</dt>
        <dd className="font-mono text-xs leading-5">
          {sub.lat != null && sub.lng != null ? (
            `${sub.lat.toFixed(5)}, ${sub.lng.toFixed(5)}`
          ) : (
            <span className="font-sans text-sm text-muted-foreground">
              {sub.source === "form" ? "None (city not recognised)" : "None"}
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd className="flex items-center gap-1.5">
          {sub.source === "photo" ? (
            <>
              <Camera className="h-3.5 w-3.5" aria-hidden="true" /> Snap a deal photo
            </>
          ) : (
            "Public form"
          )}
        </dd>
        <dt className="text-muted-foreground">Submitted</dt>
        <dd>{formatShortDate(sub.created_at)}</dd>
      </dl>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {plural(dealsOf(sub).length, "deal")}
        </h3>
        <SubmissionDealList deals={dealsOf(sub)} />
      </div>
    </div>
  );
}

/** Compact label for an existing deal in the "Replaces" select. */
function happyHourLabel(h: HappyHour): string {
  const desc = h.description.length > 45 ? `${h.description.slice(0, 45)}…` : h.description;
  return `${dealSummary(h)} — ${desc}`;
}

/** Same-day overlap hint (ignores midnight wrap; it's a warning, not a validator). */
function dealOverlapsExisting(d: ApproveDeal, existing: HappyHour): boolean {
  if (!d.days_of_week.some((day) => existing.days_of_week.includes(day))) return false;
  const s1 = d.start_time.slice(0, 5);
  const e1 = d.end_time.slice(0, 5);
  const s2 = existing.start_time.slice(0, 5);
  const e2 = existing.end_time.slice(0, 5);
  return s1 < e2 && s2 < e1;
}

function cloneDeals(sub: Submission): ApproveDeal[] {
  return dealsOf(sub).map((d) => ({
    ...d,
    start_time: d.start_time.slice(0, 5),
    end_time: d.end_time.slice(0, 5),
    days_of_week: [...d.days_of_week],
    tags: d.tags ? [...d.tags] : [],
    replaces_id: null,
  }));
}

interface Props {
  submission: Submission;
  /** Close the dialog (after approve, cancel, or a confirmed discard). */
  onClose: () => void;
  /** Reject from inside the dialog; the parent closes it and offers Undo. */
  onReject: (sub: Submission) => void;
  /** Element to focus once the dialog has closed (the card that opened it, or the list). */
  focusAfterClose: () => HTMLElement | null;
}

export default function ReviewDialog({ submission: sub, onClose, onReject, focusAfterClose }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const wide = useMediaQuery("(min-width: 820px)");
  const ids = useId();
  const fid = (name: string) => `${ids}-${name}`;

  const initial = useMemo(
    () => ({ name: sub.venue_name, address: sub.venue_address ?? "", deals: cloneDeals(sub) }),
    [sub],
  );
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address);
  const [deals, setDeals] = useState<ApproveDeal[]>(initial.deals);
  // Existing venue the reviewer attached this submission to (null = create new).
  const [attachedVenueId, setAttachedVenueId] = useState<string | null>(null);
  // When attached: also apply the name/address/location to the venue row.
  const [updateVenueDetails, setUpdateVenueDetails] = useState(false);
  const [pin, setPin] = useState<ReviewPin | null>(() => initialPin(sub));
  const [geocoding, setGeocoding] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState<CoordInputs>({ lat: "", lng: "" });
  const [manualTouched, setManualTouched] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [originalOpen, setOriginalOpen] = useState(false);

  const { data: venues = [] } = useQuery({
    queryKey: ["admin_venues"],
    queryFn: async () => (await api.get<{ venues: Venue[] }>("/api/admin/venues")).venues,
  });
  const { data: attachedVenueDeals = [] } = useQuery({
    queryKey: ["admin_happy_hours", attachedVenueId],
    queryFn: async () =>
      (await api.get<{ happy_hours: HappyHour[] }>(`/api/admin/venues/${attachedVenueId}/happy-hours`)).happy_hours,
    enabled: !!attachedVenueId,
  });
  const attachedVenue = attachedVenueId ? venues.find((v) => v.id === attachedVenueId) ?? null : null;
  const activeVenueDeals = useMemo(() => attachedVenueDeals.filter((h) => h.is_active), [attachedVenueDeals]);

  // Existing venues this submission plausibly matches. Proximity only counts
  // for a pin that marks the venue itself: every venue in town is "near" a
  // city-centre pin, so those match on name alone.
  const pinIsExact = !!pin && describePin(pin.source).exact;
  const venueCandidates = useMemo(() => {
    const all = suggestVenueMatches(name || sub.venue_name, pin?.coords ?? null, venues, 20);
    // 0.45 = venue-match's name threshold.
    return (pinIsExact ? all : all.filter((m) => m.name_score >= 0.45)).slice(0, 5);
  }, [name, sub.venue_name, pin, pinIsExact, venues]);

  const dirty =
    name !== initial.name ||
    address !== initial.address ||
    JSON.stringify(deals) !== JSON.stringify(initial.deals) ||
    attachedVenueId !== null ||
    updateVenueDetails ||
    pin?.source === "manual" ||
    pin?.source === "address" ||
    manual.lat.trim() !== "" ||
    manual.lng.trim() !== "";

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  // ── Location ──────────────────────────────────────────────────────────────
  // Only a street address is looked up. A city on its own can only give a
  // city-centre pin, which can't be approved; and an unrecognised typed city
  // makes Mapbox answer with a fuzzy match somewhere else entirely.
  const unrecognisedCity = cityUnrecognised(sub);
  const lookUp = async (addr: string) => {
    if (!addr.trim()) {
      setLookupMessage("Add a street address to look up, or enter coordinates by hand.");
      setShowManual(true);
      return;
    }
    const query = geocodeQuery(addr, sub);
    setGeocoding(true);
    setLookupMessage(null);
    try {
      const { coords, country, placeType, placeName, relevance } = await geocodeAddress(name || sub.venue_name, query, sub.country);
      if (coords) {
        if (lookupPinSource(placeType, relevance) === "area") {
          // Mapbox's fuzzy fallback (a town, or a different street): never
          // shown as a pin, so it can't pass for the venue or the city centre.
          setLookupMessage(
            `No exact match for that address${placeName ? ` (the nearest guess was “${placeName}”)` : ""}, so no pin was set. Check the address, or enter the venue's coordinates by hand.`,
          );
          setShowManual(true);
        } else {
          setPin({ coords, country: country ?? sub.country, source: "address", matched: placeName });
          setShowManual(false);
        }
      } else {
        setLookupMessage("Couldn't find that address. Check the spelling, or enter coordinates by hand.");
        setShowManual(true);
      }
    } catch (err) {
      const mapbox = err instanceof Error && err.message.startsWith("Mapbox error:");
      setLookupMessage(
        mapbox
          ? `The address lookup is not working (${(err as Error).message}). Check MAPBOX_ACCESS_TOKEN in the Cloudflare Pages settings, or enter coordinates by hand.`
          : "The address lookup failed (network). Try again, or enter coordinates by hand.",
      );
      setShowManual(true);
    } finally {
      setGeocoding(false);
    }
  };

  // A submission without coordinates but with a street address: try the
  // address once when the dialog opens. Never the city on its own (see lookUp).
  useEffect(() => {
    if (!initialPin(sub) && sub.venue_address?.trim()) void lookUp(sub.venue_address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening the coordinate fields for a photo's pin starts them at that pin,
  // so a reviewer who knows the photo was taken at the venue confirms it in
  // one step. A city-centre pin is never pre-filled.
  const openManual = () => {
    if (pin?.source === "upload" && !manual.lat && !manual.lng) {
      setManual({ lat: String(pin.coords.lat), lng: String(pin.coords.lng) });
    }
    setShowManual(true);
  };

  const manualCheck = checkCoordInputs(manual);
  const setManualField = (field: keyof CoordInputs, value: string) => {
    const pair = splitCoordPair(value);
    if (pair) setManual(pair);
    else setManual((m) => ({ ...m, [field]: value }));
  };
  const applyManual = () => {
    setManualTouched(true);
    if (!manualCheck.coords) return;
    setPin({ coords: manualCheck.coords, country: sub.country, source: "manual" });
    setShowManual(false);
    setLookupMessage(null);
  };

  // ── Deals ─────────────────────────────────────────────────────────────────
  const updateDeal = (idx: number, patch: Partial<ApproveDeal>) =>
    setDeals((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  const toggleDay = (idx: number, day: number) =>
    setDeals((prev) =>
      prev.map((d, i) =>
        i !== idx
          ? d
          : {
              ...d,
              days_of_week: d.days_of_week.includes(day)
                ? d.days_of_week.filter((v) => v !== day)
                : [...d.days_of_week, day].sort((a, b) => a - b),
            },
      ),
    );
  const toggleTag = (idx: number, tag: string) =>
    setDeals((prev) =>
      prev.map((d, i) => {
        if (i !== idx) return d;
        const tags = d.tags ?? [];
        return { ...d, tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag] };
      }),
    );
  const removeDeal = (idx: number) => setDeals((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  // ── Approve ───────────────────────────────────────────────────────────────
  const blockers = approveBlockers({
    venueName: name,
    deals,
    attached: !!attachedVenueId,
    updateAttachedDetails: updateVenueDetails,
    attachedHasCoords: attachedVenue?.lat != null && attachedVenue?.lng != null,
    pin: pin?.source ?? null,
    geocoding,
  });

  const approve = useMutation({
    mutationFn: async () => {
      const countryName = countryByCode(sub.country)?.name;
      // Venues need a non-empty address: fall back to city (+ country).
      const venueAddress = address.trim() || [sub.city, countryName].filter(Boolean).join(", ") || name.trim();
      const happyHours = deals.map((d) => ({ ...d, description: d.description.trim() }));
      // Only a confirmed pin (looked-up street address or typed coordinates)
      // places a venue; the server enforces the same rule.
      const confirmed = pin && isConfirmedPin(pin.source) ? pin : null;
      const confirmedSource = confirmed?.source as ApproveLocationSource | undefined;
      let body: ApproveInput;
      if (attachedVenue) {
        body = { venue_id: attachedVenue.id, happy_hours: happyHours.map((d) => ({ ...d, replaces_id: d.replaces_id ?? null })) };
        if (updateVenueDetails) {
          if (confirmed && confirmedSource) {
            body.venue_update = {
              name: name.trim(), address: venueAddress, country: confirmed.country ?? attachedVenue.country,
              lat: confirmed.coords.lat, lng: confirmed.coords.lng, location_source: confirmedSource,
            };
          } else if (attachedVenue.lat != null && attachedVenue.lng != null) {
            body.venue_update = {
              name: name.trim(), address: venueAddress, country: attachedVenue.country,
              lat: attachedVenue.lat, lng: attachedVenue.lng, location_source: "venue",
            };
          } else {
            throw new Error("The venue has no location yet. Look up a street address or enter coordinates.");
          }
        }
      } else {
        if (!confirmed || !confirmedSource) {
          throw new Error("A street address must be looked up, or coordinates entered, before approving.");
        }
        body = {
          venue: {
            name: name.trim(), address: venueAddress, country: confirmed.country ?? sub.country,
            lat: confirmed.coords.lat, lng: confirmed.coords.lng, location_source: confirmedSource,
          },
          happy_hours: happyHours.map(({ replaces_id: _r, ...d }) => d),
        };
      }
      await api.post<{ venue_id: string }>(`/api/admin/submissions/${sub.id}/approve`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_submissions"] });
      queryClient.invalidateQueries({ queryKey: ["admin_venues"] });
      queryClient.invalidateQueries({ queryKey: ["admin_happy_hours"] });
      toast({
        title: "Approved",
        description: attachedVenue
          ? `${plural(deals.length, "deal")} added to ${attachedVenue.name}.`
          : `${name.trim()} is now on the map with ${plural(deals.length, "deal")}.`,
      });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        queryClient.invalidateQueries({ queryKey: ["admin_submissions"] });
      }
      toast({ title: "Couldn't approve", description: readableError(err), variant: "destructive" });
    },
  });

  const pinInfo = pin ? describePin(pin.source) : null;
  const manualLatErr = manualTouched || manual.lat ? manualCheck.latError : null;
  const manualLngErr = manualTouched || manual.lng ? manualCheck.lngError : null;
  const usingAttachedCoords = !!attachedVenueId && !updateVenueDetails;

  const editor = (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor={fid("name")}>
          Venue name <span aria-hidden="true" className="text-destructive-text">*</span>
        </Label>
        <Input
          id={fid("name")}
          required
          aria-required="true"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!name.trim() || undefined}
        />
      </div>

      {/* Attach to an existing venue instead of creating a duplicate. */}
      {(venueCandidates.length > 0 || attachedVenueId) && (
        <fieldset className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
          <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" /> Add to a venue
          </legend>
          <p className="text-xs text-muted-foreground">
            Similar venues are already listed. Add the deals to one of them to avoid a duplicate.
          </p>
          <div className="space-y-1.5">
            <button
              type="button"
              aria-pressed={attachedVenueId === null}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                attachedVenueId === null ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
              }`}
              onClick={() => {
                setAttachedVenueId(null);
                setUpdateVenueDetails(false);
                setDeals((prev) => prev.map((d) => ({ ...d, replaces_id: null })));
              }}
            >
              Create a new venue
            </button>
            {venueCandidates.map(({ venue, distance_m }) => (
              <button
                key={venue.id}
                type="button"
                aria-pressed={attachedVenueId === venue.id}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  attachedVenueId === venue.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
                }`}
                onClick={() => {
                  setAttachedVenueId(venue.id);
                  setDeals((prev) => prev.map((d) => ({ ...d, replaces_id: null })));
                }}
              >
                <span className="font-medium">Add to {venue.name}</span>
                {distance_m != null && (
                  <Badge variant="secondary" className="ml-2 text-xs font-normal">
                    {formatDistance(distance_m)}{" "}
                    {pin?.source === "city"
                      ? "from the city centre"
                      : pin && !describePin(pin.source).exact
                        ? "from the approximate pin"
                        : "away"}
                  </Badge>
                )}
                <span className="block truncate text-xs text-muted-foreground">{venue.address}</span>
              </button>
            ))}
          </div>
          {attachedVenueId && (
            <div className="space-y-1 pt-1">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={updateVenueDetails}
                  onCheckedChange={(v) => setUpdateVenueDetails(v === true)}
                />
                Also replace the venue's name, address and location with the ones in this form
              </label>
              <p className="text-xs text-muted-foreground">
                The deals are added to this venue; no new venue is created.
              </p>
            </div>
          )}
        </fieldset>
      )}

      {/* Address + location */}
      <div className="space-y-2">
        <Label htmlFor={fid("address")}>Street address</Label>
        <div className="flex gap-2">
          <Input
            id={fid("address")}
            className="flex-1"
            value={address}
            placeholder="Optional"
            aria-describedby={fid("address-hint")}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => lookUp(address)}
            disabled={geocoding || !address.trim()}
            className="shrink-0"
          >
            {geocoding ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MapPin aria-hidden="true" />}
            Look up
          </Button>
        </div>
        <p id={fid("address-hint")} className="text-xs text-muted-foreground">
          {sub.city || sub.country
            ? `Searched within ${[sub.city, countryByCode(sub.country)?.name].filter(Boolean).join(", ")}.`
            : "No city or country was given."}
          {" "}Approving needs the street address looked up, or coordinates entered.
        </p>

        <div aria-live="polite" className="space-y-2">
          {usingAttachedCoords ? (
            <p className="text-sm text-muted-foreground">Using {attachedVenue?.name ?? "the venue"}'s existing location.</p>
          ) : geocoding ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Looking up the location…
            </p>
          ) : pin && pinInfo ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span
                className={`inline-flex items-center gap-1.5 font-medium ${
                  pinInfo.exact ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"
                }`}
              >
                {pinInfo.exact ? <Check className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                {pinInfo.label}
              </span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${pin.coords.lat},${pin.coords.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-primary underline underline-offset-2 hover:no-underline"
              >
                {pin.coords.lat.toFixed(5)}, {pin.coords.lng.toFixed(5)}
                <span className="sr-only"> (open in Google Maps, new tab)</span>
              </a>
              {!showManual && (
                <button
                  type="button"
                  className="touch-target text-xs text-muted-foreground underline underline-offset-2 hover:no-underline"
                  onClick={openManual}
                >
                  Enter coordinates by hand
                </button>
              )}
              {pin.matched && pin.source === "address" && (
                <p className="basis-full text-xs text-muted-foreground">Matched: {pin.matched}</p>
              )}
              {!pinInfo.exact && (
                <p className="basis-full text-xs text-muted-foreground">
                  {pin.source === "upload"
                    ? "This is where the photo was uploaded from, or the picked city's centre. If the photo was taken at the venue, open the coordinates and use them."
                    : "The pin is only the centre of the city, not the venue."}{" "}
                  {address.trim()
                    ? "Look up the street address, or enter the venue's coordinates, before approving."
                    : "Add a street address and look it up, or enter the venue's coordinates, before approving."}
                </p>
              )}
            </div>
          ) : unrecognisedCity ? (
            <div className="text-sm text-amber-700 dark:text-amber-400">
              <p className="flex items-start gap-1.5 font-medium">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                City not recognised — set the location
              </p>
              <p className="mt-0.5 pl-[1.375rem] text-xs text-muted-foreground">
                {lookupMessage ??
                  `“${sub.city ?? "The typed city"}” wasn't found by the city search, so this submission has no pin. Add the street address and look it up, or enter the venue's coordinates by hand.`}
              </p>
            </div>
          ) : (
            <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {lookupMessage ??
                (sub.lat == null
                  ? "This submission arrived without a location. Look up the street address or enter coordinates by hand."
                  : "No location set. Look up the street address or enter coordinates by hand.")}
            </p>
          )}
          {pin && lookupMessage && !geocoding && !usingAttachedCoords && (
            <p className="text-xs text-amber-700 dark:text-amber-400">{lookupMessage}</p>
          )}
        </div>

        {!usingAttachedCoords && !showManual && !pin && !geocoding && (
          <button
            type="button"
            className="touch-target text-sm text-primary underline underline-offset-2 hover:no-underline"
            onClick={openManual}
          >
            Enter coordinates by hand
          </button>
        )}

        {showManual && !usingAttachedCoords && (
          <fieldset className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
            <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
              <Navigation className="h-3.5 w-3.5" aria-hidden="true" /> Coordinates
            </legend>
            <p className="text-xs text-muted-foreground">
              In{" "}
              <a
                href={`https://www.google.com/maps/search/${encodeURIComponent(`${name} ${geocodeQuery(address, sub)}`.trim())}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:no-underline"
              >
                Google Maps<span className="sr-only"> (new tab)</span>
              </a>
              , right-click the venue and copy its coordinates, then paste them into either field.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor={fid("lat")} className="text-xs">Latitude</Label>
                <Input
                  id={fid("lat")}
                  inputMode="decimal"
                  className="font-mono"
                  placeholder="-31.95004"
                  value={manual.lat}
                  aria-invalid={!!manualLatErr || undefined}
                  aria-describedby={manualLatErr ? fid("lat-err") : undefined}
                  onChange={(e) => setManualField("lat", e.target.value)}
                  onBlur={() => manual.lat && setManualTouched(true)}
                />
                {manualLatErr && <p id={fid("lat-err")} className="text-xs text-destructive-text">{manualLatErr}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor={fid("lng")} className="text-xs">Longitude</Label>
                <Input
                  id={fid("lng")}
                  inputMode="decimal"
                  className="font-mono"
                  placeholder="115.86056"
                  value={manual.lng}
                  aria-invalid={!!manualLngErr || undefined}
                  aria-describedby={manualLngErr ? fid("lng-err") : undefined}
                  onChange={(e) => setManualField("lng", e.target.value)}
                  onBlur={() => manual.lng && setManualTouched(true)}
                />
                {manualLngErr && <p id={fid("lng-err")} className="text-xs text-destructive-text">{manualLngErr}</p>}
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={!manualCheck.coords} onClick={applyManual}>
                Use these coordinates
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowManual(false)}>
                Cancel
              </Button>
            </div>
          </fieldset>
        )}
      </div>

      {/* Deals */}
      <div className="space-y-3">
        {deals.map((deal, idx) => {
          const overnight = endsNextDay(deal.start_time, deal.end_time);
          return (
            <fieldset
              key={idx}
              aria-labelledby={fid(`deal-${idx}`)}
              className="space-y-3 rounded-lg border border-border p-3"
            >
              <div className="flex min-h-9 items-center justify-between gap-2">
                <h3 id={fid(`deal-${idx}`)} className="text-sm font-semibold">
                  {deals.length > 1 ? `Deal ${idx + 1}` : "Deal"}
                </h3>
                {deals.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive-text hover:text-destructive-text"
                    onClick={() => removeDeal(idx)}
                    aria-label={`Remove deal ${idx + 1} (${dealSummary(deal)})`}
                  >
                    <X aria-hidden="true" /> Remove
                  </Button>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={fid(`desc-${idx}`)}>
                  Description <span aria-hidden="true" className="text-destructive-text">*</span>
                </Label>
                <Textarea
                  id={fid(`desc-${idx}`)}
                  required
                  aria-required="true"
                  value={deal.description}
                  onChange={(e) => updateDeal(idx, { description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={fid(`start-${idx}`)}>
                    Starts <span aria-hidden="true" className="text-destructive-text">*</span>
                  </Label>
                  <Input
                    id={fid(`start-${idx}`)}
                    type="time"
                    required
                    value={deal.start_time.slice(0, 5)}
                    onChange={(e) => updateDeal(idx, { start_time: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={fid(`end-${idx}`)}>
                    Ends <span aria-hidden="true" className="text-destructive-text">*</span>
                  </Label>
                  <Input
                    id={fid(`end-${idx}`)}
                    type="time"
                    required
                    value={deal.end_time.slice(0, 5)}
                    aria-describedby={fid(`when-${idx}`)}
                    onChange={(e) => updateDeal(idx, { end_time: e.target.value })}
                  />
                </div>
              </div>
              <p id={fid(`when-${idx}`)} className="text-xs text-muted-foreground" aria-live="polite">
                {dealSummary(deal).replace(", ends next day", "")}
                {overnight && <span className="ml-1 font-medium text-foreground">· ends next day</span>}
              </p>
              <div role="group" aria-labelledby={fid(`days-${idx}`)} className="space-y-1.5">
                <p id={fid(`days-${idx}`)} className="text-sm font-medium">
                  Days <span aria-hidden="true" className="text-destructive-text">*</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {WEEK_DAYS.map((d) => (
                    <Chip
                      key={d.value}
                      size="sm"
                      selected={deal.days_of_week.includes(d.value)}
                      onClick={() => toggleDay(idx, d.value)}
                      aria-label={d.long}
                    >
                      {d.short}
                    </Chip>
                  ))}
                </div>
              </div>
              {attachedVenueId && activeVenueDeals.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor={fid(`replaces-${idx}`)}>Replaces an existing deal</Label>
                  <select
                    id={fid(`replaces-${idx}`)}
                    className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={deal.replaces_id ?? ""}
                    onChange={(e) => updateDeal(idx, { replaces_id: e.target.value || null })}
                  >
                    <option value="">None: add as a new deal</option>
                    {activeVenueDeals.map((h) => (
                      <option key={h.id} value={h.id} disabled={deals.some((d, i) => i !== idx && d.replaces_id === h.id)}>
                        {happyHourLabel(h)}
                      </option>
                    ))}
                  </select>
                  {!deal.replaces_id && activeVenueDeals.some((h) => dealOverlapsExisting(deal, h)) && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      This overlaps one of the venue's deals. If it's a correction, choose that deal above so it is
                      replaced rather than duplicated.
                    </p>
                  )}
                </div>
              )}
              <div role="group" aria-labelledby={fid(`tags-${idx}`)} className="space-y-1.5">
                <p id={fid(`tags-${idx}`)} className="text-sm font-medium">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {VALID_TAGS.map((tag) => (
                    <Chip
                      key={tag}
                      size="sm"
                      className="capitalize"
                      selected={(deal.tags ?? []).includes(tag)}
                      onClick={() => toggleTag(idx, tag)}
                    >
                      {tag}
                    </Chip>
                  ))}
                </div>
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogContent
          className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100vw-2rem)]"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            focusAfterClose()?.focus();
          }}
        >
          <DialogHeader className="border-b border-border px-4 pb-3 pt-4 pr-14 text-left sm:px-6">
            <DialogTitle>Review submission</DialogTitle>
            <DialogDescription>
              {sub.venue_name} · submitted {formatShortDate(sub.created_at)}
              {sub.source === "photo" ? " from a photo" : " through the public form"}
            </DialogDescription>
          </DialogHeader>

          {wide ? (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <section aria-labelledby={fid("orig")} className="overflow-y-auto border-r border-border bg-muted/30 px-6 py-4">
                <h2 id={fid("orig")} className="mb-3 text-sm font-semibold">Original submission</h2>
                <OriginalSubmission sub={sub} />
              </section>
              <section aria-labelledby={fid("edit")} className="overflow-y-auto px-6 py-4">
                <h2 id={fid("edit")} className="mb-3 text-sm font-semibold">What will be published</h2>
                {editor}
              </section>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <details
                className="mb-4 rounded-md border border-border bg-muted/30"
                open={originalOpen}
                onToggle={(e) => setOriginalOpen((e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-semibold">
                  Original submission
                  <ChevronDown className={`h-4 w-4 transition-transform ${originalOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </summary>
                <div className="border-t border-border px-3 py-3">
                  <OriginalSubmission sub={sub} />
                </div>
              </details>
              {editor}
            </div>
          )}

          <div className="border-t border-border bg-background px-4 py-3 sm:px-6">
            {blockers.length > 0 && (
              <div id={fid("blockers")} className="mb-2 text-sm text-amber-700 dark:text-amber-400" aria-live="polite">
                <p className="font-medium">Before you can approve:</p>
                <ul className="list-disc pl-5">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" onClick={requestClose} className="mr-auto">
                Cancel
              </Button>
              <Button
                variant="outline"
                className="border-destructive/50 text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                disabled={approve.isPending}
                onClick={() => onReject(sub)}
              >
                <X aria-hidden="true" /> Reject
              </Button>
              <Button
                disabled={approve.isPending || blockers.length > 0}
                aria-describedby={blockers.length > 0 ? fid("blockers") : undefined}
                onClick={() => approve.mutate()}
              >
                {approve.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                Save &amp; approve
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your edits?</AlertDialogTitle>
            <AlertDialogDescription>
              You changed this submission for {sub.venue_name}. Closing now throws those edits away; the submission
              stays pending.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmDiscard(false);
                onClose();
              }}
            >
              Discard edits
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

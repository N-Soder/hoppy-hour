import { useState, useEffect, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Clock,
  Send,
  CheckCircle,
  AlertCircle,
  Pencil,
  Plus,
  Trash2,
  History,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { inferTagsFromDescription } from "@/lib/auto-tag";
import { VALID_TAGS } from "@/lib/constants";
import { MAX_DEALS_PER_SUBMISSION } from "@/lib/api-types";
import {
  DEAL_PRESETS,
  TIME_OPTIONS,
  bumpedEnd,
  formatMinutes,
  minutesToClock,
  CUSTOM_DEFAULT_START,
  CUSTOM_DEFAULT_END,
  type DealPreset,
} from "@/lib/deal-time";
import { CountryPicker } from "@/components/submit/CountryPicker";
import { CitySearch } from "@/components/submit/CitySearch";
import { useLocationPrefill } from "@/hooks/use-location-prefill";
import { computeLocationPrefill } from "@/lib/location-prefill";
import type { CityResult } from "@/lib/city-search";
import {
  DRAFT_SAVE_DEBOUNCE_MS,
  DRAFT_VERSION,
  clearDraft,
  describeDraft,
  formatSavedAt,
  loadDraft,
  saveDraft,
  type DealDraft,
  type SubmissionDraft,
} from "@/lib/submission-draft";

// Day chips render Monday-first (week starts Monday). `value` is the stored
// day index (0=Sun…6=Sat) — the display order changes, the data model does not.
const DAY_ORDER = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];
const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const TAGS = VALID_TAGS;

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          "timeout-callback"?: () => void;
          /** "execute" holds the challenge back until execute() is called. */
          execution?: "render" | "execute";
          /** "interaction-only" keeps the widget invisible unless it challenges. */
          appearance?: "always" | "execute" | "interaction-only";
        }
      ) => string;
      execute: (id: string) => void;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

// How long a submit waits for the deferred api.js to show up before giving up,
// and how long the challenge itself may take. Both end in a retryable error
// rather than a permanently disabled button.
const WIDGET_READY_TIMEOUT_MS = 5000;
const CHECK_TIMEOUT_MS = 30000;

const CHECK_FAILED_MESSAGE =
  "We couldn't run the security check. Your deals are safe — give it another go.";

// start_time/end_time are 'HH:MM' clock strings produced by the deal-hours
// picker. They are required (min length 1) so an untouched picker fails
// validation — i.e. a time chip must have been tapped before submit. No
// end > start check: the picker guarantees a valid range, and late-night deals
// are stored as start > end (e.g. 22:00 → 01:00), the app's midnight-crossing
// convention (see src/hooks/use-venues.ts, functions/_shared/validate.ts).
const submissionSchema = z.object({
  venue_name: z.string().trim().min(1, "Venue name is required").max(200),
  // Location: country + city are required and picked from lists (city carries
  // coordinates for the map). The street address is optional free text.
  country: z.string().min(2, "Select a country"),
  city: z.string().trim().min(1, "Select a city"),
  venue_address: z.string().trim().max(500).optional(),
  days_of_week: z.array(z.number()).min(1, "Select at least one day"),
  start_time: z.string().min(1, "Pick your deal hours"),
  end_time: z.string().min(1, "Pick your deal hours"),
  description: z.string().trim().min(1, "Description is required").max(1000),
  tags: z.array(z.string()),
  honeypot: z.string().max(0, "Bot detected"),
});

type SubmissionForm = z.infer<typeof submissionSchema>;

// DealDraft (one deal of a multi-deal submission) lives in lib/submission-draft
// because it is also the persisted shape — see the autosave notes there.
const EMPTY_DEAL: DealDraft = {
  days_of_week: [],
  start_time: "",
  end_time: "",
  description: "",
  tags: [],
  activePreset: null,
  startMin: null,
  endMin: null,
};

// The form fields that belong to the open deal editor (validated when a deal
// is collapsed via "Add another deal" or switching deals with Edit).
const DEAL_FIELDS = ["days_of_week", "start_time", "end_time", "description", "tags"] as const;

/** Compact day summary for a collapsed deal row, in Monday-first display order. */
function daysLabel(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 5 && WEEKDAYS.every((w) => days.includes(w))) return "Weekdays";
  return DAY_ORDER.filter((d) => days.includes(d.value))
    .map((d) => d.label)
    .join(", ");
}

/** Time range label for a collapsed deal row, e.g. "4:00 PM – 6:00 PM". */
function timeRangeLabel(deal: DealDraft): string {
  if (deal.startMin != null && deal.endMin != null) {
    return `${formatMinutes(deal.startMin)} – ${formatMinutes(deal.endMin)}`;
  }
  return `${deal.start_time} – ${deal.end_time}`;
}

// Fields shown in the "please fix these" error summary near the submit button,
// in the order they appear in the form. `anchor` is the id set on the matching
// FormItem so clicking an entry can scroll to + focus that field. start_time and
// end_time share one visible picker, so they map to the same anchor/label and are
// de-duplicated when the summary is built.
const ERROR_SUMMARY_FIELDS: { name: keyof SubmissionForm; anchor: string }[] = [
  { name: "venue_name", anchor: "field-venue_name" },
  { name: "country", anchor: "field-country" },
  { name: "city", anchor: "field-city" },
  { name: "days_of_week", anchor: "field-days_of_week" },
  { name: "start_time", anchor: "field-deal-hours" },
  { name: "end_time", anchor: "field-deal-hours" },
  { name: "description", anchor: "field-description" },
];

// Scroll a field into view and move focus to its first interactive control, so
// the user lands directly on what needs fixing.
function focusField(anchor: string) {
  const el = document.getElementById(anchor);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = el.querySelector<HTMLElement>(
    "input:not([type='hidden']), select, textarea, button, [tabindex]:not([tabindex='-1'])"
  );
  focusable?.focus({ preventScroll: true });
}

export default function Submit() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Server/network failure shown inline next to the submit button (in addition
  // to the toast), so the reason is visible without relying on the transient toast.
  const [serverError, setServerError] = useState<string | null>(null);
  const { toast } = useToast();

  const form = useForm<SubmissionForm>({
    resolver: zodResolver(submissionSchema),
    defaultValues: {
      venue_name: "",
      country: "",
      city: "",
      venue_address: "",
      days_of_week: [],
      start_time: "",
      end_time: "",
      description: "",
      tags: [],
      honeypot: "",
    },
  });

  // Location picker. `selectedCity` holds the chosen city's coordinates (the
  // map pin source); the form's `city`/`country` fields mirror it for
  // validation + display. Prefill fills these passively (see below).
  const [selectedCity, setSelectedCity] = useState<CityResult | null>(null);
  // Once the user picks a country or city themselves, the passive GPS/IP prefill
  // must stop. On mobile, geolocation is often already granted and its GPS fix
  // resolves a second or two AFTER load — late enough to land after the user has
  // already chosen (e.g.) Canada and clobber both city and country back to their
  // physical location (AU). `dirtyFields` alone doesn't guard this (the pickers
  // set values without marking them dirty), so track explicit interaction here.
  const [locationTouched, setLocationTouched] = useState(false);
  const prefill = useLocationPrefill();

  const handleCityChange = (city: CityResult) => {
    setLocationTouched(true);
    setSelectedCity(city);
    form.setValue("city", city.city, { shouldValidate: true });
    if (city.countryCode) form.setValue("country", city.countryCode, { shouldValidate: true });
  };

  const handleCountryChange = (code: string) => {
    setLocationTouched(true);
    form.setValue("country", code, { shouldValidate: true });
    // Changing country to one that doesn't match the picked city clears the
    // stale city so the two stay consistent.
    if (selectedCity && selectedCity.countryCode && selectedCity.countryCode !== code) {
      setSelectedCity(null);
      form.setValue("city", "", { shouldValidate: true });
    }
  };

  // Apply passive prefill only to still-untouched fields, so it never clobbers
  // what the user chose. Once the user has touched either location field, the
  // helper returns an empty patch — a late-resolving GPS fix (common on mobile)
  // must not override an explicit pick. See lib/location-prefill.ts.
  useEffect(() => {
    const patch = computeLocationPrefill({
      prefill,
      touched: locationTouched,
      currentCountry: form.getValues("country"),
      hasSelectedCity: selectedCity !== null,
      countryDirty: !!form.formState.dirtyFields.country,
      cityDirty: !!form.formState.dirtyFields.city,
    });
    if (patch.city) {
      setSelectedCity(patch.city);
      form.setValue("city", patch.city.city);
    }
    if (patch.country) {
      form.setValue("country", patch.country);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, locationTouched]);

  // Deal-hours picker. The two dropdowns (minutes since midnight) are the
  // source of truth; the chip is a prefill shortcut. Values sync into the form
  // as 'HH:MM' clock strings. `activePreset` drives chip highlight + reveals
  // the adjustment row; null means no chip tapped yet.
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [startMin, setStartMin] = useState<number | null>(null);
  const [endMin, setEndMin] = useState<number | null>(null);

  const commitTimes = (start: number, end: number) => {
    setStartMin(start);
    setEndMin(end);
    form.setValue("start_time", minutesToClock(start), { shouldValidate: true });
    form.setValue("end_time", minutesToClock(end), { shouldValidate: true });
  };

  const selectPreset = (preset: DealPreset) => {
    setActivePreset(preset.key);
    commitTimes(preset.start ?? CUSTOM_DEFAULT_START, preset.end ?? CUSTOM_DEFAULT_END);
  };

  const activeHint = DEAL_PRESETS.find((p) => p.key === activePreset)?.hint ?? "";

  const resetPicker = () => {
    setActivePreset(null);
    setStartMin(null);
    setEndMin(null);
  };

  // Multi-deal state. `deals` holds every deal of the submission; the entry at
  // `openIndex` is a snapshot that may be stale while the user edits — the form
  // fields are the source of truth for the open deal, and are written back into
  // the array whenever it collapses (add / edit-switch / submit).
  const [deals, setDeals] = useState<DealDraft[]>([EMPTY_DEAL]);
  const [openIndex, setOpenIndex] = useState(0);
  const multiDeal = deals.length > 1;

  /** Current editor content as a DealDraft (form values + picker state). */
  const snapshotEditor = (): DealDraft => ({
    days_of_week: form.getValues("days_of_week") ?? [],
    start_time: form.getValues("start_time"),
    end_time: form.getValues("end_time"),
    description: form.getValues("description"),
    tags: form.getValues("tags") ?? [],
    activePreset,
    startMin,
    endMin,
  });

  /** An untouched editor: no days picked and no description typed. */
  const editorIsBlank = () =>
    (form.getValues("days_of_week") ?? []).length === 0 &&
    !form.getValues("description").trim();

  const loadDealIntoEditor = (d: DealDraft) => {
    form.setValue("days_of_week", d.days_of_week);
    form.setValue("start_time", d.start_time);
    form.setValue("end_time", d.end_time);
    form.setValue("description", d.description);
    form.setValue("tags", d.tags);
    form.clearErrors([...DEAL_FIELDS]);
    setActivePreset(d.activePreset);
    setStartMin(d.startMin);
    setEndMin(d.endMin);
  };

  // ── Draft autosave ──────────────────────────────────────────────────────
  // Everything typed here is written to the browser as the user goes, so a
  // reload — from a failed bot check, a dropped tab, a phone call — costs a tap
  // instead of the whole form. A stored draft is *offered* on load, never
  // applied silently: a stale draft quietly overwriting a fresh submission
  // would be worse than losing it. See lib/submission-draft.ts.
  const [draftOffer, setDraftOffer] = useState<SubmissionDraft | null>(() => loadDraft());

  /** The full submission as it stands right now, editor included. */
  const buildDraft = (): SubmissionDraft => {
    const all = [...deals];
    all[openIndex] = snapshotEditor();
    return {
      version: DRAFT_VERSION,
      savedAt: Date.now(),
      venue_name: form.getValues("venue_name") ?? "",
      venue_address: form.getValues("venue_address") ?? "",
      country: form.getValues("country") ?? "",
      city: form.getValues("city") ?? "",
      selectedCity,
      deals: all,
      openIndex,
    };
  };

  // Kept in a ref so the debounced writer always sees current state without
  // re-subscribing to the form on every render.
  const buildDraftRef = useRef(buildDraft);
  useEffect(() => {
    buildDraftRef.current = buildDraft;
  });

  const saveTimer = useRef<number>();
  const queueDraftSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(
      () => saveDraft(buildDraftRef.current()),
      DRAFT_SAVE_DEBOUNCE_MS
    );
  }, []);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  // Autosave stays off while a restore is on offer — the empty form behind the
  // banner would otherwise overwrite the very draft being offered — and after a
  // successful submit, which clears the draft on purpose.
  const autosavePaused = draftOffer !== null || submitted;

  useEffect(() => {
    if (autosavePaused) return;
    const sub = form.watch(() => queueDraftSave());
    return () => sub.unsubscribe();
  }, [autosavePaused, form, queueDraftSave]);

  // The deal list, the open deal and the location live outside the form fields,
  // so they need their own trigger.
  useEffect(() => {
    if (autosavePaused) return;
    queueDraftSave();
  }, [deals, openIndex, selectedCity, activePreset, startMin, endMin, autosavePaused, queueDraftSave]);

  const restoreDraft = (d: SubmissionDraft) => {
    form.setValue("venue_name", d.venue_name);
    form.setValue("venue_address", d.venue_address);
    form.setValue("country", d.country);
    form.setValue("city", d.city);
    setSelectedCity(d.selectedCity);
    // A restored location is an explicit choice — stop the passive GPS/IP
    // prefill from overwriting it a moment later.
    setLocationTouched(true);
    setDeals(d.deals);
    setOpenIndex(d.openIndex);
    loadDealIntoEditor(d.deals[d.openIndex]);
    setDraftOffer(null);
    toast({ title: "Draft restored", description: describeDraft(d) });
  };

  const discardDraft = () => {
    clearDraft();
    setDraftOffer(null);
  };

  /** Validate the open editor; on failure jump to the first offending field. */
  const validateEditor = async (): Promise<boolean> => {
    const ok = await form.trigger([...DEAL_FIELDS]);
    if (!ok) {
      const first = ERROR_SUMMARY_FIELDS.find((f) => form.formState.errors[f.name]);
      if (first) window.requestAnimationFrame(() => focusField(first.anchor));
    }
    return ok;
  };

  // "Add another deal": collapse the open deal (must be valid), then open a
  // fresh one prefilled with the previous deal's hours and tags — days and
  // description are what usually change between a venue's deals.
  const addDeal = async () => {
    if (deals.length >= MAX_DEALS_PER_SUBMISSION) return;
    if (!(await validateEditor())) return;
    const snap = snapshotEditor();
    const draft: DealDraft = {
      ...EMPTY_DEAL,
      start_time: snap.start_time,
      end_time: snap.end_time,
      tags: [...snap.tags],
      activePreset: snap.activePreset,
      startMin: snap.startMin,
      endMin: snap.endMin,
    };
    const next = [...deals];
    next[openIndex] = snap;
    next.push(draft);
    setDeals(next);
    setOpenIndex(next.length - 1);
    loadDealIntoEditor(draft);
  };

  // Re-open a collapsed deal. The currently open one collapses first: if it's
  // still blank it is discarded, otherwise it must be valid to be kept.
  const editDeal = async (i: number) => {
    if (i === openIndex) return;
    const next = [...deals];
    let target = i;
    if (editorIsBlank() && deals.length > 1) {
      next.splice(openIndex, 1);
      if (openIndex < i) target = i - 1;
    } else {
      if (!(await validateEditor())) return;
      next[openIndex] = snapshotEditor();
    }
    setDeals(next);
    setOpenIndex(target);
    loadDealIntoEditor(next[target]);
  };

  const removeDeal = (i: number) => {
    if (deals.length <= 1) return;
    const next = [...deals];
    next.splice(i, 1);
    if (i === openIndex) {
      // Removed the open deal — re-open its predecessor.
      const target = Math.max(0, Math.min(i - 1, next.length - 1));
      setDeals(next);
      setOpenIndex(target);
      loadDealIntoEditor(next[target]);
    } else {
      setDeals(next);
      if (openIndex > i) setOpenIndex(openIndex - 1);
    }
  };

  // Collapsed summary row for a deal that isn't currently being edited.
  const renderDealRow = (deal: DealDraft, i: number) => (
    <div
      key={i}
      className="flex items-center gap-3 rounded-xl border border-border bg-muted/50 px-3 py-2.5"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {i + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {daysLabel(deal.days_of_week)} · {timeRangeLabel(deal)}
        </p>
        <p className="truncate text-xs text-muted-foreground">{deal.description}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2"
          onClick={() => editDeal(i)}
          aria-label={`Edit deal ${i + 1}`}
        >
          <Pencil className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Edit</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-destructive hover:text-destructive"
          onClick={() => removeDeal(i)}
          aria-label={`Remove deal ${i + 1}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  const venueName = form.watch("venue_name");
  const description = form.watch("description");
  useEffect(() => {
    const inferred = inferTagsFromDescription(description || "");
    if (inferred.length === 0) return;
    const current = form.getValues("tags") || [];
    const merged = Array.from(new Set([...current, ...inferred]));
    if (merged.length !== current.length) {
      form.setValue("tags", merged);
    }
  }, [description, form]);

  // Turnstile. The check runs on submit rather than on render: the widget is
  // invisible while the form is filled in, the submit button is never gated on
  // it, and the token is seconds old by the time the server sees it — so it
  // cannot expire mid-form. When the check can't run the user gets a message
  // and a Try again button instead of a dead button and a lost form.
  //
  // api.js loads with `defer` and can land after React mounts, so poll until
  // it's ready rather than bail permanently.
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string>();
  // Resolver for the in-flight execute(). The widget answers asynchronously
  // through its callbacks, so a submit awaits this deferred.
  const pendingCheck = useRef<{ resolve: (token: string) => void; reject: () => void } | null>(null);
  const [checking, setChecking] = useState(false);
  // Set when the last failure is worth retrying in place (check didn't run, or
  // the server rejected the token) — drives the Try again button.
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    const tryRender = () => {
      if (cancelled) return;
      if (!window.turnstile || !turnstileRef.current) {
        window.setTimeout(tryRender, 100);
        return;
      }
      widgetId.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        execution: "execute",
        appearance: "interaction-only",
        callback: (token) => pendingCheck.current?.resolve(token),
        "error-callback": () => pendingCheck.current?.reject(),
        "timeout-callback": () => pendingCheck.current?.reject(),
        "expired-callback": () => pendingCheck.current?.reject(),
      });
    };
    tryRender();
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
    };
  }, []);

  /** Mint a fresh Turnstile token, or throw so the caller can offer a retry. */
  const requestTurnstileToken = async (): Promise<string> => {
    if (!TURNSTILE_SITE_KEY) return "";

    // The script may still be in flight on a slow connection — give it a
    // bounded wait instead of failing the moment the user is ready.
    const deadline = Date.now() + WIDGET_READY_TIMEOUT_MS;
    while (!widgetId.current && Date.now() < deadline) {
      await new Promise((r) => window.setTimeout(r, 100));
    }
    const id = widgetId.current;
    if (!id || !window.turnstile) throw new Error("turnstile_unavailable");

    return new Promise<string>((resolve, reject) => {
      const settle = (fn: () => void) => {
        window.clearTimeout(timer);
        pendingCheck.current = null;
        fn();
      };
      const timer = window.setTimeout(
        () => settle(() => reject(new Error("turnstile_timeout"))),
        CHECK_TIMEOUT_MS
      );
      pendingCheck.current = {
        resolve: (token) => settle(() => resolve(token)),
        reject: () => settle(() => reject(new Error("turnstile_failed"))),
      };
      try {
        // reset() returns the widget to its un-executed state, so every submit
        // — including a retry — mints a brand new token.
        window.turnstile!.reset(id);
        window.turnstile!.execute(id);
      } catch {
        settle(() => reject(new Error("turnstile_failed")));
      }
    });
  };

  const onSubmit = async (values: SubmissionForm) => {
    // Honeypot check — bots fill hidden fields (also enforced server-side)
    if (values.honeypot) return;

    // The open deal comes from the just-validated form values; collapsed deals
    // were each validated when they collapsed. Deal #1 travels in the
    // submission's own fields, the rest in extra_deals.
    const allDeals = deals.map((d, i) =>
      i === openIndex
        ? {
            days_of_week: values.days_of_week,
            start_time: values.start_time,
            end_time: values.end_time,
            description: values.description,
            tags: values.tags,
          }
        : d
    );
    const [firstDeal, ...extraDeals] = allDeals;

    setServerError(null);
    setCanRetry(false);

    // Bot check runs here, not on page load, so a token is never stale and a
    // failure is recoverable without losing the form.
    let token = "";
    if (TURNSTILE_SITE_KEY) {
      setChecking(true);
      try {
        token = await requestTurnstileToken();
      } catch {
        setServerError(CHECK_FAILED_MESSAGE);
        setCanRetry(true);
        toast({
          title: "Security check didn't run",
          description: "Nothing was lost — tap Try again.",
          variant: "destructive",
        });
        return;
      } finally {
        setChecking(false);
      }
    }

    setSubmitting(true);
    try {
      await api.post("/api/submissions", {
        venue_name: values.venue_name,
        venue_address: values.venue_address?.trim() ? values.venue_address.trim() : null,
        city: selectedCity?.city ?? values.city,
        country: values.country,
        lat: selectedCity?.lat ?? null,
        lng: selectedCity?.lng ?? null,
        days_of_week: firstDeal.days_of_week,
        start_time: firstDeal.start_time,
        end_time: firstDeal.end_time,
        description: firstDeal.description,
        tags: firstDeal.tags.length > 0 ? firstDeal.tags : null,
        extra_deals: extraDeals.map((d) => ({
          days_of_week: d.days_of_week,
          start_time: d.start_time,
          end_time: d.end_time,
          description: d.description,
          tags: d.tags,
        })),
        honeypot: values.honeypot,
        turnstile_token: token,
      });
      clearDraft();
      setSubmitted(true);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 429) {
        const msg = "Too many submissions — please wait a minute and try again.";
        setServerError(msg);
        setCanRetry(true);
        toast({ title: "Too many submissions", description: "Please wait a minute and try again.", variant: "destructive" });
      } else if (status === 403) {
        // The server rejected the token. Retrying mints a fresh one, so this is
        // a one-tap recovery rather than something the user must go and redo.
        const msg = "The security check didn't go through. Your deals are safe — give it another go.";
        setServerError(msg);
        setCanRetry(true);
        toast({ title: "Security check failed", description: "Nothing was lost — tap Try again.", variant: "destructive" });
      } else {
        const msg = "Something went wrong sending your submission. Please try again in a moment.";
        setServerError(msg);
        setCanRetry(true);
        toast({ title: "Something went wrong", description: "Please try again later.", variant: "destructive" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Fires when a submit attempt fails client-side validation. Clear any stale
  // server error and jump the user to the first field that needs attention.
  const onInvalid = () => {
    setServerError(null);
    setCanRetry(false);
    const first = ERROR_SUMMARY_FIELDS.find((f) => form.formState.errors[f.name]);
    if (first) window.requestAnimationFrame(() => focusField(first.anchor));
  };

  // Re-run the whole submit, including a fresh bot check. Every failure above
  // is recoverable in place, so this never costs the user their form.
  const retrySubmit = () => form.handleSubmit(onSubmit, onInvalid)();

  // A failure can land well below the fold on a long multi-deal form, so bring
  // the explanation (and its Try again button) to the user rather than leaving
  // them to hunt for it after the toast has gone.
  const errorAlertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!serverError) return;
    errorAlertRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [serverError]);

  // Build the de-duplicated list of current validation problems for the summary.
  const errorItems = ERROR_SUMMARY_FIELDS.reduce<{ anchor: string; message: string }[]>((acc, f) => {
    const err = form.formState.errors[f.name];
    if (err && !acc.some((item) => item.anchor === f.anchor)) {
      acc.push({ anchor: f.anchor, message: String(err.message) });
    }
    return acc;
  }, []);
  const showValidationSummary = form.formState.submitCount > 0 && errorItems.length > 0;

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col">
        <SubmitHeader />
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-md w-full text-center">
            <CardContent className="pt-8 pb-8 space-y-4">
              <CheckCircle className="h-16 w-16 text-[hsl(var(--happy))] mx-auto" />
              <h2 className="text-2xl font-bold">Thank you!</h2>
              <p className="text-muted-foreground">
                Your hoppy hour submission has been received and will be reviewed by our team.
                Once approved, it will appear on the map.
              </p>
              <div className="flex gap-3 justify-center pt-2">
                <Button variant="outline" asChild>
                  <Link to="/">Back to Map</Link>
                </Button>
                <Button
                  onClick={() => {
                    setSubmitted(false);
                    form.reset();
                    resetPicker();
                    setSelectedCity(null);
                    setDeals([EMPTY_DEAL]);
                    setOpenIndex(0);
                    setServerError(null);
                    setCanRetry(false);
                    // The submitted draft is already cleared; make sure the
                    // fresh form isn't handed a restore banner for it.
                    setDraftOffer(null);
                  }}
                >
                  Submit Another
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SubmitHeader />
      <main className="flex-1 flex justify-center p-4 md:p-8">
        <Card className="max-w-2xl w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Submit a Hoppy Hour
            </CardTitle>
            <CardDescription>
              Know a great deal? Share it with the community. Submissions are reviewed before appearing on the map.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Draft from a previous visit — offered, never applied on its own. */}
            {draftOffer && (
              <Alert className="mb-6">
                <History className="h-4 w-4" />
                <AlertTitle>Pick up where you left off?</AlertTitle>
                <AlertDescription>
                  <p>
                    {describeDraft(draftOffer)} · saved {formatSavedAt(draftOffer.savedAt)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => restoreDraft(draftOffer)}>
                      Restore draft
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={discardDraft}>
                      Start fresh
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-6">
                {/* Honeypot — hidden from real users and screen readers */}
                <div className="absolute -left-[9999px] opacity-0 h-0 overflow-hidden" aria-hidden="true" tabIndex={-1}>
                  <FormField
                    control={form.control}
                    name="honeypot"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Leave this empty</FormLabel>
                        <FormControl>
                          <Input {...field} tabIndex={-1} autoComplete="off" aria-hidden="true" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                {/* Venue info */}
                <FormField
                  control={form.control}
                  name="venue_name"
                  render={({ field }) => (
                    <FormItem id="field-venue_name">
                      <FormLabel>Venue Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. The Golden Tap" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Location: country + city (picked), optional street address */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem id="field-country">
                        <FormLabel>Country</FormLabel>
                        <FormControl>
                          <CountryPicker value={field.value || null} onChange={handleCountryChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="city"
                    render={() => (
                      <FormItem id="field-city">
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <CitySearch
                            value={selectedCity}
                            onChange={handleCityChange}
                            country={form.watch("country") || undefined}
                            proximity={
                              selectedCity
                                ? { lng: selectedCity.lng, lat: selectedCity.lat }
                                : prefill.city
                                  ? { lng: prefill.city.lng, lat: prefill.city.lat }
                                  : undefined
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="venue_address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Street Address <span className="text-muted-foreground font-normal">(optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. 123 Main St" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Deals. With a single deal this renders exactly like the
                    original form — no numbering, no wrapper chrome. Once a
                    second deal is added, saved deals collapse to summary rows
                    and the one open editor gets a numbered, bordered frame. */}
                <div className="space-y-3">
                  {multiDeal && (
                    <p className="text-sm font-medium">
                      Deals{venueName.trim() ? ` at ${venueName.trim()}` : ""}
                    </p>
                  )}
                  {multiDeal && deals.slice(0, openIndex).map((d, i) => renderDealRow(d, i))}

                  <div className={multiDeal ? "space-y-6 rounded-xl border border-primary/60 p-4" : "space-y-6"}>
                    {multiDeal && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">Deal {openIndex + 1}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 px-2 text-destructive hover:text-destructive"
                          onClick={() => removeDeal(openIndex)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </div>
                    )}

                {/* Days */}
                <FormField
                  control={form.control}
                  name="days_of_week"
                  render={({ field }) => {
                    const selected: number[] = field.value ?? [];
                    const toggleDay = (value: number) => {
                      field.onChange(
                        selected.includes(value)
                          ? selected.filter((v) => v !== value)
                          : [...selected, value]
                      );
                    };
                    return (
                      <FormItem id="field-days_of_week">
                        <FormLabel>Days Available</FormLabel>
                        {/* Quick-select row — stateless triggers, replace selection */}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => field.onChange([...WEEKDAYS])}
                            className="flex-1 min-h-[40px] rounded-full border border-border bg-card px-4 text-sm hover:bg-accent transition-colors"
                          >
                            Weekdays
                          </button>
                          <button
                            type="button"
                            onClick={() => field.onChange([...EVERY_DAY])}
                            className="flex-1 min-h-[40px] rounded-full border border-border bg-card px-4 text-sm hover:bg-accent transition-colors"
                          >
                            Every day
                          </button>
                        </div>
                        {/* Day chips — Monday first */}
                        <div className="flex gap-1.5 sm:gap-2">
                          {DAY_ORDER.map((day) => {
                            const on = selected.includes(day.value);
                            return (
                              <button
                                key={day.value}
                                type="button"
                                aria-pressed={on}
                                onClick={() => toggleDay(day.value)}
                                className={`flex-1 min-h-[44px] rounded-full border text-xs sm:text-sm transition-colors ${
                                  on
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-card border-border hover:bg-accent"
                                }`}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />

                {/* Deal hours */}
                <FormField
                  control={form.control}
                  name="start_time"
                  render={() => (
                    <FormItem id="field-deal-hours">
                      <FormLabel>Deal Hours</FormLabel>
                      {/* Preset chips — 3×2 grid, single-select (radio behaviour) */}
                      <div className="grid grid-cols-3 gap-2">
                        {DEAL_PRESETS.map((preset) => {
                          const on = activePreset === preset.key;
                          return (
                            <button
                              key={preset.key}
                              type="button"
                              aria-pressed={on}
                              onClick={() => selectPreset(preset)}
                              className={`min-h-[44px] rounded-full border text-sm transition-colors ${
                                on
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-card border-border hover:bg-accent"
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Adjustment row — revealed once a chip is tapped */}
                      {activePreset !== null && (
                        <div className="mt-3">
                          <div className="flex items-center gap-2">
                            <select
                              aria-label="Start time"
                              value={startMin ?? ""}
                              onChange={(e) => {
                                const start = Number(e.target.value);
                                commitTimes(start, bumpedEnd(start, endMin ?? start));
                              }}
                              className="flex-1 min-h-[44px] rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {TIME_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <span className="text-sm text-muted-foreground">to</span>
                            <select
                              aria-label="End time"
                              value={endMin ?? ""}
                              onChange={(e) => {
                                const end = Number(e.target.value);
                                commitTimes(startMin ?? end, bumpedEnd(startMin ?? 0, end));
                              }}
                              className="flex-1 min-h-[44px] rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {TIME_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">{activeHint}</p>
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Description */}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem id="field-description">
                      <FormLabel>Deal Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="e.g. Half-price craft beers and $5 appetizers"
                          className="resize-none"
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Tags */}
                <FormField
                  control={form.control}
                  name="tags"
                  render={() => (
                    <FormItem>
                      <FormLabel>Tags</FormLabel>
                      <div className="flex flex-wrap gap-2">
                        {TAGS.map((tag) => (
                          <FormField
                            key={tag}
                            control={form.control}
                            name="tags"
                            render={({ field }) => (
                              <label
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-colors capitalize ${
                                  field.value?.includes(tag)
                                    ? "bg-accent text-accent-foreground border-primary/30"
                                    : "bg-card border-border hover:bg-accent"
                                }`}
                              >
                                <Checkbox
                                  className="sr-only"
                                  checked={field.value?.includes(tag)}
                                  onCheckedChange={(checked) => {
                                    const updated = checked
                                      ? [...(field.value ?? []), tag]
                                      : field.value?.filter((v: string) => v !== tag) ?? [];
                                    field.onChange(updated);
                                  }}
                                />
                                {tag}
                              </label>
                            )}
                          />
                        ))}
                      </div>
                    </FormItem>
                  )}
                />
                  </div>

                  {multiDeal &&
                    deals.slice(openIndex + 1).map((d, k) => renderDealRow(d, openIndex + 1 + k))}

                  {deals.length < MAX_DEALS_PER_SUBMISSION && (
                    <button
                      type="button"
                      onClick={addDeal}
                      className="flex w-full min-h-[44px] items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-primary/50 text-sm font-medium text-primary transition-colors hover:bg-accent"
                    >
                      <Plus className="h-4 w-4" />
                      Add another deal at this venue
                    </button>
                  )}
                </div>

                {/* Turnstile mount point. Invisible unless Cloudflare actually
                    challenges — the check itself runs on submit. */}
                {TURNSTILE_SITE_KEY && <div ref={turnstileRef} />}

                {/* Failure feedback next to the action. Server errors take
                    precedence; otherwise show the list of fields to fix. */}
                {serverError ? (
                  <Alert ref={errorAlertRef} variant="destructive" role="alert" aria-live="assertive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Couldn't submit</AlertTitle>
                    <AlertDescription>
                      {serverError}
                      {canRetry && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3 flex gap-1.5"
                          onClick={retrySubmit}
                          disabled={checking || submitting}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Try again
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                ) : showValidationSummary ? (
                  <Alert variant="destructive" role="alert" aria-live="assertive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>
                      {errorItems.length === 1
                        ? "1 thing needs your attention"
                        : `${errorItems.length} things need your attention`}
                    </AlertTitle>
                    <AlertDescription>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {errorItems.map((item) => (
                          <li key={item.anchor}>
                            <button
                              type="button"
                              onClick={() => focusField(item.anchor)}
                              className="text-left underline underline-offset-2 hover:no-underline"
                            >
                              {item.message}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                ) : null}

                {/* Never gated on the bot check: the button is what runs it, so
                    there is always a control to press. */}
                <Button
                  type="submit"
                  size="lg"
                  className="w-full gap-2"
                  disabled={submitting || checking}
                >
                  <Send className="h-4 w-4" />
                  {checking
                    ? "Checking you're human…"
                    : submitting
                      ? "Submitting…"
                      : multiDeal
                        ? `Submit Hoppy Hour · ${deals.length} deals`
                        : "Submit Hoppy Hour"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function SubmitHeader() {
  return (
    <header className="flex items-center gap-3 px-6 py-3 border-b border-border bg-card">
      <Button variant="ghost" size="icon" asChild>
        <Link to="/">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <div className="flex items-center gap-2">
        <img src="/favicon.ico" alt="HoppyHour" className="h-8 w-8" />
        <h1 className="text-lg font-bold tracking-tight">HoppyHour</h1>
      </div>
    </header>
  );
}

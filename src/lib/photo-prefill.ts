// Turning a menu-photo read (POST /api/menu-photo) into the submit form's
// deal drafts, and the client-side checks around picking a photo.
//
// The read is only a pre-fill: anything the photo didn't state stays empty,
// and the form's own validation still has to pass before anything is sent.
import { inferTagsFromDescription } from "@/lib/tags";
import { ALL_DAY_END, ALL_DAY_START, DEAL_PRESETS, TIME_OPTIONS } from "@/lib/deal-time";
import type { PhotoPrefillDeal } from "@/lib/api-types";
import type { DealDraft } from "@/lib/submission-draft";

/** Same cap the server enforces on the decoded upload. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

function clockToMinutes(t: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const PICKER_VALUES = new Set(TIME_OPTIONS.map((o) => o.value));

/**
 * Map read times onto the deal-hours picker. A matching preset chip lights
 * up; 00:00–23:59 is "All day"; other times the dropdowns can show become
 * "Custom". Anything else (missing, or e.g. 10:15) leaves the picker empty so
 * the person picks the hours themselves — the form won't submit without them.
 */
function pickerFor(start: string, end: string): Pick<DealDraft, "start_time" | "end_time" | "activePreset" | "startMin" | "endMin"> {
  const empty = { start_time: "", end_time: "", activePreset: null, startMin: null, endMin: null };
  const s = clockToMinutes(start);
  const eRaw = clockToMinutes(end);
  if (s == null || eRaw == null) return empty;
  if (s === ALL_DAY_START && eRaw === ALL_DAY_END) {
    return { start_time: start, end_time: end, activePreset: "all", startMin: ALL_DAY_START, endMin: ALL_DAY_END };
  }
  // The picker counts past midnight (1 AM = 1500) so end stays after start.
  const e = eRaw <= s ? eRaw + 1440 : eRaw;
  const preset = DEAL_PRESETS.find((p) => p.start === s && p.end === e && p.key !== "all");
  if (preset) return { start_time: start, end_time: end, activePreset: preset.key, startMin: s, endMin: e };
  if (PICKER_VALUES.has(s) && PICKER_VALUES.has(e)) {
    return { start_time: start, end_time: end, activePreset: "custom", startMin: s, endMin: e };
  }
  return empty;
}

export function dealDraftFromPhoto(d: PhotoPrefillDeal): DealDraft {
  return {
    days_of_week: [...d.days_of_week],
    description: d.description,
    tags: inferTagsFromDescription(d.description),
    ...pickerFor(d.start_time, d.end_time),
  };
}

/** Whether a collapsed deal would pass the form's deal validation. */
export function isDealComplete(d: DealDraft): boolean {
  return d.days_of_week.length > 0 && !!d.start_time && !!d.end_time && d.description.trim() !== "";
}

/** HEIC/HEIF straight off an iPhone, which most browsers other than Safari can't decode. */
export function isHeic(file: File): boolean {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

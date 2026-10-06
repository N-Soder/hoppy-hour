// Normalization of the vision model's happy-hour extraction into the shapes
// the submissions table expects. Pure functions — unit-tested from src/test.
import { isValidTime } from "./validate";
import { inferTagsFromDescription } from "../../src/lib/tags";
import { MAX_DEALS_PER_SUBMISSION, type SubmissionDeal } from "../../src/lib/api-types";

/** Shape the model is asked to return (enforced via structured output). */
export interface ExtractedMenu {
  venue_name: string | null;
  venue_address: string | null;
  deals: Array<{
    days_of_week: number[];
    start_time: string;
    end_time: string;
    description: string;
  }>;
  /** Anything ambiguous or unreadable, surfaced to the reviewer. */
  notes: string | null;
}

/** JSON Schema for the structured-output call (subset supported by the API). */
export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["venue_name", "venue_address", "deals", "notes"],
  properties: {
    venue_name: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "The venue/bar name if visible in the image, else null.",
    },
    venue_address: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Street address if visible in the image, else null.",
    },
    deals: {
      type: "array",
      description: "One entry per distinct happy-hour deal/time-window on the menu.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["days_of_week", "start_time", "end_time", "description"],
        properties: {
          days_of_week: {
            type: "array",
            description: "Days the deal runs; 0=Sunday..6=Saturday. Empty if not stated.",
            items: { type: "integer", enum: [0, 1, 2, 3, 4, 5, 6] },
          },
          start_time: { type: "string", description: "24h HH:MM start time, or empty string if not stated." },
          end_time: { type: "string", description: "24h HH:MM end time, or empty string if not stated." },
          description: { type: "string", description: "What the deal is, e.g. '$10 house wine and $8 pints'." },
        },
      },
    },
    notes: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Ambiguities, unreadable parts, or context the reviewer should know. Null if none.",
    },
  },
} as const;

const PLACEHOLDER_TIME = "00:00:00";

/**
 * Turn a raw extraction into the deal rows stored on a submission. Deals are
 * validated leniently: unparseable times fall back to 00:00:00 and empty day
 * lists are kept — the admin review dialog blocks approval until every deal is
 * complete, so a partial extraction still saves the reviewer typing.
 */
export function normalizeExtractedDeals(extracted: ExtractedMenu): SubmissionDeal[] {
  const deals: SubmissionDeal[] = [];
  for (const d of extracted.deals ?? []) {
    if (deals.length >= MAX_DEALS_PER_SUBMISSION) break;
    const description = (typeof d.description === "string" ? d.description : "").trim().slice(0, 1000);
    const days = Array.isArray(d.days_of_week)
      ? [...new Set(d.days_of_week.filter((v) => Number.isInteger(v) && v >= 0 && v <= 6))].sort()
      : [];
    deals.push({
      days_of_week: days,
      start_time: isValidTime(d.start_time) ? toHmsLoose(d.start_time) : PLACEHOLDER_TIME,
      end_time: isValidTime(d.end_time) ? toHmsLoose(d.end_time) : PLACEHOLDER_TIME,
      description,
      tags: description ? inferTagsFromDescription(description) : [],
    });
  }
  // The submissions table requires a first deal (NOT NULL columns) — keep a
  // placeholder so an unreadable photo still lands in the queue for review.
  if (deals.length === 0) {
    deals.push({
      days_of_week: [],
      start_time: PLACEHOLDER_TIME,
      end_time: PLACEHOLDER_TIME,
      description: "",
      tags: [],
    });
  }
  return deals;
}

function toHmsLoose(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

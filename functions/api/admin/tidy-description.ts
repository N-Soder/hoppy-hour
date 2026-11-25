// POST /api/admin/tidy-description — suggest the standard deal-text format.
//
// Admin-gated (Cloudflare Access + the /api/admin middleware). The review
// dialog sends a submission's deal descriptions when it opens; a cheap text
// model rewrites them into the house format (see _shared/deal-text.ts) and
// every rewrite passes a deterministic guard before it is offered: if a price,
// number or condition went missing, the original comes back with
// changed=false. Nothing is saved here — the reviewer chooses, and approve
// saves whatever is in the field.
import Anthropic, { APIError, RateLimitError } from "@anthropic-ai/sdk";
import type { Env } from "../../_shared/db";
import { error, json, readJson } from "../../_shared/http";
import { clientIp, rateLimit } from "../../_shared/rate-limit";
import { TIDY_SCHEMA, TIDY_SYSTEM_PROMPT, guardTidied, validateTidyInput } from "../../_shared/deal-text";
import {
  MAX_TIDY_DESCRIPTIONS, type TidyDescriptionInput, type TidyDescriptionResponse,
} from "../../../src/lib/api-types";

// Haiku 5.5: $0.10 / $0.50 per MTok. A review is ~1K input tokens (mostly the
// system prompt) and ~100 output tokens — a few hundredths of a cent.
export const TIDY_MODEL = "claude-haiku-5-5";

// The dialog is waiting on this; a slow answer is worth less than none.
const TIMEOUT_MS = 15_000;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Opening a review dialog fires one request; 30/min is generous for a human.
  if (!(await rateLimit(env.RATE_LIMIT, "tidy_description", clientIp(request), 30))) {
    return error("rate limit exceeded, try again in a minute", 429);
  }

  const body = await readJson<TidyDescriptionInput>(request, 32 * 1024);
  if (!body) return error("expected a JSON body", 400);
  const invalid = validateTidyInput(body, MAX_TIDY_DESCRIPTIONS);
  if (invalid) return error(invalid, 400);
  const descriptions = body.descriptions;

  if (!env.ANTHROPIC_API_KEY) return error("text tidying is not configured", 503);

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 1 });
  const totalChars = descriptions.reduce((n, d) => n + d.length, 0);
  let tidied: unknown[];
  try {
    const response = await anthropic.messages.create({
      model: TIDY_MODEL,
      // Output is about as long as the input (~4 chars/token) plus JSON overhead.
      max_tokens: Math.min(4096, 200 + Math.ceil(totalChars / 2)),
      // A rewrite, not a reasoning task: no thinking, low effort.
      thinking: { type: "disabled" },
      system: TIDY_SYSTEM_PROMPT,
      output_config: { effort: "low", format: { type: "json_schema", schema: TIDY_SCHEMA } },
      messages: [{ role: "user", content: JSON.stringify(descriptions) }],
    });
    if (response.stop_reason === "refusal") return error("the model declined to tidy this text", 422);
    if (response.stop_reason === "max_tokens") return error("tidy result was cut off", 502);
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") return error("tidy returned no result", 502);
    const parsed = JSON.parse(textBlock.text) as { tidied?: unknown };
    if (!Array.isArray(parsed.tidied)) return error("tidy returned malformed data", 502);
    tidied = parsed.tidied;
  } catch (e) {
    if (e instanceof RateLimitError) return error("tidy service is rate-limited — try again shortly", 503);
    if (e instanceof APIError) return error(`tidy failed (${e.status ?? "network"})`, 502);
    return error("tidy returned malformed data", 502);
  }

  // A wrong-length array can't be matched to the inputs by position, so every
  // entry becomes "no suggestion" rather than risk pairing the wrong texts.
  const aligned = tidied.length === descriptions.length;
  const results = descriptions.map((original, i) => guardTidied(original, aligned ? tidied[i] : undefined));
  return json({ results } satisfies TidyDescriptionResponse);
};

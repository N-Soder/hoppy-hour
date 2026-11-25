/**
 * Splits a deal description into the lines the venue detail shows.
 *
 * Descriptions are written as offers separated by "; ", each usually led by
 * its price, with an optional "Title: " in front of the first one:
 *
 *   "Monday Steak Night: $25 200g skirt steak; $9 pints of Carlton Dry"
 *   → { title: "Monday Steak Night",
 *       offers: [{ price: "$25", text: "200g skirt steak" },
 *                { price: "$9", text: "pints of Carlton Dry" }] }
 *
 * Commas never split ("$8 beer and wine, $15 select cocktails" stays one
 * line): they are too common inside a single offer.
 */

export interface DealOffer {
  /** Leading price, shortened ("$9.00" → "$9"; "$7.50" kept). */
  price?: string;
  /** The rest of the offer (the whole line when there is no price). */
  text: string;
}

export interface DealText {
  title?: string;
  offers: DealOffer[];
}

// "$9", "$9.00" or "$7.50", then a space and some text. "$6.5" or "$9pints"
// are not read as a price, so the line stays plain rather than splitting
// mid-number.
const PRICE = /^(\$\d+(?:\.\d{2})?)\s+(\S[\s\S]*)$/;

function parseOffer(line: string): DealOffer {
  const m = PRICE.exec(line);
  if (!m) return { text: line };
  const price = m[1].endsWith(".00") ? m[1].slice(0, -3) : m[1];
  return { price, text: m[2] };
}

export function splitOffers(description: string | null | undefined): DealText {
  const segments = (description ?? "")
    .split(/;\s+/)
    .map((s) => s.trim().replace(/;+$/, "").trim())
    .filter(Boolean);
  if (segments.length === 0) return { offers: [] };

  // "Title: first offer". A line that opens with a price is never a title.
  // A colon must be followed by a space (or end the segment), so "5:30" is not
  // read as one.
  let title: string | undefined;
  const m = /^([^$][^:]*?):(?:\s+([\s\S]*))?$/.exec(segments[0]);
  if (m && m[1].trim()) {
    title = m[1].trim();
    const rest = (m[2] ?? "").trim();
    if (rest) segments[0] = rest;
    else segments.shift();
  }

  return { ...(title ? { title } : {}), offers: segments.map(parseOffer) };
}

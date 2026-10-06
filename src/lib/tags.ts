// Tag vocabulary + keyword-based auto-tagging.
//
// Self-contained on purpose: imported by BOTH the SPA (via @/lib/auto-tag and
// @/lib/constants re-exports) and the Pages Functions (via a relative path).
// Keep it free of "@/..." aliases and import.meta — neither resolves in the
// wrangler Functions bundle.

export const VALID_TAGS = ["beer", "wine", "cocktails", "food", "spirits"] as const;
export type ValidTag = (typeof VALID_TAGS)[number];

const TAG_KEYWORDS: Record<ValidTag, string[]> = {
  beer: ["beer", "lager", "ale", "ipa", "stout", "porter", "draught", "draft", "pint", "brew"],
  wine: ["wine", "prosecco", "champagne", "chardonnay", "merlot", "pinot", "sauvignon", "rosé"],
  spirits: ["spirit", "whiskey", "whisky", "bourbon", "vodka", "gin", "tequila", "brandy", "scotch", "liquor", "mezcal", "rum"],
  cocktails: ["cocktail", "margarita", "martini", "mojito", "negroni", "sangria"],
  food: ["food", "snack", "appetizer", "nacho", "wing", "burger", "pizza", "taco", "bite", "eats"],
};

export function inferTagsFromDescription(description: string): string[] {
  const lower = description.toLowerCase();
  return Object.entries(TAG_KEYWORDS)
    .filter(([, keywords]) => keywords.some((kw) => lower.includes(kw)))
    .map(([tag]) => tag);
}

// Fetches AI "tidy the deal text" suggestions for a submission's deals when
// its review dialog opens. Cached per submission id for the whole session
// (staleTime/gcTime Infinity, no retries) so reopening a dialog never re-bills.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dealsOf } from "@/lib/admin";
import { MAX_TIDY_DESCRIPTIONS, type Submission, type TidyDescriptionResponse } from "@/lib/api-types";

export type TidyState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "suggestion"; text: string }
  | null;

/** Original deal descriptions worth sending: non-blank, not a photo-notes placeholder. */
export function tidyCandidates(originals: string[]): string[] {
  const unique = new Set(
    originals.map((d) => d.trim()).filter((d) => d && !d.startsWith("(photo notes:")),
  );
  return [...unique].slice(0, MAX_TIDY_DESCRIPTIONS);
}

export function useTidySuggestions(sub: Submission): (originIdx: number) => TidyState {
  const originals = useMemo(() => dealsOf(sub).map((d) => d.description.trim()), [sub]);
  const candidates = useMemo(() => tidyCandidates(originals), [originals]);

  const { data, isPending, isError } = useQuery({
    queryKey: ["admin_tidy", sub.id],
    queryFn: () =>
      api.post<TidyDescriptionResponse>("/api/admin/tidy-description", { descriptions: candidates }),
    enabled: candidates.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return (originIdx: number): TidyState => {
    const original = originals[originIdx];
    if (!original || !candidates.includes(original)) return null;
    if (isError) return { kind: "error" };
    if (isPending || !data) return { kind: "loading" };
    const hit = data.results.find((r) => r.original.trim() === original);
    return hit?.changed && hit.tidied !== original ? { kind: "suggestion", text: hit.tidied } : null;
  };
}

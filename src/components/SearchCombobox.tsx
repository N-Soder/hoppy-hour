import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Beer, Loader2, MapPin, Search, SearchX, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { usePlaceSuggestions } from "@/hooks/use-place-suggestions";
import {
  enterTarget,
  moveActive,
  rankVenues,
  suggestionDomId,
  suggestionOrder,
  suggestionSummary,
  wantsPlaces,
  type PlaceSuggestion,
  type Suggestion,
} from "@/lib/search-suggestions";
import type { ChosenPlace } from "@/lib/url-state";
import { cn } from "@/lib/utils";

interface SearchComboboxProps {
  /** The text in the box; it also filters the list by name/address as you type. */
  query: string;
  onQueryChange: (q: string) => void;
  /** Loaded venues to suggest from. */
  venues: { id: string; name: string; address: string; distance_meters?: number }[];
  /** Places near here rank first. */
  near: { lng: number; lat: number } | null;
  onPickVenue: (id: string) => void;
  onPickPlace: (place: ChosenPlace) => void;
}

const rowClass =
  "flex w-full cursor-pointer select-none items-center gap-3 rounded-md px-2.5 py-1.5 text-left min-h-10 coarse:min-h-11";
const statusRowClass = "flex min-h-10 items-center gap-3 px-2.5 py-1.5 text-sm text-muted-foreground coarse:min-h-11";
const headingClass = "px-2.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * The search box: one combobox (WAI-ARIA 1.2 pattern, focus stays in the
 * input) suggesting matching venues first and places below. Picking a venue
 * opens it; picking a place moves the search there. Enter picks the
 * highlighted row, or the first place.
 */
export default function SearchCombobox({ query, onQueryChange, venues, near, onPickVenue, onPickPlace }: SearchComboboxProps) {
  const uid = useId().replace(/:/g, "");
  const listId = `search-list-${uid}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const [enterPending, setEnterPending] = useState(false);

  const trimmed = query.trim();
  const open = focused && !dismissed && trimmed.length > 0;
  const venueRows = useMemo(() => (open ? rankVenues(venues, trimmed) : []), [open, venues, trimmed]);
  const { lookup, lookUpNow } = usePlaceSuggestions(trimmed, near, open);
  const placesFor = lookup.status === "done" && lookup.query === trimmed ? lookup.places : null;
  const options = useMemo(() => suggestionOrder(venueRows, placesFor ?? []), [venueRows, placesFor]);
  const showPlaces = wantsPlaces(trimmed);
  const activeOption = active >= 0 ? options[active] : undefined;

  // A new query starts with nothing highlighted.
  useEffect(() => {
    setActive(-1);
    setEnterPending(false);
  }, [trimmed]);

  const pick = useCallback(
    (s: Suggestion) => {
      setDismissed(true);
      setActive(-1);
      setEnterPending(false);
      // Done with typing: on phones this lowers the keyboard.
      inputRef.current?.blur();
      if (s.kind === "venue") onPickVenue(s.id);
      else onPickPlace({ name: s.name, lng: s.lng, lat: s.lat });
    },
    [onPickVenue, onPickPlace],
  );

  // Enter pressed before the places arrived: take the first one when they do.
  useEffect(() => {
    if (!enterPending || !placesFor) return;
    setEnterPending(false);
    if (placesFor[0]) pick(placesFor[0]);
  }, [enterPending, placesFor, pick]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (!trimmed) return;
        e.preventDefault();
        if (!open) {
          setDismissed(false);
          return;
        }
        setActive((i) => moveActive(i, options.length, e.key === "ArrowDown" ? 1 : -1));
        return;
      }
      case "Enter": {
        if (!trimmed) return;
        e.preventDefault();
        if (e.nativeEvent.isComposing) return;
        const target = open ? enterTarget(options, active) : null;
        if (target) {
          pick(target);
        } else if (showPlaces && !placesFor) {
          setDismissed(false);
          setEnterPending(true);
          lookUpNow();
        } else {
          setDismissed(false);
        }
        return;
      }
      case "Escape": {
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          setDismissed(true);
          setActive(-1);
        } else if (query) {
          e.preventDefault();
          onQueryChange("");
        }
        return;
      }
      case "Tab":
        setDismissed(true);
        return;
    }
  };

  // Keep the active row in view.
  useEffect(() => {
    if (!activeOption) return;
    document.getElementById(suggestionDomId(listId, activeOption))?.scrollIntoView({ block: "nearest" });
  }, [activeOption, listId]);

  // Fit the dropdown above the on-screen keyboard: the visual viewport is what
  // is left of the screen when the keyboard is up.
  const [maxHeight, setMaxHeight] = useState(360);
  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const vv = window.visualViewport;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      setMaxHeight(Math.max(132, Math.min(420, bottom - rect.bottom - 12)));
    };
    fit();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      vv?.removeEventListener("resize", fit);
      vv?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, [open]);

  const optionProps = (s: Suggestion) => {
    const index = options.indexOf(s);
    return {
      id: suggestionDomId(listId, s),
      role: "option" as const,
      "aria-selected": index === active,
      // Keep focus (and the phone keyboard) in the input.
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
      onMouseMove: () => index !== active && setActive(index),
      onClick: () => pick(s),
      className: cn(rowClass, index === active && "bg-accent text-accent-foreground"),
    };
  };

  const placeRow = (p: PlaceSuggestion) => (
    <div key={`p-${p.id}`} {...optionProps(p)}>
      <MapPin className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{p.name}</span>
        {p.context && <span className="block truncate text-xs text-muted-foreground">{p.context}</span>}
      </span>
    </div>
  );

  const summary = !open
    ? ""
    : suggestionSummary(venueRows.length, showPlaces ? (placesFor ? placesFor.length : null) : 0);

  return (
    <PopoverPrimitive.Root open={open}>
      <PopoverPrimitive.Anchor asChild>
        <div ref={anchorRef} className="relative w-full md:w-auto md:min-w-[280px]">
          <label htmlFor={`search-${uid}`} className="sr-only">
            Search venues and places
          </label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={inputRef}
            id={`search-${uid}`}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open && activeOption ? suggestionDomId(listId, activeOption) : undefined}
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Search venues or places…"
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setDismissed(false);
            }}
            onFocus={() => {
              setFocused(true);
              setDismissed(false);
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            className="h-11 rounded-full bg-card pl-10 pr-11 md:h-10"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          <span className="sr-only" role="status" aria-live="polite">
            {summary}
          </span>
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          role="presentation"
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={8}
          avoidCollisions={false}
          // Follow the input if the phone header moves under it.
          updatePositionStrategy="always"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
            else setDismissed(true);
          }}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[280px] max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border bg-popover p-0 text-popover-foreground shadow-lg outline-none"
        >
          <div
            id={listId}
            role="listbox"
            aria-label="Search suggestions"
            className="overflow-y-auto overscroll-contain p-1"
            style={{ maxHeight }}
          >
            {venueRows.length > 0 && (
              <div role="group" aria-labelledby={`${listId}-venues`}>
                <div id={`${listId}-venues`} className={headingClass} role="presentation">
                  Venues
                </div>
                {venueRows.map((v) => (
                  <div key={`v-${v.id}`} {...optionProps(v)}>
                    <Beer className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{v.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{v.address}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {showPlaces ? (
              <div role="group" aria-labelledby={`${listId}-places`} className={cn(venueRows.length > 0 && "mt-1 border-t pt-1")}>
                <div id={`${listId}-places`} className={headingClass} role="presentation">
                  Places
                </div>
                {placesFor ? (
                  placesFor.length > 0 ? (
                    placesFor.map(placeRow)
                  ) : (
                    <div className={statusRowClass} role="option" aria-disabled="true" aria-selected="false">
                      <SearchX className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                      No places found
                    </div>
                  )
                ) : lookup.status === "error" && lookup.query === trimmed ? (
                  <div className={statusRowClass} role="option" aria-disabled="true" aria-selected="false">
                    <SearchX className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    {lookup.message}
                  </div>
                ) : (
                  <div className={statusRowClass} role="option" aria-disabled="true" aria-selected="false">
                    <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" aria-hidden="true" />
                    Searching places…
                  </div>
                )}
              </div>
            ) : (
              venueRows.length === 0 && (
                <div className={statusRowClass} role="option" aria-disabled="true" aria-selected="false">
                  <SearchX className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  No venues match. Keep typing to search places.
                </div>
              )
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

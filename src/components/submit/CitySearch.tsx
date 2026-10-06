import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { searchCities, type CityResult } from "@/lib/city-search";

interface CitySearchProps {
  value: CityResult | null;
  onChange: (city: CityResult) => void;
  /** Bias ranking toward this coordinate (e.g. the user's location). */
  proximity?: { lng: number; lat: number };
  /** Restrict results to this ISO 3166-1 alpha-2 country (e.g. "CA"), if the form's country picker has a selection. */
  country?: string;
  id?: string;
}

/** Type-ahead city picker backed by the Mapbox geocode proxy. */
export function CitySearch({ value, onChange, proximity, country, id }: CitySearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CityResult[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  // Debounced search. Each run carries a sequence number so a slow earlier
  // request can't overwrite a newer one's results.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const found = await searchCities(q, proximity, country);
      if (mine === seq.current) {
        setResults(found);
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, proximity, country]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal min-h-[44px]"
        >
          {value ? (
            <span className="flex items-center gap-2 truncate">
              <MapPin className="h-4 w-4 shrink-0 opacity-60" />
              <span className="truncate">{value.label}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Search for a city…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        {/* shouldFilter=false: results are already filtered by Mapbox. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder="Type a city…" value={query} onValueChange={setQuery} />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            )}
            {!loading && query.trim().length >= 2 && results.length === 0 && (
              <CommandEmpty>No cities found.</CommandEmpty>
            )}
            {!loading && query.trim().length < 2 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Start typing to search
              </div>
            )}
            {results.length > 0 && (
              <CommandGroup>
                {results.map((r, i) => {
                  const isSelected = value?.lat === r.lat && value?.lng === r.lng;
                  return (
                    <CommandItem
                      key={`${r.lat},${r.lng},${i}`}
                      value={`${r.label}-${i}`}
                      onSelect={() => {
                        onChange(r);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")}
                      />
                      <span className="truncate">{r.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

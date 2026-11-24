import { useState } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CalendarIcon, Clock, Loader2, MapPin, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { VALID_TAGS } from "@/lib/constants";
import { formatClock } from "@/lib/format";
import { RADIUS_OPTIONS, formatDistanceRadius } from "@/lib/radius";

const TAG_OPTIONS = VALID_TAGS;

interface FiltersPanelProps {
  date: Date;
  onDateChange: (d: Date) => void;
  time: string;
  onTimeChange: (t: string) => void;
  /** The date/time filter is the present moment. */
  isNow: boolean;
  /** Put the date and time back to now. */
  onResetToNow: () => void;
  radius: number;
  onRadiusChange: (r: number) => void;
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onLocationSearch: (coords: { lng: number; lat: number }) => void;
  mapboxToken: string | undefined;
}

function isToday(d: Date): boolean {
  return d.toDateString() === new Date().toDateString();
}

const triggerClass = "gap-2 rounded-full bg-card coarse:h-11";

export default function FiltersPanel({
  date,
  onDateChange,
  time,
  onTimeChange,
  isNow,
  onResetToNow,
  radius,
  onRadiusChange,
  selectedTags,
  onTagsChange,
  searchQuery,
  onSearchQueryChange,
  onLocationSearch,
}: FiltersPanelProps) {
  const [geocoding, setGeocoding] = useState(false);
  const [radiusOpen, setRadiusOpen] = useState(false);
  const { toast } = useToast();

  const displayTime = formatClock(time);
  const dateLabel = isToday(date) ? "Today" : format(date, "EEE d MMM");

  const toggleTag = (tag: string) => {
    onTagsChange(
      selectedTags.includes(tag)
        ? selectedTags.filter((t) => t !== tag)
        : [...selectedTags, tag]
    );
  };

  const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && searchQuery) {
      onSearchQueryChange("");
      return;
    }
    if (e.key !== "Enter" || !searchQuery.trim()) return;
    // Enter looks the text up as a place and moves the search there.
    e.currentTarget.blur();
    setGeocoding(true);
    try {
      const res = await fetch(
        `/api/geocode?q=${encodeURIComponent(searchQuery.trim())}`
      );
      const geoData = await res.json();
      if (geoData.features?.length > 0) {
        const [lng, lat] = geoData.features[0].center;
        onLocationSearch({ lng, lat });
      } else {
        toast({ title: "Place not found", description: "Try a more specific address or city name.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Place search failed", description: "Check your connection and try again.", variant: "destructive" });
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search: filters venues by name/address as you type; Enter looks the
          text up as a place. */}
      <div className="relative w-full sm:w-auto sm:min-w-[240px]">
        <Label htmlFor="venue-search" className="sr-only">
          Search venues, or press Enter to find a place
        </Label>
        {geocoding ? (
          <Loader2 className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        )}
        <Input
          id="venue-search"
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Search venues or places…"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          className="h-10 rounded-full bg-card pl-10 pr-11 coarse:h-11"
          disabled={geocoding}
        />
        {searchQuery && !geocoding && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => onSearchQueryChange("")}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Date */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={triggerClass}
            aria-label={`Date: ${isToday(date) ? "today" : format(date, "EEEE d MMMM")}`}
          >
            <CalendarIcon className="h-4 w-4" aria-hidden="true" />
            {dateLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={date} onSelect={(d) => d && onDateChange(d)} />
        </PopoverContent>
      </Popover>

      {/* Time */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={triggerClass} aria-label={`Time: ${displayTime}`}>
            <Clock className="h-4 w-4" aria-hidden="true" />
            {displayTime}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <Label htmlFor="filter-time" className="mb-2 block text-xs text-muted-foreground">
            Show deals on at
          </Label>
          <Input
            id="filter-time"
            type="time"
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            className="w-[140px] coarse:h-11"
          />
        </PopoverContent>
      </Popover>

      {!isNow && (
        <Button variant="ghost" size="sm" className="rounded-full text-primary coarse:h-11" onClick={onResetToNow}>
          Back to now
        </Button>
      )}

      {/* Radius */}
      <Popover open={radiusOpen} onOpenChange={setRadiusOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={triggerClass}
            aria-label={`Distance: within ${formatDistanceRadius(radius)}`}
          >
            <MapPin className="h-4 w-4" aria-hidden="true" />
            {formatDistanceRadius(radius)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="flex gap-2" role="group" aria-label="Distance">
            {RADIUS_OPTIONS.map((value) => (
              <Chip
                key={value}
                size="sm"
                selected={radius === value}
                onClick={() => { onRadiusChange(value); setRadiusOpen(false); }}
              >
                {formatDistanceRadius(value)}
              </Chip>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Deal types */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Deal type">
        {TAG_OPTIONS.map((tag) => (
          <Chip
            key={tag}
            size="sm"
            selected={selectedTags.includes(tag)}
            className="capitalize"
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </Chip>
        ))}
      </div>
    </div>
  );
}

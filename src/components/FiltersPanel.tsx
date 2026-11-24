import { useState } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CalendarIcon, Clock, Loader2, MapPin, RotateCcw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
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
  /**
   * Today in the zone of the area being searched (a local Date whose getters
   * read that zone's clock), for the "Today"/"Tomorrow" labels.
   */
  today: Date;
  /** "Perth time" when the filter's zone (the area's) differs from the viewer's; else null. */
  zoneNote: string | null;
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

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function dayAfter(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

// Pills are 40px tall; the Button primitive's touch-target grows the hit area
// to 44px on touch screens.
const triggerClass = "h-10 flex-shrink-0 gap-1.5 rounded-full bg-card px-2.5 md:px-3.5";
// Rows that scroll sideways on phones: bleed to the screen edges, keep room
// above and below for the 44px hit areas (overflow-x clips them otherwise).
const scrollRowClass =
  "no-scrollbar -mx-4 flex flex-nowrap items-center overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0";

export default function FiltersPanel({
  date,
  onDateChange,
  time,
  onTimeChange,
  today,
  zoneNote,
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
  const isToday = sameDay(date, today);
  const isTomorrow = sameDay(date, dayAfter(today));
  const dateLabel = isToday ? "Today" : isTomorrow ? "Tomorrow" : format(date, "EEE d MMM");
  // Phones: "Sat 28" keeps the when/where row on one line with "Now" showing.
  const shortDateLabel = isToday || isTomorrow ? dateLabel : format(date, "EEE d");

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
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      {/* Search: filters venues by name/address as you type; Enter looks the
          text up as a place. */}
      <div className="relative w-full md:w-auto md:min-w-[240px]">
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
          className="h-11 rounded-full bg-card pl-10 pr-11 md:h-10"
          disabled={geocoding}
        />
        {searchQuery && !geocoding && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => onSearchQueryChange("")}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* When and where: one row, never wraps (scrolls sideways if it must). */}
      <div className={cn(scrollRowClass, "gap-1.5 py-0.5 -my-0.5 md:gap-2")} role="group" aria-label="When and how far">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={triggerClass}
              aria-label={`Date: ${isToday ? "today" : format(date, "EEEE d MMMM")}${zoneNote ? `, ${zoneNote}` : ""}`}
            >
              <CalendarIcon className="h-4 w-4" aria-hidden="true" />
              {shortDateLabel === dateLabel ? (
                dateLabel
              ) : (
                <>
                  <span className="md:hidden">{shortDateLabel}</span>
                  <span className="hidden md:inline">{dateLabel}</span>
                </>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={date} onSelect={(d) => d && onDateChange(d)} weekStartsOn={1} />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={triggerClass}
              aria-label={`Time: ${displayTime}${zoneNote ? `, ${zoneNote}` : ""}`}
            >
              <Clock className="h-4 w-4" aria-hidden="true" />
              {displayTime}
              {zoneNote && (
                <span className="text-xs font-normal text-muted-foreground" aria-hidden="true">
                  {zoneNote.replace(/ time$/, "")}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="start">
            <Label htmlFor="filter-time" className="mb-2 block text-xs text-muted-foreground">
              Show deals on at{zoneNote ? ` (${zoneNote})` : ""}
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

        {!isNow && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10 flex-shrink-0 gap-1 rounded-full px-2.5 text-primary"
            onClick={onResetToNow}
            aria-label="Back to now"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Now
          </Button>
        )}
      </div>

      {/* Deal types: one row on phones, scrolling sideways. */}
      <div className={cn(scrollRowClass, "gap-1.5 py-1.5 -my-1.5 md:flex-wrap")} role="group" aria-label="Deal type">
        {TAG_OPTIONS.map((tag) => (
          <Chip
            key={tag}
            size="sm"
            selected={selectedTags.includes(tag)}
            className="flex-shrink-0 capitalize"
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </Chip>
        ))}
      </div>
    </div>
  );
}

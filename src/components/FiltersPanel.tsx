import { useState } from "react";
import { format } from "date-fns";
import SearchCombobox from "@/components/SearchCombobox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CalendarIcon, Clock, LocateFixed, MapPin, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VALID_TAGS } from "@/lib/constants";
import { formatClock } from "@/lib/format";
import { RADIUS_OPTIONS, formatDistanceRadius } from "@/lib/radius";
import type { ChosenPlace } from "@/lib/url-state";

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
  /** Loaded venues, for the search box's suggestions. */
  searchVenues: { id: string; name: string; address: string; distance_meters?: number }[];
  /** A venue picked from the suggestions: open it. */
  onPickVenue: (id: string) => void;
  /** A place picked from the suggestions: search there. */
  onPickPlace: (place: ChosenPlace) => void;
  /** The place being searched around, shown as a removable chip. */
  place: ChosenPlace | null;
  onClearPlace: () => void;
  /** Where the list is searching now: place results near it rank first. */
  searchCentre: { lng: number; lat: number } | null;
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
  searchVenues,
  onPickVenue,
  onPickPlace,
  place,
  onClearPlace,
  searchCentre,
}: FiltersPanelProps) {
  const [radiusOpen, setRadiusOpen] = useState(false);

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

  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      {/* Search: venues (the text also filters the list as you type) and
          places, in one suggestions list. */}
      <SearchCombobox
        query={searchQuery}
        onQueryChange={onSearchQueryChange}
        venues={searchVenues}
        near={searchCentre}
        onPickVenue={onPickVenue}
        onPickPlace={onPickPlace}
      />

      {/* When and where: one row, never wraps (scrolls sideways if it must). */}
      <div className={cn(scrollRowClass, "gap-1.5 py-0.5 -my-0.5 md:gap-2")} role="group" aria-label="When and how far">
        {place && (
          <span className="flex h-10 max-w-[15rem] flex-shrink-0 items-center gap-1.5 rounded-full border border-primary bg-primary/10 pl-3 pr-1 text-sm font-medium text-foreground">
            <LocateFixed className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 truncate">Near {place.name}</span>
            <button
              type="button"
              onClick={onClearPlace}
              className="touch-target flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/15 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Stop searching near ${place.name}`}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
        )}
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

import { useState, useRef } from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, Clock, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { VALID_TAGS } from "@/lib/constants";

const RADIUS_OPTIONS = [
  { label: "1 km", value: 1000 },
  { label: "3 km", value: 3000 },
  { label: "5 km", value: 5000 },
  { label: "10 km", value: 10000 },
];

const TAG_OPTIONS = VALID_TAGS;

interface FiltersPanelProps {
  date: Date;
  onDateChange: (d: Date) => void;
  time: string;
  onTimeChange: (t: string) => void;
  radius: number;
  onRadiusChange: (r: number) => void;
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onLocationSearch: (coords: { lng: number; lat: number }) => void;
  mapboxToken: string | undefined;
}

export default function FiltersPanel({
  date,
  onDateChange,
  time,
  onTimeChange,
  radius,
  onRadiusChange,
  selectedTags,
  onTagsChange,
  searchQuery,
  onSearchQueryChange,
  onLocationSearch,
  mapboxToken,
}: FiltersPanelProps) {
  const [geocoding, setGeocoding] = useState(false);
  const [radiusOpen, setRadiusOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const { toast } = useToast();

  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const displayHour = h % 12 || 12;
  const displayTime = `${displayHour}:${String(m).padStart(2, "0")} ${ampm}`;
  const selectedRadiusLabel = RADIUS_OPTIONS.find((o) => o.value === radius)?.label ?? "5 km";

  const toggleTag = (tag: string) => {
    onTagsChange(
      selectedTags.includes(tag)
        ? selectedTags.filter((t) => t !== tag)
        : [...selectedTags, tag]
    );
  };

  const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !searchQuery.trim()) return;
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
        toast({ title: "Location not found", description: "Try a more specific address or city name.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Location search failed", description: "Check your connection and try again.", variant: "destructive" });
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative w-full sm:w-auto sm:min-w-[220px]">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search venues or locations…"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          className="pl-10 h-9 text-sm rounded-full bg-card"
          disabled={geocoding}
        />
      </div>

      {/* Date */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2 rounded-full bg-card">
            <CalendarIcon className="h-4 w-4" />
            {format(date, "MMM d")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={date} onSelect={(d) => d && onDateChange(d)} />
        </PopoverContent>
      </Popover>

      {/* Time */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2 rounded-full bg-card">
            <Clock className="h-4 w-4" />
            {displayTime}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <Input
            type="time"
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            className="w-[130px] h-9 text-sm"
          />
        </PopoverContent>
      </Popover>

      {/* Radius */}
      <Popover open={radiusOpen} onOpenChange={setRadiusOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2 rounded-full bg-card">
            <MapPin className="h-4 w-4" />
            {selectedRadiusLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="flex gap-1">
            {RADIUS_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant={radius === opt.value ? "default" : "outline"}
                className="h-8 px-2.5 text-xs"
                onClick={() => { onRadiusChange(opt.value); setRadiusOpen(false); }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Tags */}
      <div className="flex gap-1.5">
        {TAG_OPTIONS.map((tag) => (
          <Badge
            key={tag}
            variant={selectedTags.includes(tag) ? "default" : "outline"}
            className={cn(
              "cursor-pointer capitalize transition-colors",
              selectedTags.includes(tag) ? "bg-primary text-primary-foreground" : "bg-card"
            )}
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </Badge>
        ))}
      </div>
    </div>
  );
}

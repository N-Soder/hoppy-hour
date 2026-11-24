import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { supportedTimeZones } from "@/lib/zoned-time";

interface TimeZonePickerProps {
  /** IANA zone, or null when none is set. */
  value: string | null;
  onChange: (zone: string) => void;
  id?: string;
  "aria-describedby"?: string;
}

/** Searchable picker over the browser's IANA time zones (Intl.supportedValuesOf). */
export function TimeZonePicker({ value, onChange, id, ...rest }: TimeZonePickerProps) {
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => supportedTimeZones(value), [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-describedby={rest["aria-describedby"]}
          className="min-h-[44px] w-full justify-between font-normal"
        >
          {value ? <span className="truncate">{value.replace(/_/g, " ")}</span> : <span className="text-muted-foreground">Not set</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search time zones, e.g. Perth…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Time zone"
          />
          <CommandList>
            <CommandEmpty>No time zone found.</CommandEmpty>
            <CommandGroup>
              {zones.map((zone) => (
                <CommandItem
                  key={zone}
                  // Match on the name with spaces too, so "new york" finds America/New_York.
                  value={`${zone} ${zone.replace(/_/g, " ")}`}
                  onSelect={() => {
                    onChange(zone);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === zone ? "opacity-100" : "opacity-0")} />
                  {zone.replace(/_/g, " ")}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

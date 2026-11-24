import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
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
import { COUNTRIES, countryByCode } from "@/lib/countries";

interface CountryPickerProps {
  value: string | null;
  onChange: (code: string) => void;
  id?: string;
  /** Mark the empty picker as needing a value (a warning, not a block). */
  needsValue?: boolean;
  /** Id of the text that explains the warning. */
  "aria-describedby"?: string;
}

/** Searchable country picker over the bundled ISO 3166-1 list. */
export function CountryPicker({ value, onChange, id, needsValue, "aria-describedby": describedBy }: CountryPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = countryByCode(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-describedby={describedBy}
          className={cn(
            "w-full justify-between font-normal min-h-[44px]",
            needsValue && !selected && "border-amber-500 dark:border-amber-500",
          )}
        >
          {selected ? (
            <span className="flex items-center gap-2">
              <span aria-hidden>{selected.flag}</span>
              {selected.name}
            </span>
          ) : (
            <span className={needsValue ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground"}>
              {needsValue ? "No country set: select one" : "Select country"}
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search country…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="words"
            spellCheck={false}
            aria-label="Country"
          />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {COUNTRIES.map((c) => (
                <CommandItem
                  key={c.code}
                  // cmdk matches against this value; include name + code so
                  // "bulgaria" and "bg" both find it.
                  value={`${c.name} ${c.code}`}
                  onSelect={() => {
                    onChange(c.code);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === c.code ? "opacity-100" : "opacity-0")}
                  />
                  <span className="mr-2" aria-hidden>{c.flag}</span>
                  {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

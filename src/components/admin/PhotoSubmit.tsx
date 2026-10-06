import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isAuthError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Loader2, MapPin, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { compressImage, blobToBase64 } from "@/lib/image-compress";
import { CountryPicker } from "@/components/submit/CountryPicker";
import { CitySearch } from "@/components/submit/CitySearch";
import type { CityResult } from "@/lib/city-search";
import { DAYS_SHORT } from "@/lib/constants";
import type { Submission, FromImageInput } from "@/lib/api-types";

/**
 * Snap-a-Deal: photograph (or upload a screenshot of) a happy-hour menu and
 * let a cheap vision model pre-fill a pending submission for review.
 *
 * Everything besides the photo is optional. Location comes from either the
 * device's position ("I'm at the venue right now") or the picked city's
 * coordinates — the same source the public submit form uses — with device GPS
 * winning when both are set. Mobile photo pickers strip GPS metadata from the
 * image itself before websites ever see it, so there is deliberately no
 * "location from the photo" option. The canvas re-encode in compressImage
 * strips the remaining metadata from the upload as a matter of course.
 */
export default function PhotoSubmit({ onReview }: { onReview?: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deviceCoords, setDeviceCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  // Optional context — anything left blank gets filled in during review.
  const [venueName, setVenueName] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<CityResult | null>(null);
  const [result, setResult] = useState<{ submission: Submission; notes: string | null } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const pickFile = (f: File | null) => {
    setResult(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  };

  const handleCityChange = (city: CityResult) => {
    setSelectedCity(city);
    if (city.countryCode) setCountry(city.countryCode);
  };

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      toast({ title: "Geolocation is not available in this browser", variant: "destructive" });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDeviceCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast({
          title: "Couldn't get your location",
          description: "No problem — pick the city below, or sort it out during review.",
        });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Pick a photo first");
      const compressed = await compressImage(file);
      // Device GPS is venue-precise; the picked city's coordinates are the
      // same coarse pin the public form produces. GPS wins when both exist.
      const coords =
        deviceCoords ?? (selectedCity ? { lat: selectedCity.lat, lng: selectedCity.lng } : null);
      const body: FromImageInput = {
        image_base64: await blobToBase64(compressed.blob),
        media_type: compressed.mediaType,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        venue_name: venueName.trim() || null,
        city: selectedCity?.city ?? null,
        country: country ?? null,
      };
      return api.post<{ submission: Submission; notes: string | null }>(
        "/api/admin/submissions/from-image",
        body,
      );
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["admin_submissions"] });
      toast({ title: "Deal extracted", description: "It's in the pending queue for review." });
    },
    onError: (err: Error) => {
      toast({
        title: "Upload failed",
        description: isAuthError(err)
          ? "Your admin session expired — reload the page to sign in again."
          : err.message,
        variant: "destructive",
      });
    },
  });

  const snapAnother = () => {
    pickFile(null);
    setResult(null);
    // Venue name is per-deal; city/country/location usually carry over to the
    // next snap in the same session, so keep them.
    setVenueName("");
  };

  const dealsOf = (sub: Submission) => [
    {
      days_of_week: sub.days_of_week,
      start_time: sub.start_time,
      end_time: sub.end_time,
      description: sub.description,
      tags: sub.tags,
    },
    ...(sub.extra_deals ?? []),
  ];

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Camera className="h-4 w-4" /> Snap a Deal
          </CardTitle>
          <CardDescription>
            Photograph a happy hour menu, chalkboard, or screenshot. A vision model pre-fills a
            pending submission — nothing goes live without review.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />

          {previewUrl ? (
            <div className="relative">
              <img
                src={previewUrl}
                alt="Selected menu"
                className="max-h-72 w-full rounded-md border border-border object-contain bg-muted/40"
              />
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute top-2 right-2 h-7 w-7"
                onClick={() => pickFile(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded-md border border-dashed border-border py-10 text-sm text-muted-foreground hover:bg-accent transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="h-6 w-6 mx-auto mb-2" />
              Take a photo or choose an image
            </button>
          )}

          {/* Optional context — mirrors the public submit form's pickers. */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="snap-venue">
                Venue name <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="snap-venue"
                placeholder="e.g. The Crown Hotel"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Overrides whatever the model reads off the menu — leave blank to let it try.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="snap-country">
                  Country <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <CountryPicker id="snap-country" value={country} onChange={setCountry} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="snap-city">
                  City <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <CitySearch
                  id="snap-city"
                  value={selectedCity}
                  onChange={handleCityChange}
                  proximity={deviceCoords ? { lng: deviceCoords.lng, lat: deviceCoords.lat } : undefined}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={deviceCoords ? "secondary" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={useMyLocation}
              disabled={locating}
            >
              {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
              I'm at the venue — use my location
            </Button>
            {deviceCoords && (
              <Badge variant="secondary" className="font-mono text-xs gap-1">
                ✓ {deviceCoords.lat.toFixed(4)}, {deviceCoords.lng.toFixed(4)}
                <button onClick={() => setDeviceCoords(null)} aria-label="Clear location">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            This records where you are <em>right now</em> — use it only while standing at the venue.
            Uploading photos later? Pick the city above instead. Everything is optional and can be
            fixed during review.
          </p>

          <Button
            className="w-full gap-1.5"
            disabled={!file || upload.isPending}
            onClick={() => upload.mutate()}
          >
            {upload.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {upload.isPending ? "Compressing & extracting…" : "Extract deal from photo"}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" /> Extracted — pending review
            </CardTitle>
            <CardDescription>{result.submission.venue_name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="divide-y divide-dashed divide-border">
              {dealsOf(result.submission).map((deal, i) => (
                <div key={i} className="space-y-1.5 py-2 first:pt-0 last:pb-0">
                  <p className="text-sm">{deal.description || <em className="text-muted-foreground">No description read — check the photo in review</em>}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {deal.days_of_week.map((d) => (
                      <Badge key={d} variant="secondary" className="text-xs">{DAYS_SHORT[d]}</Badge>
                    ))}
                    <span className="text-xs text-muted-foreground ml-1">
                      {deal.start_time.slice(0, 5)} – {deal.end_time.slice(0, 5)}
                    </span>
                    {deal.tags?.map((t) => (
                      <Badge key={t} variant="outline" className="text-xs capitalize">{t}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {result.notes && (
              <p className="text-xs rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 p-2">
                Model notes: {result.notes}
              </p>
            )}
            <div className="flex gap-2">
              {onReview && (
                <Button size="sm" onClick={onReview}>Review now</Button>
              )}
              <Button size="sm" variant="outline" onClick={snapAnother}>
                Snap another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

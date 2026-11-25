import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle, ImageUp, Info, Loader2, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { blobToBase64, compressImage } from "@/lib/image-compress";
import { isHeic, MAX_PHOTO_BYTES } from "@/lib/photo-prefill";
import { PHOTO_ERRORS, type MenuPhotoInput, type MenuPhotoResult } from "@/lib/api-types";

type Status =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "attached"; previewUrl: string }
  | { kind: "message"; tone: "info" | "error"; text: string };

const MESSAGES = {
  notFound: "Couldn't find a deal in that photo. You can type it in below instead.",
  paused:
    "Reading photos is paused until tomorrow — it's been a busy day. You can still type the deal in below.",
  limited:
    "That's a lot of photos for now — try again later, or type the deal in below.",
  unavailable: "Photo reading is unavailable right now — please type the deal in below.",
  heic:
    "That photo is in HEIC format, which this browser can't open. Try a screenshot of the menu, or a JPEG or PNG.",
  unreadable: "We couldn't open that image. Try another photo, or type the deal in below.",
  tooLarge: "That image is too large to send. Try a screenshot of the menu instead.",
  check: "The security check didn't go through. Give it another go.",
  offline: "You're offline, so the photo wasn't sent. Try again when you're back online.",
  failed: "Something went wrong reading that photo. Try again, or type the deal in below.",
} as const;

interface SnapMenuProps {
  /** Mint a fresh Turnstile token (one per request — tokens are single-use). */
  getToken: () => Promise<string>;
  /** Current honeypot value from the form; bots that fill it get "nothing found". */
  getHoneypot: () => string;
  /** A read found at least one deal: pre-fill the form and keep the upload_id. */
  onRead: (result: MenuPhotoResult) => void;
  /** The person removed the attached photo. */
  onRemove: () => void;
  /** Whether the parent still holds an upload_id (cleared e.g. when it expired). */
  attached: boolean;
  /** Lets the parent keep its own submit (and Turnstile widget) idle meanwhile. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

/**
 * "Snap a menu" on the public submit form: take or choose a photo of a
 * happy-hour menu, have it read, and pre-fill the form below. The photo is
 * re-encoded through a canvas first (compressImage), which drops EXIF and any
 * embedded GPS before it leaves the device.
 */
export function SnapMenu({ getToken, getHoneypot, onRead, onRemove, attached, onBusyChange, disabled }: SnapMenuProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // A read takes seconds; hand the result to the parent's current handler, not
  // the one from the render that started it.
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  });

  // Free the preview when it's replaced or the component goes away.
  const previewUrl = status.kind === "attached" ? status.previewUrl : null;
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // The parent dropped the upload (expired, or a fresh form): back to the start.
  useEffect(() => {
    if (!attached && status.kind === "attached") setStatus({ kind: "idle" });
  }, [attached, status.kind]);

  const busy = status.kind === "reading";
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  const show = (tone: "info" | "error", text: string) => setStatus({ kind: "message", tone, text });

  const readPhoto = async (file: File) => {
    if (!navigator.onLine) return show("error", MESSAGES.offline);
    setStatus({ kind: "reading" });

    let compressed;
    try {
      compressed = await compressImage(file);
    } catch {
      return show("error", isHeic(file) ? MESSAGES.heic : MESSAGES.unreadable);
    }
    if (compressed.blob.size > MAX_PHOTO_BYTES) return show("error", MESSAGES.tooLarge);

    let token: string;
    try {
      token = await getToken();
    } catch {
      return show("error", navigator.onLine ? MESSAGES.check : MESSAGES.offline);
    }

    try {
      const body: MenuPhotoInput = {
        image_base64: await blobToBase64(compressed.blob),
        media_type: compressed.mediaType,
        turnstile_token: token,
        honeypot: getHoneypot(),
      };
      const result = await api.post<MenuPhotoResult>("/api/menu-photo", body);
      if (!result.found || !result.upload_id) return show("info", MESSAGES.notFound);
      onReadRef.current(result);
      setStatus({ kind: "attached", previewUrl: URL.createObjectURL(compressed.blob) });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const message = err instanceof ApiError ? err.message : "";
      if (status === 0) return show("error", navigator.onLine ? MESSAGES.failed : MESSAGES.offline);
      if (message === PHOTO_ERRORS.paused) return show("info", MESSAGES.paused);
      if (message === PHOTO_ERRORS.rateLimited) return show("info", MESSAGES.limited);
      if (message === PHOTO_ERRORS.unavailable) return show("info", MESSAGES.unavailable);
      if (status === 403) return show("error", MESSAGES.check);
      if (status === 413) return show("error", MESSAGES.tooLarge);
      if (status === 400 || status === 415) return show("error", MESSAGES.unreadable);
      return show("error", MESSAGES.failed);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires a change.
    e.target.value = "";
    if (file) void readPhoto(file);
  };

  const remove = () => {
    setStatus({ kind: "idle" });
    onRemove();
  };

  return (
    <section
      aria-labelledby="snap-menu-title"
      className="rounded-xl border border-border bg-muted/40 p-4 space-y-3"
    >
      <div className="space-y-1">
        <h2 id="snap-menu-title" className="flex items-center gap-2 text-base font-semibold">
          <Camera className="h-4 w-4 text-primary" aria-hidden="true" />
          Snap a menu
        </h2>
        <p className="text-sm text-muted-foreground">
          Got a photo of the deals? We'll read it and fill in the form for you to check.
        </p>
      </div>

      {/* Camera (rear-facing on phones) and gallery are separate inputs: a
          `capture` input skips the gallery on most phones. */}
      <input
        ref={cameraRef}
        id="snap-menu-camera"
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onPick}
      />
      <input
        ref={galleryRef}
        id="snap-menu-gallery"
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onPick}
      />

      {status.kind === "attached" ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background p-2">
          <img
            src={status.previewUrl}
            alt="Your menu photo"
            className="h-12 w-12 shrink-0 rounded-md object-cover"
          />
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
            <CheckCircle className="h-4 w-4 shrink-0 text-[hsl(var(--happy))]" aria-hidden="true" />
            <span>Photo attached</span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 shrink-0 gap-1 px-2"
            onClick={remove}
            disabled={disabled}
            aria-label="Remove photo"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Remove</span>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] gap-2"
            onClick={() => cameraRef.current?.click()}
            disabled={disabled || busy}
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            Take a photo
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] gap-2"
            onClick={() => galleryRef.current?.click()}
            disabled={disabled || busy}
          >
            <ImageUp className="h-4 w-4" aria-hidden="true" />
            Choose a photo
          </Button>
        </div>
      )}

      {/* Progress and outcome, announced to screen readers as they change. */}
      <div role="status" aria-live="polite" className="text-sm empty:sr-only">
        {status.kind === "reading" && (
          <p className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading your photo…
          </p>
        )}
        {status.kind === "attached" && (
          <p className="flex items-start gap-2 rounded-md bg-primary/10 p-2.5 text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>Check the details — we read these from your photo.</span>
          </p>
        )}
        {status.kind === "message" && (
          <p
            className={
              status.tone === "error"
                ? "flex items-start gap-2 text-destructive-text"
                : "flex items-start gap-2 text-foreground"
            }
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{status.text}</span>
          </p>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
        Photos are only seen by our reviewers.
      </p>
    </section>
  );
}

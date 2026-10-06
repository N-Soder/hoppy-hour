import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isAuthError } from "@/lib/api";
import type { Venue } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Pencil, Loader2, Search, MapPin, ExternalLink, Trash2, Plus } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import HappyHourManager from "./HappyHourManager";
import { useToast } from "@/hooks/use-toast";
import { geocodeAddress } from "@/lib/geocode";

type VenueCountry = "AU" | "NZ" | "US" | "GB" | "CA";

const COUNTRY_OPTIONS: { value: VenueCountry; label: string }[] = [
  { value: "AU", label: "Australia" },
  { value: "NZ", label: "New Zealand" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "CA", label: "Canada" },
];

type VenueForm = {
  name: string;
  address: string;
  country: VenueCountry | "";
  lat: number | null;
  lng: number | null;
};

const emptyForm: VenueForm = { name: "", address: "", country: "", lat: null, lng: null };

export default function VenueManager() {
  const [search, setSearch] = useState("");
  const [editVenue, setEditVenue] = useState<Venue | null>(null);
  const [formData, setFormData] = useState<VenueForm>(emptyForm);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [deleteVenue, setDeleteVenue] = useState<Venue | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleMutationError = (err: unknown) => {
    toast({
      title: isAuthError(err)
        ? "Your admin session expired — reload to sign in again"
        : err instanceof Error
          ? err.message
          : "Something went wrong",
      variant: "destructive",
    });
  };

  const { data: venues = [], isLoading } = useQuery({
    queryKey: ["admin_venues"],
    queryFn: async () => {
      const { venues } = await api.get<{ venues: Venue[] }>("/api/admin/venues");
      return venues;
    },
  });

  const filtered = venues.filter(
    (v) =>
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.address.toLowerCase().includes(search.toLowerCase())
  );

  const updateVenue = useMutation({
    mutationFn: async ({ id, lat, lng, ...updates }: Partial<VenueForm> & { id: string; lat?: number | null; lng?: number | null }) => {
      await api.put(`/api/admin/venues/${id}`, {
        name: updates.name,
        address: updates.address,
        country: updates.country || null,
        ...(lat != null && lng != null ? { lat, lng } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_venues"] });
      toast({ title: "Venue updated" });
      closeDialog();
    },
    onError: handleMutationError,
  });

  const createVenue = useMutation({
    mutationFn: async (form: VenueForm) => {
      await api.post<{ id: string }>("/api/admin/venues", {
        name: form.name,
        address: form.address,
        country: form.country || null,
        lat: form.lat,
        lng: form.lng,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_venues"] });
      toast({ title: "Venue created" });
      closeDialog();
    },
    onError: handleMutationError,
  });

  const deleteVenueMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.del(`/api/admin/venues/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_venues"] });
      toast({ title: "Venue deleted" });
      setDeleteVenue(null);
    },
    onError: handleMutationError,
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const newStatus = status === "active" ? "inactive" : "active";
      await api.put(`/api/admin/venues/${id}`, { status: newStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_venues"] });
    },
    onError: handleMutationError,
  });

  const openEdit = (venue: Venue) => {
    setEditVenue(venue);
    setFormData({
      name: venue.name,
      address: venue.address,
      country: (venue.country as VenueCountry) ?? "",
      lat: null,
      lng: null,
    });
    setDialogOpen(true);
  };

  const openAdd = () => {
    setEditVenue(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditVenue(null);
    setFormData(emptyForm);
  };

  const handleGeocode = async () => {
    const address = formData.address.trim();
    if (!address) return;
    setIsGeocoding(true);
    try {
      const { coords } = await geocodeAddress(formData.name, address);
      if (coords) {
        const { lat, lng } = coords;
        setFormData((f) => ({ ...f, lng, lat }));
        toast({ title: "Coordinates found", description: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
      } else {
        toast({ title: "No results", description: "Mapbox couldn't find that address — check it includes suburb and state.", variant: "destructive" });
      }
    } catch (err) {
      const isApiError = err instanceof Error && err.message.startsWith("Mapbox error:");
      toast({
        title: isApiError ? "Mapbox configuration error" : "Geocoding failed",
        description: isApiError
          ? `${(err as Error).message} — check MAPBOX_ACCESS_TOKEN in the Cloudflare Pages settings.`
          : "Network error. Try again.",
        variant: "destructive",
      });
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleSave = () => {
    if (editVenue) {
      updateVenue.mutate({
        id: editVenue.id,
        name: formData.name,
        address: formData.address,
        country: formData.country,
        lat: formData.lat,
        lng: formData.lng,
      });
    } else {
      createVenue.mutate(formData);
    }
  };

  const isSaving = updateVenue.isPending || createVenue.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search venues…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="secondary">{venues.length} venues</Badge>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1" /> Add Venue
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((venue) => (
                <TableRow key={venue.id}>
                  <TableCell className="font-medium">{venue.name}</TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                    {venue.address}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={venue.status === "active" ? "default" : "secondary"}
                      className="cursor-pointer"
                      onClick={() => toggleStatus.mutate({ id: venue.id, status: venue.status })}
                    >
                      {venue.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(venue)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteVenue(venue)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No venues found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editVenue ? "Edit Venue" : "Add Venue"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={formData.name} onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  value={formData.address}
                  onChange={(e) => setFormData((f) => ({ ...f, address: e.target.value, lat: null, lng: null }))}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGeocode}
                  disabled={isGeocoding || !formData.address.trim()}
                  className="shrink-0"
                >
                  {isGeocoding ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                  <span className="ml-1 hidden sm:inline">Re-geocode</span>
                </Button>
              </div>
              {formData.lat != null && formData.lng != null && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {formData.lat.toFixed(5)}, {formData.lng.toFixed(5)}
                  </Badge>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${formData.lat},${formData.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Verify on Maps <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Country</Label>
              <Select
                value={formData.country}
                onValueChange={(v) => setFormData((f) => ({ ...f, country: v as VenueCountry }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select country…" />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center pt-2">
            {!editVenue && formData.lat === null && formData.address.trim() && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex-1">
                Geocode the address so this venue appears on the map.
              </p>
            )}
            <div className="flex gap-2 w-full sm:w-auto justify-end">
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || !formData.name.trim() || !formData.address.trim() || (!editVenue && formData.lat === null)}
              >
                {isSaving ? "Saving…" : editVenue ? "Save Changes" : "Create Venue"}
              </Button>
            </div>
          </div>

          {editVenue && <HappyHourManager venueId={editVenue.id} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteVenue} onOpenChange={(open) => !open && setDeleteVenue(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete venue?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteVenue?.name}</strong> and all its associated hoppy hours. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteVenue && deleteVenueMutation.mutate(deleteVenue.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteVenueMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

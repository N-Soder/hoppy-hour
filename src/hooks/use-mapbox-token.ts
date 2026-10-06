import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useMapboxToken() {
  return useQuery({
    queryKey: ["mapbox-token"],
    queryFn: async () => {
      const data = await api.get<{ token: string }>("/api/mapbox-token");
      return data.token;
    },
    staleTime: 1000 * 60 * 60, // cache for 1 hour
    retry: 2,
  });
}

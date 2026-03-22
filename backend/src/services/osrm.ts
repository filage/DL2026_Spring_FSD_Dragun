import { z } from "zod";

const OsrmRouteSchema = z.object({
  distance: z.number(),
  duration: z.number(),
  geometry: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number(), z.number()]))
  })
});

const OsrmResponseSchema = z.object({
  code: z.string(),
  routes: z.array(OsrmRouteSchema)
});

export async function osrmRoute(params: {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  mode: "walking" | "driving" | "cycling";
}) {
  const profile = params.mode === "walking" ? "foot" : params.mode === "cycling" ? "bike" : "car";

  const url = new URL(
    `https://router.project-osrm.org/route/v1/${profile}/${params.fromLng},${params.fromLat};${params.toLng},${params.toLat}`
  );
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("alternatives", "false");

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  const r = await fetch(url, { signal: ac.signal });
  clearTimeout(t);
  if (!r.ok) {
    throw new Error(`OSRM failed: ${r.status} ${r.statusText}`);
  }

  const json = await r.json();
  const parsed = OsrmResponseSchema.parse(json);
  const best = parsed.routes[0];
  if (!best) throw new Error("No routes returned by OSRM");

  return best;
}

import { z } from "zod";

const MapboxGeocodingResponseSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      geometry: z.object({
        type: z.literal("Point"),
        coordinates: z.tuple([z.number(), z.number()])
      }),
      properties: z.object({
        mapbox_id: z.string(),
        name: z.string(),
        full_address: z.string().optional().nullable()
      })
    })
  )
});

const MapboxRetrieveResponseSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      geometry: z.object({
        type: z.literal("Point"),
        coordinates: z.tuple([z.number(), z.number()])
      }),
      properties: z.record(z.unknown())
    })
  )
});

const MapboxDirectionsResponseSchema = z.object({
  routes: z.array(
    z.object({
      distance: z.number(),
      duration: z.number(),
      geometry: z.unknown()
    })
  )
});

function getToken() {
  const token = process.env["MAPBOX_ACCESS_TOKEN"];
  if (!token) throw new Error("MAPBOX_ACCESS_TOKEN is not set");
  return token;
}

export async function mapboxGeocodingNearby(params: {
  lat: number;
  lng: number;
  radius: number;
  limit: number;
  query: string;
}) {
  const token = getToken();

  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", params.query);
  url.searchParams.set("proximity", `${params.lng},${params.lat}`);
  url.searchParams.set("limit", String(params.limit));
  url.searchParams.set("types", "poi");
  url.searchParams.set("access_token", token);

  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Mapbox geocoding failed: ${r.status} ${r.statusText}`);
  }

  const json = await r.json();
  return MapboxGeocodingResponseSchema.parse(json);
}

export async function mapboxRetrievePlace(mapboxId: string) {
  const token = getToken();

  const url = new URL(
    `https://api.mapbox.com/search/geocode/v6/retrieve/${encodeURIComponent(mapboxId)}`
  );
  url.searchParams.set("access_token", token);

  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Mapbox retrieve failed: ${r.status} ${r.statusText}`);
  }

  const json = await r.json();
  return MapboxRetrieveResponseSchema.parse(json);
}

export async function mapboxDirections(params: {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  mode: "walking" | "driving" | "cycling";
}) {
  const token = getToken();

  const profile = params.mode === "cycling" ? "cycling" : params.mode;

  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${params.fromLng},${params.fromLat};${params.toLng},${params.toLat}`
  );
  url.searchParams.set("access_token", token);
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");

  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Mapbox directions failed: ${r.status} ${r.statusText}`);
  }

  const json = await r.json();
  const parsed = MapboxDirectionsResponseSchema.parse(json);

  const best = parsed.routes[0];
  if (!best) throw new Error("No routes returned by Mapbox");

  return best;
}

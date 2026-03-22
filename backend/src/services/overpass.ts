import { z } from "zod";

const OverpassElementSchema = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number().int().positive(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z
    .object({
      lat: z.number(),
      lon: z.number()
    })
    .optional(),
  tags: z.record(z.string(), z.string()).optional()
});

const OverpassResponseSchema = z.object({
  elements: z.array(OverpassElementSchema)
});

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter"
];

const OVERPASS_MAX_CONCURRENCY = 2;
let overpassActive = 0;
const overpassWaiters: Array<() => void> = [];

async function withOverpassSemaphore<T>(fn: () => Promise<T>): Promise<T> {
  if (overpassActive >= OVERPASS_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => overpassWaiters.push(resolve));
  }
  overpassActive += 1;
  try {
    return await fn();
  } finally {
    overpassActive -= 1;
    const next = overpassWaiters.shift();
    if (next) next();
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function getCenter(el: z.infer<typeof OverpassElementSchema>): { lat: number; lng: number } | null {
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center) {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

function buildAddress(tags: Record<string, string> | undefined): string | null {
  if (!tags) return null;
  const full = tags["addr:full"];
  if (full) return full;

  const street = tags["addr:street"];
  const house = tags["addr:housenumber"];
  const city = tags["addr:city"];

  const parts = [
    street ? `${street}${house ? `, ${house}` : ""}` : null,
    city ?? null
  ].filter(Boolean) as string[];

  return parts.length ? parts.join(", ") : null;
}

const CategoryToOverpass: Record<
  "cafe" | "museum" | "park" | "attraction",
  string
> = {
  cafe: 'node["amenity"="cafe"](around:{R},{LAT},{LNG});way["amenity"="cafe"](around:{R},{LAT},{LNG});relation["amenity"="cafe"](around:{R},{LAT},{LNG});',
  museum:
    'node["tourism"="museum"](around:{R},{LAT},{LNG});way["tourism"="museum"](around:{R},{LAT},{LNG});relation["tourism"="museum"](around:{R},{LAT},{LNG});',
  park:
    'node["leisure"="park"](around:{R},{LAT},{LNG});way["leisure"="park"](around:{R},{LAT},{LNG});relation["leisure"="park"](around:{R},{LAT},{LNG});',
  attraction:
    'node["tourism"="attraction"](around:{R},{LAT},{LNG});way["tourism"="attraction"](around:{R},{LAT},{LNG});relation["tourism"="attraction"](around:{R},{LAT},{LNG});'
};

export type OverpassPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  description: string | null;
  wikipedia: string | null;
  website: string | null;
  raw: unknown;
};

export async function overpassNearby(params: {
  lat: number;
  lng: number;
  radius: number;
  category: "cafe" | "museum" | "park" | "attraction";
  limit: number;
}): Promise<OverpassPlace[]> {
  const template = CategoryToOverpass[params.category];

  const queryBody = template
    .replaceAll("{R}", String(params.radius))
    .replaceAll("{LAT}", String(params.lat))
    .replaceAll("{LNG}", String(params.lng));

  const q = `[out:json][timeout:25];( ${queryBody} );out center ${params.limit};`;

  const { json, lastErr } = await withOverpassSemaphore(async () => {
    let lastErr: unknown = null;
    let json: unknown = null;

    const endpoints = shuffle(OVERPASS_ENDPOINTS);
    for (const endpoint of endpoints) {
      const url = new URL(endpoint);

      // Retry transient network errors per endpoint.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 30_000);
          const r = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              accept: "application/json,text/plain,*/*",
              "user-agent": "GeoGuide/1.0"
            },
            body: new URLSearchParams({ data: q }).toString(),
            signal: ac.signal
          });
          clearTimeout(t);

          if (!r.ok) {
            const body = await r.text().catch(() => "");
            const snippet = body ? `: ${body.slice(0, 200)}` : "";
            lastErr = new Error(`Overpass failed (${endpoint}): ${r.status} ${r.statusText}${snippet}`);

            // For rate limits / overload - try another endpoint.
            break;
          }

          json = await r.json();
          return { json, lastErr };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown error";
          lastErr = new Error(`Overpass fetch failed (${endpoint}): ${msg}`);

          // Small backoff, then retry same endpoint once.
          if (attempt === 0) await sleep(250);
          continue;
        }
      }
    }

    return { json, lastErr };
  });

  if (json == null) {
    if (lastErr instanceof DOMException && lastErr.name === "AbortError") {
      throw new Error("Overpass timeout");
    }
    const msg = lastErr instanceof Error ? lastErr.message : "Unknown error";
    throw new Error(`Overpass failed: ${msg}`);
  }

  const parsed = OverpassResponseSchema.parse(json);

  const places: OverpassPlace[] = [];

  for (const el of parsed.elements) {
    const center = getCenter(el);
    if (!center) continue;
    const name = el.tags?.name;
    if (!name) continue;

    const description = el.tags?.description ?? null;
    const wikipedia = el.tags?.wikipedia ?? null;
    const website = el.tags?.website ?? null;

    places.push({
      id: `osm:${el.type}/${el.id}`,
      name,
      lat: center.lat,
      lng: center.lng,
      address: buildAddress(el.tags),
      description,
      wikipedia,
      website,
      raw: el
    });

    if (places.length >= params.limit) break;
  }

  return places;
}

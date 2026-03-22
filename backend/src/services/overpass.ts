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

  const q = `[out:json][timeout:25];( ${queryBody} );out center tags ${params.limit};`;

  const url = new URL("https://overpass-api.de/api/interpreter");

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ data: q }).toString()
  });

  if (!r.ok) {
    throw new Error(`Overpass failed: ${r.status} ${r.statusText}`);
  }

  const json = await r.json();
  const parsed = OverpassResponseSchema.parse(json);

  const places: OverpassPlace[] = [];

  for (const el of parsed.elements) {
    const center = getCenter(el);
    if (!center) continue;
    const name = el.tags?.name;
    if (!name) continue;

    places.push({
      id: `osm:${el.type}/${el.id}`,
      name,
      lat: center.lat,
      lng: center.lng,
      address: buildAddress(el.tags),
      raw: el
    });

    if (places.length >= params.limit) break;
  }

  return places;
}

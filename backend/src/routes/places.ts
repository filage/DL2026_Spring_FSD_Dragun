import { Router } from "express";
import { z } from "zod";

import { mapboxGeocodingNearby, mapboxRetrievePlace } from "../services/mapbox";
import { prisma } from "../db/prisma";
import { haversineMeters } from "../utils/geo";

export const placesRouter = Router();

const NearbyQuerySchema = z.object({
  lat: z.coerce.number().finite(),
  lng: z.coerce.number().finite(),
  radius: z.coerce.number().int().positive().max(50_000).default(2_000),
  category: z
    .enum(["cafe", "museum", "park", "attraction"])
    .default("cafe"),
  limit: z.coerce.number().int().positive().max(50).default(25)
});

const CategoryToQuery: Record<
  z.infer<typeof NearbyQuerySchema>["category"],
  string
> = {
  cafe: "cafe",
  museum: "museum",
  park: "park",
  attraction: "tourist attraction"
};

placesRouter.get("/nearby", async (req, res) => {
  const parsed = NearbyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: "Invalid query",
      details: parsed.error.flatten()
    });
  }

  const { lat, lng, radius, category, limit } = parsed.data;

  try {
    const geo = await mapboxGeocodingNearby({
      lat,
      lng,
      radius,
      limit,
      query: CategoryToQuery[category]
    });

    const places = geo.features
      .map((f) => {
        const [flng, flat] = f.geometry.coordinates;
        const distance = haversineMeters(lat, lng, flat, flng);

        return {
          id: f.properties.mapbox_id,
          name: f.properties.name,
          category,
          coordinates: { lat: flat, lng: flng },
          distanceMeters: Math.round(distance),
          address: f.properties.full_address ?? null
        };
      })
      .filter((p) => p.distanceMeters <= radius)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    return res.json({ ok: true, places });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
});

placesRouter.get("/:id", async (req, res) => {
  const id = req.params["id"];
  if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

  try {
    const place = await mapboxRetrievePlace(id);

    const feature = place.features[0];
    if (feature) {
      const [lng, lat] = feature.geometry.coordinates;
      const name = typeof feature.properties["name"] === "string" ? (feature.properties["name"] as string) : id;
      const address =
        typeof feature.properties["full_address"] === "string"
          ? (feature.properties["full_address"] as string)
          : null;

      await prisma.placeCache.upsert({
        where: { id },
        create: {
          id,
          name,
          category: "unknown",
          lat,
          lng,
          address,
          rawJson: JSON.stringify(place)
        },
        update: {
          name,
          lat,
          lng,
          address,
          rawJson: JSON.stringify(place),
          lastAccessedAt: new Date()
        }
      });
    }

    return res.json({ ok: true, place });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
});

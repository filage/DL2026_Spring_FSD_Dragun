import { Router } from "express";
import { z } from "zod";

import { overpassNearby } from "../services/overpass";
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
    const osm = await overpassNearby({
      lat,
      lng,
      radius,
      category,
      limit
    });

    const places = osm
      .map((p) => {
        const distance = haversineMeters(lat, lng, p.lat, p.lng);
        return {
          id: p.id,
          name: p.name,
          category,
          coordinates: { lat: p.lat, lng: p.lng },
          distanceMeters: Math.round(distance),
          address: p.address
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
    if (id.startsWith("osm:")) {
      return res.json({ ok: true, place: null });
    }

    return res.json({ ok: true, place: null });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
});

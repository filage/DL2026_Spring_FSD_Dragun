import { Router } from "express";
import { z } from "zod";

import { overpassNearby } from "../services/overpass";
import { prisma } from "../db/prisma";
import { haversineMeters } from "../utils/geo";

export const placesRouter = Router();

type NearbyCacheValue = {
  ts: number;
  places: Array<{
    id: string;
    name: string;
    category: string;
    coordinates: { lat: number; lng: number };
    distanceMeters: number;
    address: string | null;
    description: string | null;
    wikipedia: string | null;
    website: string | null;
  }>;
};

const NEARBY_CACHE_TTL_MS = 2 * 60_000;
const nearbyCache = new Map<string, NearbyCacheValue>();
const nearbyInFlight = new Map<string, Promise<NearbyCacheValue>>();

function bucketKey(lat: number, lng: number, radius: number) {
  const latB = Math.round(lat * 1000) / 1000;
  const lngB = Math.round(lng * 1000) / 1000;
  const rB = Math.round(radius / 250) * 250;
  return `${latB}:${lngB}:${rB}`;
}

const NearbyQuerySchema = z.object({
  lat: z.coerce.number().finite(),
  lng: z.coerce.number().finite(),
  radius: z.coerce.number().int().positive().max(50_000).default(2_000),
  category: z
    .enum(["cafe", "museum", "park", "attraction"])
    .default("cafe"),
  limit: z.coerce.number().int().positive().max(80).default(80)
});

const PlaceCacheUpsertQuerySchema = z.object({
  name: z.string().min(1).optional(),
  lat: z.coerce.number().finite().optional(),
  lng: z.coerce.number().finite().optional(),
  address: z.string().min(1).optional(),
  category: z.string().min(1).optional()
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

  const key = `${category}:${limit}:${bucketKey(lat, lng, radius)}`;
  const now = Date.now();
  const cached = nearbyCache.get(key);
  if (cached && now - cached.ts < NEARBY_CACHE_TTL_MS) {
    return res.json({ ok: true, places: cached.places });
  }

  const inflight = nearbyInFlight.get(key);
  if (inflight) {
    try {
      const v = await inflight;
      return res.json({ ok: true, places: v.places });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return res.status(500).json({ ok: false, error: message });
    }
  }

  try {
    const p = (async () => {
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
            address: p.address,
            description: p.description,
            wikipedia: p.wikipedia,
            website: p.website
          };
        })
        .filter((p) => p.distanceMeters <= radius)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);

      return { ts: Date.now(), places } satisfies NearbyCacheValue;
    })();

    nearbyInFlight.set(key, p);
    const v = await p;
    nearbyInFlight.delete(key);
    nearbyCache.set(key, v);
    return res.json({ ok: true, places: v.places });
  } catch (e) {
    nearbyInFlight.delete(key);
    if (cached && cached.places.length) {
      return res.json({ ok: true, places: cached.places, stale: true });
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
});

placesRouter.get("/:id", async (req, res) => {
  const id = req.params["id"];
  if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

  try {
    if (id.startsWith("osm:")) {
      const parsed = PlaceCacheUpsertQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: "Invalid query", details: parsed.error.flatten() });
      }

      const { name, lat, lng, address, category } = parsed.data;

      if (name && typeof lat === "number" && typeof lng === "number") {
        await prisma.placeCache.upsert({
          where: { id },
          create: {
            id,
            name,
            category: category ?? "unknown",
            lat,
            lng,
            address: address ?? null,
            rawJson: JSON.stringify({
              id,
              name,
              lat,
              lng,
              address: address ?? null,
              category: category ?? "unknown"
            })
          },
          update: {
            name,
            category: category ?? "unknown",
            lat,
            lng,
            address: address ?? null,
            rawJson: JSON.stringify({
              id,
              name,
              lat,
              lng,
              address: address ?? null,
              category: category ?? "unknown"
            }),
            lastAccessedAt: new Date()
          }
        });
      }

      return res.json({ ok: true, place: null });
    }

    return res.json({ ok: true, place: null });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
});

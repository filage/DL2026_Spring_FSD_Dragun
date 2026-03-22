import { Router } from "express";
import { z } from "zod";

import { mapboxDirections } from "../services/mapbox";

export const routesRouter = Router();

const RouteQuerySchema = z.object({
  fromLat: z.coerce.number().finite(),
  fromLng: z.coerce.number().finite(),
  toLat: z.coerce.number().finite(),
  toLng: z.coerce.number().finite(),
  mode: z.enum(["walking", "driving", "cycling"]).default("walking")
});

routesRouter.get("/", async (req, res) => {
  const parsed = RouteQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: "Invalid query",
      details: parsed.error.flatten()
    });
  }

  try {
    const route = await mapboxDirections(parsed.data);
    return res.json({ ok: true, route });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
});

import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";

export const favoritesRouter = Router();

favoritesRouter.get("/", requireAuth, async (req, res) => {
  const items = await prisma.favorite.findMany({
    where: { userId: req.authUser!.id },
    orderBy: { createdAt: "desc" },
    include: { place: true }
  });

  return res.json({ ok: true, favorites: items });
});

const CreateFavoriteBodySchema = z.object({
  placeId: z.string().min(1)
});

favoritesRouter.post("/", requireAuth, async (req, res) => {
  const parsed = CreateFavoriteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Invalid body", details: parsed.error.flatten() });
  }

  const { placeId } = parsed.data;

  const place = await prisma.placeCache.findUnique({ where: { id: placeId } });
  if (!place) {
    return res.status(400).json({ ok: false, error: "Unknown placeId. Load place details first." });
  }

  try {
    const favorite = await prisma.favorite.create({
      data: {
        userId: req.authUser!.id,
        placeId
      },
      include: { place: true }
    });

    return res.json({ ok: true, favorite });
  } catch {
    return res.status(409).json({ ok: false, error: "Already in favorites" });
  }
});

favoritesRouter.delete("/:placeId", requireAuth, async (req, res) => {
  const rawPlaceId = req.params["placeId"];
  const placeId = Array.isArray(rawPlaceId) ? rawPlaceId[0] : rawPlaceId;
  if (!placeId) return res.status(400).json({ ok: false, error: "Missing placeId" });

  await prisma.favorite.deleteMany({
    where: {
      userId: req.authUser!.id,
      placeId
    }
  });

  return res.json({ ok: true });
});

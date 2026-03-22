import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";

export const visitsRouter = Router();

visitsRouter.get("/", requireAuth, async (req, res) => {
  const items = await prisma.visit.findMany({
    where: { userId: req.authUser!.id },
    orderBy: { visitedAt: "desc" },
    include: { place: true }
  });

  return res.json({ ok: true, visits: items });
});

const CreateVisitBodySchema = z.object({
  placeId: z.string().min(1),
  notes: z.string().max(2000).optional().nullable()
});

visitsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = CreateVisitBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Invalid body", details: parsed.error.flatten() });
  }

  const { placeId, notes } = parsed.data;

  const place = await prisma.placeCache.findUnique({ where: { id: placeId } });
  if (!place) {
    return res.status(400).json({ ok: false, error: "Unknown placeId. Load place details first." });
  }

  const visit = await prisma.visit.create({
    data: {
      userId: req.authUser!.id,
      placeId,
      notes: notes ?? null
    },
    include: { place: true }
  });

  return res.json({ ok: true, visit });
});

import { Router } from "express";
import { z } from "zod";

import { prisma } from "../db/prisma";
import { requireAuth } from "../auth/middleware";

export const reviewsRouter = Router();

const CreateReviewBodySchema = z.object({
  placeId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  text: z.string().min(1).max(2000)
});

reviewsRouter.post("/", requireAuth, async (req, res) => {
  const parsed = CreateReviewBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Invalid body", details: parsed.error.flatten() });
  }

  const { placeId, rating, text } = parsed.data;

  const place = await prisma.placeCache.findUnique({ where: { id: placeId } });
  if (!place) {
    return res.status(400).json({ ok: false, error: "Unknown placeId. Load place details first." });
  }

  const review = await prisma.review.create({
    data: {
      placeId,
      userId: req.authUser!.id,
      rating,
      text
    },
    select: {
      id: true,
      rating: true,
      text: true,
      createdAt: true,
      user: { select: { id: true, email: true, role: true } }
    }
  });

  return res.json({ ok: true, review });
});

reviewsRouter.get("/place/:placeId", async (req, res) => {
  const placeId = req.params["placeId"];
  if (!placeId) return res.status(400).json({ ok: false, error: "Missing placeId" });

  const reviews = await prisma.review.findMany({
    where: { placeId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      rating: true,
      text: true,
      createdAt: true,
      user: { select: { id: true, email: true, role: true } }
    }
  });

  return res.json({ ok: true, reviews });
});

reviewsRouter.delete("/:id", requireAuth, async (req, res) => {
  const rawId = req.params["id"];
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) return res.status(404).json({ ok: false, error: "Not found" });

  const user = req.authUser!;
  const isOwner = review.userId === user.id;
  const isAdmin = user.role === "ADMIN";

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  await prisma.review.delete({ where: { id } });
  return res.json({ ok: true });
});

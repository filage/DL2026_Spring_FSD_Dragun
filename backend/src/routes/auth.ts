import { Router } from "express";
import { z } from "zod";

import { prisma } from "../db/prisma";
import { hashPassword, verifyPassword } from "../auth/password";
import { signAccessToken } from "../auth/jwt";
import { requireAuth } from "../auth/middleware";

export const authRouter = Router();

const RegisterBodySchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(200)
});

authRouter.post("/register", async (req, res) => {
  const parsed = RegisterBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Invalid body", details: parsed.error.flatten() });
  }

  const { username, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return res.status(409).json({ ok: false, error: "Username already in use" });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { username, passwordHash }
  });

  const token = signAccessToken({ sub: user.id, role: user.role });
  return res.json({ ok: true, token, user: { id: user.id, username: user.username, role: user.role } });
});

const LoginBodySchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(1).max(200)
});

authRouter.post("/login", async (req, res) => {
  const parsed = LoginBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Invalid body", details: parsed.error.flatten() });
  }

  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return res.status(401).json({ ok: false, error: "Unknown username" });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ ok: false, error: "Wrong password" });
  }

  const token = signAccessToken({ sub: user.id, role: user.role });
  return res.json({ ok: true, token, user: { id: user.id, username: user.username, role: user.role } });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  return res.json({ ok: true, user: req.authUser });
});

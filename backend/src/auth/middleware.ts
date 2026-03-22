import type { RequestHandler } from "express";

import { prisma } from "../db/prisma";
import { verifyAccessToken } from "./jwt";

export type AuthUser = {
  id: string;
  role: "USER" | "ADMIN";
  email: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __authUser: AuthUser | undefined;
}

declare module "express-serve-static-core" {
  interface Request {
    authUser?: AuthUser;
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true }
    });

    if (!user) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    req.authUser = { id: user.id, email: user.email, role: user.role };
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
};

export function requireRole(role: "ADMIN"): RequestHandler {
  return (req, res, next) => {
    if (!req.authUser) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    if (req.authUser.role !== role) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    return next();
  };
}

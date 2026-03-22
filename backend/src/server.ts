import cors from "cors";
import express from "express";

import { apiRouter } from "./routes/api";

export function createServer() {
  const app = express();

  app.use(
    cors({
      origin: true,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api", apiRouter);

  return app;
}

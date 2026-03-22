import { Router } from "express";

import { authRouter } from "./auth";
import { favoritesRouter } from "./favorites";
import { placesRouter } from "./places";
import { reviewsRouter } from "./reviews";
import { routesRouter } from "./routes";
import { visitsRouter } from "./visits";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/places", placesRouter);
apiRouter.use("/routes", routesRouter);
apiRouter.use("/reviews", reviewsRouter);
apiRouter.use("/favorites", favoritesRouter);
apiRouter.use("/visits", visitsRouter);

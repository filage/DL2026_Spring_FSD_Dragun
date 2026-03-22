import { Router } from "express";

import { placesRouter } from "./places";
import { routesRouter } from "./routes";

export const apiRouter = Router();

apiRouter.use("/places", placesRouter);
apiRouter.use("/routes", routesRouter);

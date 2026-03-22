import "dotenv/config";

import { createServer } from "./server";

const port = Number(process.env["PORT"] ?? 5174);
const server = createServer();

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[backend] listening on http://localhost:${port}`);
});

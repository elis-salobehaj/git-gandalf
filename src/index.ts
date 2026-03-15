import { honoLogger } from "@logtape/hono";
import { Hono } from "hono";
import { apiRouter } from "./api/router";
import { config } from "./config";
import { initLogging } from "./logger";

await initLogging();

const app = new Hono();

app.use(
  honoLogger({
    category: ["gandalf", "http"],
    level: "info",
    format: "combined",
    skip: (c) => c.req.path === "/api/v1/health",
  }),
);
app.route("/api/v1", apiRouter);

export default {
  port: config.PORT,
  fetch: app.fetch,
};

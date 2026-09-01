// Must come before anything that evaluates a decorator: NestJS reads the
// metadata this shim installs on Reflect, and importing it late means the
// metadata is missing for whatever was already loaded.
import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

const rawPort = process.env["PORT"];

// No default, matching the other apps in this repository. A port that falls
// back silently is a service that starts on the wrong one and looks healthy.
if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const app = await NestFactory.create(AppModule);

/**
 * Every route lives under /api, in every environment.
 *
 * The browser and the API share an origin — the session cookie is HttpOnly and
 * SameSite=Strict, which is only worth having if the two are not cross-origin —
 * so something has to separate API paths from the application's own. Doing it
 * with a prefix the server actually serves, rather than one a dev proxy strips,
 * keeps development and production agreeing about what the API's paths are.
 *
 * Note for anything path-based elsewhere in the app: middleware exclusions and
 * route matchers see the prefixed path. TenantModule's health exclusion is
 * written accordingly.
 */
app.setGlobalPrefix("api");

// Without this, onApplicationShutdown never runs and the database pool is left
// open when the process is signalled.
app.enableShutdownHooks();

await app.listen(port);

console.log(`API listening on http://localhost:${port}`);

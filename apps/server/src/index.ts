import "dotenv/config";
import { loadConfig } from "./config.js";
import { buildConfiguredApp } from "./wiring.js";

const config = loadConfig();
const app = await buildConfiguredApp(config);
try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`pi-web-ui server listening on http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

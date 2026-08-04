import "dotenv/config";

const { loadConfig } = await import("./config.js");
const { buildConfiguredApp } = await import("./wiring.js");
const config = loadConfig();
const app = await buildConfiguredApp(config);
try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`pi-web-ui server listening on http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

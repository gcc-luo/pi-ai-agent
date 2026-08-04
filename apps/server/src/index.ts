import "dotenv/config";
import { main as runPiAgent } from "@earendil-works/pi-coding-agent";

const agentMarker = process.argv.indexOf("--pi-agent");

if (agentMarker >= 0) {
  // The packaged server sidecar also contains pi-coding-agent. Reusing this
  // executable keeps desktop installs independent of Node.js and npx.
  process.title = "PI AI Agent";
  process.env.PI_CODING_AGENT = "true";
  process.emitWarning = (() => {}) as typeof process.emitWarning;
  await runPiAgent(process.argv.slice(agentMarker + 1));
} else {
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
}

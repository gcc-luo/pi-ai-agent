import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";

export function createDeploymentDirectory(serverDir) {
  const deployParent = path.join(serverDir, "node_modules");
  mkdirSync(deployParent, { recursive: true });
  return mkdtempSync(path.join(deployParent, ".pi-web-ui-deploy-"));
}

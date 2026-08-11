import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..");

export const releaseVersionPaths = {
  packageJsonPath: path.join(repositoryRoot, "apps/desktop/package.json"),
  tauriConfigPath: path.join(
    repositoryRoot,
    "apps/desktop/src-tauri/tauri.conf.json",
  ),
  cargoManifestPath: path.join(
    repositoryRoot,
    "apps/desktop/src-tauri/Cargo.toml",
  ),
};

export function normalizeReleaseVersion(input) {
  const version = input?.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    throw new Error(`Invalid release version: ${input ?? ""}`);
  }
  return version;
}

function replaceVersion(text, pattern, version, filePath) {
  const updated = text.replace(pattern, `$1${version}$3`);
  if (!pattern.test(text)) {
    throw new Error(`Version field is missing or already malformed: ${filePath}`);
  }
  return updated;
}

export async function updateReleaseVersionFiles(
  paths = releaseVersionPaths,
  inputVersion,
) {
  const version = normalizeReleaseVersion(inputVersion);
  const [packageJson, tauriConfig, cargoManifest] = await Promise.all([
    readFile(paths.packageJsonPath, "utf8"),
    readFile(paths.tauriConfigPath, "utf8"),
    readFile(paths.cargoManifestPath, "utf8"),
  ]);

  const updatedFiles = [
    [
      paths.packageJsonPath,
      replaceVersion(
        packageJson,
        /^(\s*"version"\s*:\s*")(\d+\.\d+\.\d+)("\s*,?\s*)$/m,
        version,
        paths.packageJsonPath,
      ),
    ],
    [
      paths.tauriConfigPath,
      replaceVersion(
        tauriConfig,
        /^(\s*"version"\s*:\s*")(\d+\.\d+\.\d+)("\s*,?\s*)$/m,
        version,
        paths.tauriConfigPath,
      ),
    ],
    [
      paths.cargoManifestPath,
      replaceVersion(
        cargoManifest,
        /^(version\s*=\s*")(\d+\.\d+\.\d+)("\s*)$/m,
        version,
        paths.cargoManifestPath,
      ),
    ],
  ];

  await Promise.all(
    updatedFiles.map(([filePath, content]) => writeFile(filePath, content)),
  );

  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inputVersion = process.argv[2];
  if (!inputVersion) {
    throw new Error("Usage: pnpm release:prepare <version>");
  }

  const version = await updateReleaseVersionFiles(
    releaseVersionPaths,
    inputVersion,
  );
  console.log(`Release files updated to ${version}`);
  console.log("Next: commit the changes, then create and push the matching tag.");
}

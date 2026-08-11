import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export function verifyReleaseVersion({
  tag,
  packageVersion,
  tauriVersion,
  cargoVersion,
}) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) {
    throw new Error(`Invalid release tag: ${tag}`);
  }

  const releaseVersion = match[1];
  const versions = { releaseVersion, packageVersion, tauriVersion, cargoVersion };
  if (new Set(Object.values(versions)).size !== 1) {
    throw new Error(
      `Release version mismatch: ${Object.entries(versions)
        .map(([name, version]) => `${name}=${version}`)
        .join(", ")}`,
    );
  }

  return releaseVersion;
}

export function resolveReleaseTag(args, fallbackTag = process.env.GITHUB_REF_NAME) {
  const tag = args.find((argument) => argument !== "--") ?? fallbackTag;
  if (!tag) throw new Error("Release tag argument is required");
  return tag;
}

export function verifyRepositoryReleaseVersion(tag) {
  const packageJson = JSON.parse(
    readFileSync(path.resolve(scriptDir, "../package.json"), "utf8"),
  );
  const tauriConfig = JSON.parse(
    readFileSync(path.resolve(scriptDir, "../src-tauri/tauri.conf.json"), "utf8"),
  );
  const cargoManifest = readFileSync(
    path.resolve(scriptDir, "../src-tauri/Cargo.toml"),
    "utf8",
  );
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoManifest)?.[1];
  if (!cargoVersion) throw new Error("Cargo package version is missing");

  return verifyReleaseVersion({
    tag,
    packageVersion: packageJson.version,
    tauriVersion: tauriConfig.version,
    cargoVersion,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = resolveReleaseTag(process.argv.slice(2));
  const version = verifyRepositoryReleaseVersion(tag);
  console.log(`Release version verified: ${version}`);
}

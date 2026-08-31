import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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

export function releaseNotesPath(version, root = repositoryRoot) {
  return path.join(root, "docs/release-notes", "v" + version + ".md");
}

export function resolvePreviousReleaseTag(ref = "HEAD") {
  const tag = execFileSync(
    "git",
    ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*", ref + "^"],
    { encoding: "utf8" },
  ).trim();
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error("Cannot resolve previous release tag from " + ref);
  }
  return tag;
}

export function listReleaseCommits(range) {
  const output = execFileSync(
    "git",
    ["log", "--pretty=format:%h %s", "--no-merges", range],
    { encoding: "utf8" },
  ).trim();
  return output ? output.split(/\r?\n/) : [];
}

export function buildReleaseNotesDraft(commits) {
  const lines = [
    "## 更新内容",
    "",
    "<!--",
    "  以下为 git log 范围内的原始提交，供整理参考。",
    "  发布前请按 docs/release-notes-standard.md 改写为 1、2、3 编号列表（3-8 条用户可见变更），",
    "  并删除本注释与下方的原始提交列表。",
    "-->",
    "",
    "### 原始提交（" + commits.length + " 条，待整理）",
    "",
    ...commits.map((commit) => "- " + commit),
    "",
  ];
  return lines.join("\n");
}

export function hasPlaceholderNotes(content) {
  return (
    content.includes("待整理") ||
    content.includes("原始提交") ||
    !/^\s*1[、.]/m.test(content)
  );
}

export async function ensureReleaseNotesFile(version, { ref = "HEAD" } = {}) {
  const notesPath = releaseNotesPath(version);
  if (existsSync(notesPath)) {
    return { notesPath, created: false };
  }
  const previousTag = resolvePreviousReleaseTag(ref);
  const commits = listReleaseCommits(previousTag + ".." + ref);
  await writeFile(notesPath, buildReleaseNotesDraft(commits));
  return { notesPath, created: true, previousTag, commitCount: commits.length };
}

export function verifyReleaseNotesContent(content, version) {
  if (hasPlaceholderNotes(content)) {
    throw new Error(
      "Release notes for v" + version + " still look like a raw draft. " +
      "Please rewrite docs/release-notes/v" + version + ".md into a curated " +
      "numbered list per docs/release-notes-standard.md.",
    );
  }
  return true;
}

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

async function prepareRelease(inputVersion) {
  const version = await updateReleaseVersionFiles(
    releaseVersionPaths,
    inputVersion,
  );
  const notes = await ensureReleaseNotesFile(version);
  console.log("Release files updated to " + version);
  if (notes.created) {
    console.log(
      "Draft release notes created at " + path.relative(repositoryRoot, notes.notesPath) +
        " (from " + notes.previousTag + "..HEAD, " + notes.commitCount + " commits).",
    );
    console.log(
      "ACTION REQUIRED: rewrite it into a curated numbered list per docs/release-notes-standard.md.",
    );
  } else {
    console.log("Release notes already exist: " + path.relative(repositoryRoot, notes.notesPath));
    verifyReleaseNotesContent(await readFile(notes.notesPath, "utf8"), version);
    console.log("Release notes content verified.");
  }
  console.log("Next: commit the changes, then create and push the matching tag.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inputVersion = process.argv[2];
  if (!inputVersion) {
    throw new Error("Usage: pnpm release:prepare <version>");
  }

  await prepareRelease(inputVersion);
}

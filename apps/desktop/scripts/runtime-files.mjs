import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

/**
 * Copy a hoisted pnpm deployment into an archive-safe directory. Windows tar
 * does not preserve pnpm junctions, so every package is copied as a real tree.
 */
export function copyRuntimeTree(sourceDir, destinationDir) {
  const sourceRoot = realpathSync(sourceDir);
  mkdirSync(destinationDir, { recursive: true });
  copyRuntimeFiles(sourceRoot, destinationDir, sourceRoot);
  copyHoistedNodeModules(
    path.join(sourceRoot, "node_modules"),
    path.join(destinationDir, "node_modules"),
    sourceRoot,
  );
}

export function backupNativeArtifacts(sourceDir, backupDir) {
  const virtualStore = path.join(sourceDir, "node_modules", ".pnpm");
  copyNativeFiles(virtualStore, sourceDir, backupDir);
}

export function restoreNativeArtifacts(sourceDir, backupDir) {
  copyNativeFiles(backupDir, backupDir, sourceDir);
}

function copyNativeFiles(directory, relativeRoot, destinationRoot) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const sourcePath = path.join(directory, entry.name);
    const stats = lstatSync(sourcePath);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      copyNativeFiles(sourcePath, relativeRoot, destinationRoot);
      continue;
    }
    if (!entry.name.endsWith(".node")) continue;
    const relativePath = path.relative(relativeRoot, sourcePath);
    const destinationPath = path.join(destinationRoot, relativePath);
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
  }
}

function copyRuntimeFiles(sourcePath, destinationPath, sourceRoot) {
  const stats = lstatSync(sourcePath);
  if (stats.isSymbolicLink()) {
    const targetPath = realpathSync(sourcePath);
    if (!isWithin(sourceRoot, targetPath)) {
      throw new Error(`Runtime link escapes deployment directory: ${sourcePath} -> ${targetPath}`);
    }
    copyRuntimeFiles(targetPath, destinationPath, sourceRoot);
    return;
  }

  if (stats.isDirectory()) {
    mkdirSync(destinationPath, { recursive: true });
    for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const childSourcePath = path.join(sourcePath, entry.name);
      copyRuntimeFiles(childSourcePath, path.join(destinationPath, entry.name), sourceRoot);
    }
    return;
  }

  copyFileSync(sourcePath, destinationPath);
}

function copyHoistedNodeModules(sourceNodeModules, destinationNodeModules, sourceRoot) {
  mkdirSync(destinationNodeModules, { recursive: true });
  for (const packageEntry of listPackages(sourceNodeModules)) {
    copyRuntimeFiles(
      packageEntry.sourcePath,
      path.join(destinationNodeModules, ...packageEntry.name.split("/")),
      sourceRoot,
    );
  }
}

function listPackages(nodeModulesDir) {
  const packages = [];
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.name === ".bin" || entry.name === ".pnpm" || entry.name === ".modules.yaml") continue;
    const entryPath = path.join(nodeModulesDir, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
        packages.push({
          name: `${entry.name}/${scopedEntry.name}`,
          sourcePath: path.join(entryPath, scopedEntry.name),
        });
      }
    } else {
      packages.push({ name: entry.name, sourcePath: entryPath });
    }
  }
  return packages;
}

function isWithin(rootDir, targetPath) {
  const relative = path.relative(realpathSync(rootDir), targetPath);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

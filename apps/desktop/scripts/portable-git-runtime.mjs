import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

export function verifyPortableGitRuntime({
  archivePath,
  checksumPath,
  expectedChecksum,
}) {
  const archiveSize = statSync(archivePath).size;
  if (archiveSize === 0) {
    throw new Error(`PortableGit archive is empty: ${archivePath}`);
  }

  const declaredChecksum = readFileSync(checksumPath, "utf8").trim().toLowerCase();
  const normalizedExpectedChecksum = expectedChecksum.toLowerCase();
  if (declaredChecksum !== normalizedExpectedChecksum) {
    throw new Error(
      `PortableGit checksum file mismatch: expected ${normalizedExpectedChecksum}, received ${declaredChecksum || "<empty>"}`,
    );
  }

  const actualChecksum = createHash("sha256")
    .update(readFileSync(archivePath))
    .digest("hex");
  if (actualChecksum !== normalizedExpectedChecksum) {
    throw new Error(
      `PortableGit checksum mismatch: expected ${normalizedExpectedChecksum}, received ${actualChecksum}`,
    );
  }

  return actualChecksum;
}

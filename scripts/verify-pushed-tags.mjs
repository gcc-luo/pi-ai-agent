import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { verifyRepositoryReleaseVersion } from "../apps/desktop/scripts/verify-release-version.mjs";

const zeroObjectId = /^0+$/;
const releaseTag = /^refs\/tags\/(v\d+\.\d+\.\d+)$/;

export function getPushedReleaseTags(input) {
  const tags = [];

  for (const line of input.split(/\r?\n/)) {
    const [localRef, localObjectId, remoteRef] = line.trim().split(/\s+/);
    const match = releaseTag.exec(remoteRef ?? "");
    if (!match || !localRef || zeroObjectId.test(localObjectId ?? "")) {
      continue;
    }
    tags.push(match[1]);
  }

  return [...new Set(tags)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  for (const tag of getPushedReleaseTags(chunks.join(""))) {
    verifyRepositoryReleaseVersion(tag);
    console.log(`Release tag verified before push: ${tag}`);
  }
}

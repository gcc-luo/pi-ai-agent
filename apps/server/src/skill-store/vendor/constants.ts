import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));

export const EXTENSION_NAME = "pi-skill-hub";
export const EXTENSION_ROOT = dirname(SOURCE_DIR);
export const CONFIG_PATH = join(EXTENSION_ROOT, "config.json");
export const DATA_DIR = join(EXTENSION_ROOT, "data");
export const MANIFEST_PATH = join(DATA_DIR, "provenance.json");
export const DEFAULT_UPDATE_STAGING_ROOT = join(DATA_DIR, "update-staging");
export const DEBUG_DIR = join(EXTENSION_ROOT, "debug");
export const DEBUG_LOG_PATH = join(DEBUG_DIR, "debug.log");
export const DEFAULT_LOCAL_SKILL_ROOT = join(homedir(), ".pi", "agent", "skills");
export const DEFAULT_EXTERNAL_SKILL_ROOTS = [join(homedir(), ".agents", "skills")];
export const MANIFEST_VERSION = 1;
export const DEFAULT_MAX_SEARCH_RESULTS = 20;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

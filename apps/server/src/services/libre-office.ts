import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

export interface LibreOfficeConfig {
  binaryPath?: string;
  timeoutMs: number;
  cacheDir: string;
  maxCacheFiles: number;
  maxCacheBytes: number;
}

export interface ConvertResult {
  pdfPath: string;
  fromCache: boolean;
}

export class LibreOfficeService {
  private available: boolean | null = null;
  private binaryPath = "soffice";
  private config: LibreOfficeConfig;
  private concurrent = 0;
  private maxConcurrent = 2;
  private queue: Array<() => void> = [];

  constructor(config: LibreOfficeConfig) {
    this.config = config;
    if (config.binaryPath) this.binaryPath = config.binaryPath;
  }

  /** Detect whether LibreOffice is available (cached — only checks once). */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;

    const candidates = this.config.binaryPath
      ? [this.config.binaryPath]
      : ["soffice", "libreoffice"];

    for (const bin of candidates) {
      try {
        await execFileAsync(bin, ["--version"], { timeout: 5000 });
        this.binaryPath = bin;
        this.available = true;
        return true;
      } catch {
        /* try next */
      }
    }

    this.available = false;
    return false;
  }

  /** Convert an Office file to PDF, returning the cached PDF path. */
  async convert(sourcePath: string, fileMtime: number, fileSize: number): Promise<ConvertResult> {
    await this.acquireSlot();
    try {
      const cacheKey = this.cacheKey(sourcePath, fileMtime, fileSize);
      const cachedPdf = path.join(this.config.cacheDir, `${cacheKey}.pdf`);

      // Check cache
      try {
        await fs.access(cachedPdf);
        return { pdfPath: cachedPdf, fromCache: true };
      } catch {
        /* cache miss */
      }

      // Isolated temp dir for LibreOffice user profile (avoids lock conflicts)
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-lo-"));
      const tmpOutDir = path.join(tmpDir, "out");
      await fs.mkdir(tmpOutDir, { recursive: true });

      try {
        // execFile (not exec) — no shell interpretation, safe from injection
        await execFileAsync(
          this.binaryPath,
          [
            "--headless",
            "--norestore",
            "--nolockcheck",
            `-env:UserInstallation=file://${tmpDir.replace(/\\/g, "/")}`,
            "--convert-to",
            "pdf",
            "--outdir",
            tmpOutDir,
            sourcePath,
          ],
          {
            timeout: this.config.timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
          },
        );

        // Locate the output PDF
        const baseName = path.basename(sourcePath, path.extname(sourcePath));
        const pdfFile = path.join(tmpOutDir, baseName + ".pdf");
        await fs.access(pdfFile);

        // Copy to cache
        await fs.mkdir(this.config.cacheDir, { recursive: true });
        await fs.copyFile(pdfFile, cachedPdf);

        return { pdfPath: cachedPdf, fromCache: false };
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    } finally {
      this.releaseSlot();
    }
  }

  /** Evict old cache entries when limits are exceeded. */
  async evictCache(): Promise<void> {
    try {
      const entries = await fs.readdir(this.config.cacheDir);
      const pdfs = entries.filter((e) => e.endsWith(".pdf"));
      if (pdfs.length <= this.config.maxCacheFiles) return;

      const stats = await Promise.all(
        pdfs.map(async (name) => {
          const full = path.join(this.config.cacheDir, name);
          const st = await fs.stat(full);
          return { full, atime: st.atimeMs, size: st.size };
        }),
      );
      stats.sort((a, b) => a.atime - b.atime);

      let totalBytes = stats.reduce((s, e) => s + e.size, 0);
      let count = stats.length;
      for (const entry of stats) {
        if (count <= this.config.maxCacheFiles && totalBytes <= this.config.maxCacheBytes) break;
        await fs.unlink(entry.full).catch(() => {});
        totalBytes -= entry.size;
        count--;
      }
    } catch {
      /* cache dir not yet created */
    }
  }

  // ── Private ──

  private cacheKey(sourcePath: string, mtime: number, size: number): string {
    const h = crypto.createHash("sha256");
    h.update(sourcePath);
    h.update(`:${mtime}:${size}`);
    return h.digest("hex").slice(0, 32);
  }

  private async acquireSlot(): Promise<void> {
    if (this.concurrent < this.maxConcurrent) {
      this.concurrent++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.concurrent++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.concurrent--;
    const next = this.queue.shift();
    if (next) next();
  }
}

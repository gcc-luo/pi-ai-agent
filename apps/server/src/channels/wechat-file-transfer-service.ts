import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_WECHAT_FILE_BYTES,
  MAX_WECHAT_FILE_COUNT,
  MAX_WECHAT_TOTAL_FILE_BYTES,
} from "./wechat-media.js";

const WECHAT_FILE_TRANSFER_PLUGIN_ID = "wechat-file-transfer";

type ActiveTransfer = {
  workdir: string;
  sendFile: (fileName: string, data: Buffer) => Promise<void>;
  sendStatus: (text: string) => Promise<void>;
};

export type WeChatFileTransferResult = {
  sent: string[];
  failed: Array<{ path: string; error: string }>;
};

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function displayName(inputPath: string): string {
  return path.posix.basename(inputPath.replaceAll("\\", "/")) || "未知文件";
}

function safeError(error: unknown, absolutePath: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(absolutePath, "文件") || "文件发送失败";
}

export { WECHAT_FILE_TRANSFER_PLUGIN_ID };

/** Holds only the current WeChat turn's file sender; entries are removed when the agent exits. */
export class WeChatFileTransferService {
  private activeTransfers = new Map<string, ActiveTransfer>();

  register(
    sessionId: string,
    transfer: ActiveTransfer,
  ): () => void {
    this.activeTransfers.set(sessionId, transfer);
    return () => {
      if (this.activeTransfers.get(sessionId) === transfer) this.activeTransfers.delete(sessionId);
    };
  }

  async sendFiles(sessionId: string, filePaths: string[]): Promise<WeChatFileTransferResult> {
    const transfer = this.activeTransfers.get(sessionId);
    if (!transfer) throw new Error("当前微信消息已结束，无法发送文件");
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      throw new Error("至少需要指定一个文件路径");
    }
    if (filePaths.length > MAX_WECHAT_FILE_COUNT) {
      throw new Error(`单次最多发送 ${MAX_WECHAT_FILE_COUNT} 个文件`);
    }

    let root: string;
    try {
      root = await fs.realpath(transfer.workdir);
    } catch {
      throw new Error("项目工作目录不可用，无法发送文件");
    }
    const sent: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];
    let totalSize = 0;

    for (const inputPath of filePaths) {
      const name = displayName(inputPath);
      if (!inputPath.trim() || path.isAbsolute(inputPath)) {
        failed.push({ path: name, error: "只支持项目目录内的相对路径" });
        continue;
      }

      let resolved = "";
      try {
        resolved = await fs.realpath(path.resolve(root, inputPath));
        if (!isInside(root, resolved)) throw new Error("文件路径超出项目工作目录");
        const fileStat = await fs.stat(resolved);
        if (!fileStat.isFile()) throw new Error("目录不支持");
        if (fileStat.size > MAX_WECHAT_FILE_BYTES) throw new Error("单个文件超过 50 MiB 限制");
        if (totalSize + fileStat.size > MAX_WECHAT_TOTAL_FILE_BYTES) {
          throw new Error("本次文件总大小超过 100 MiB 限制");
        }

        await transfer.sendFile(path.basename(resolved), await fs.readFile(resolved));
        totalSize += fileStat.size;
        sent.push(path.basename(resolved));
      } catch (error) {
        failed.push({
          path: name,
          error: safeError(error, resolved || path.resolve(root, inputPath)),
        });
      }
    }

    if (sent.length > 0) {
      const status = failed.length === 0
        ? `✅ 文件传输完成：${sent.join("、")}`
        : `✅ 部分文件传输完成：${sent.join("、")}`;
      await transfer.sendStatus(status).catch(() => {});
    }

    return { sent, failed };
  }
}

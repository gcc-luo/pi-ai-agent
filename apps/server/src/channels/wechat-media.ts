import { randomUUID } from "node:crypto";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageAttachment } from "@pi-web-ui/shared";
import {
  MessageItemType,
  type CDNMedia,
  type IncomingMessage,
  type WireMessageItem,
} from "@wechatbot/wechatbot";

export const MAX_WECHAT_IMAGE_COUNT = 4;
export const MAX_WECHAT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_WECHAT_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_WECHAT_FILE_COUNT = 10;
export const MAX_WECHAT_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_WECHAT_TOTAL_FILE_BYTES = 100 * 1024 * 1024;

const WECHAT_FILES_DIRECTORY = "wechat-files";
const FILE_MIME_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export interface WeChatSavedFile {
  fileName: string;
  mimeType: string;
  relativePath: string;
  size: number;
}

export interface WeChatPreparedMedia {
  text: string;
  images: ImageAttachment[];
  files: WeChatSavedFile[];
  attachmentOrder: Array<
    | { kind: "image"; fileName: string; relativePath: string }
    | { kind: "file"; fileName: string; relativePath: string }
  >;
}

type DownloadRaw = (media: CDNMedia, aesKey?: string) => Promise<Buffer>;

function safeFileName(rawName: string, fallback: string): string {
  const base = path.posix.basename(rawName.replaceAll("\\", "/")).trim();
  let name = base && base !== "." && base !== ".." ? base : fallback;
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  let length = 0;
  const safeName = Array.from(name).filter((character) => {
    const bytes = Buffer.byteLength(character);
    // Leave room for the timestamp/UUID prefix used by createFileDestination.
    if (length + bytes > 220) return false;
    length += bytes;
    return true;
  }).join("");
  return safeName || fallback;
}

function detectImage(buffer: Buffer): { mediaType: string; extension: string } | null {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mediaType: "image/png", extension: ".png" };
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { mediaType: "image/jpeg", extension: ".jpg" };
  }
  const signature = buffer.subarray(0, 6).toString("ascii");
  if (signature === "GIF87a" || signature === "GIF89a") {
    return { mediaType: "image/gif", extension: ".gif" };
  }
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mediaType: "image/webp", extension: ".webp" };
  }
  return null;
}

function messageText(message: IncomingMessage): string {
  const textItems = message.raw?.item_list
    ?.filter((item) => item.type === MessageItemType.TEXT)
    .map((item) => item.text_item?.text?.trim())
    .filter((text): text is string => Boolean(text));
  if (textItems?.length) return textItems.join("\n");
  return message.raw ? "" : message.text?.trim() ?? "";
}

function messageItems(message: IncomingMessage): WireMessageItem[] {
  return message.raw?.item_list ?? [];
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function createFileDestination(workdir: string, fileName: string): Promise<{
  localPath: string;
  relativePath: string;
}> {
  const root = await realpath(workdir);
  const directory = path.join(root, WECHAT_FILES_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const resolvedDirectory = await realpath(directory);
  if (!isInside(root, resolvedDirectory)) {
    throw new Error("微信附件保存目录超出项目工作目录");
  }
  const storedName = `${Date.now()}-${randomUUID().slice(0, 8)}-${fileName}`;
  const localPath = path.join(resolvedDirectory, storedName);
  if (!isInside(root, localPath)) throw new Error("微信附件保存路径无效");
  return {
    localPath,
    relativePath: path.relative(root, localPath),
  };
}

async function prepareImage(
  item: WireMessageItem,
  workdir: string,
  downloadRaw: DownloadRaw,
  index: number,
  remainingTotalBytes: number,
): Promise<{ image: ImageAttachment; size: number; relativePath: string }> {
  const media = item.image_item?.media;
  if (!media) throw new Error("图片缺少下载信息，无法识别");
  const data = await downloadRaw(media, item.image_item?.aeskey);
  if (data.length === 0) throw new Error("图片数据为空，无法识别");
  if (data.length > MAX_WECHAT_IMAGE_BYTES) throw new Error("单张图片超过 5 MiB 限制，请压缩后重试");
  if (data.length > remainingTotalBytes) throw new Error("图片总大小超过 20 MiB 限制，请减少图片数量或压缩后重试");
  const detected = detectImage(data);
  if (!detected) throw new Error("图片格式无法识别，支持 PNG、JPEG、GIF 和 WebP");
  const fileName = `image-${index}${detected.extension}`;
  const destination = await createFileDestination(workdir, fileName);
  await writeFile(destination.localPath, data, { flag: "wx" });
  return {
    image: {
      name: fileName,
      mediaType: detected.mediaType,
      data: data.toString("base64"),
    },
    size: data.length,
    relativePath: destination.relativePath,
  };
}

async function prepareFile(
  item: WireMessageItem,
  workdir: string,
  downloadRaw: DownloadRaw,
  index: number,
  remainingTotalBytes: number,
): Promise<WeChatSavedFile> {
  const attachment = item.file_item;
  const media = attachment?.media;
  if (!attachment || !media) throw new Error("附件缺少下载信息，无法识别");
  const fileName = safeFileName(attachment.file_name ?? "", `attachment-${index}`);
  const declaredSize = Number.parseInt(attachment.len ?? "", 10);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_WECHAT_FILE_BYTES) {
    throw new Error("单个附件超过 50 MiB 限制，请压缩后重试");
  }
  const data = await downloadRaw(media);
  if (data.length > MAX_WECHAT_FILE_BYTES) throw new Error("单个附件超过 50 MiB 限制，请压缩后重试");
  if (data.length > remainingTotalBytes) throw new Error("文件总大小超过 100 MiB 限制，请减少文件数量或压缩后重试");
  const destination = await createFileDestination(workdir, fileName);
  await writeFile(destination.localPath, data, { flag: "wx" });
  const fileStat = await stat(destination.localPath);
  return {
    fileName,
    mimeType: FILE_MIME_TYPES[path.extname(fileName).toLowerCase()] ?? "application/octet-stream",
    relativePath: destination.relativePath,
    size: fileStat.size,
  };
}

/** Download, validate and persist all image and file items from a WeChat batch. */
export async function prepareWeChatMedia(
  messages: IncomingMessage[],
  workdir: string,
  downloadRaw: DownloadRaw,
): Promise<WeChatPreparedMedia> {
  const items = messages.flatMap(messageItems);
  const attachmentItems = items.filter((item) =>
    (item.type === MessageItemType.IMAGE && item.image_item)
    || (item.type === MessageItemType.FILE && item.file_item),
  );
  const imageCount = attachmentItems.filter((item) => item.type === MessageItemType.IMAGE).length;
  const fileCount = attachmentItems.filter((item) => item.type === MessageItemType.FILE).length;
  if (imageCount > MAX_WECHAT_IMAGE_COUNT) throw new Error(`单次最多发送 ${MAX_WECHAT_IMAGE_COUNT} 张图片`);
  if (fileCount > MAX_WECHAT_FILE_COUNT) throw new Error(`单次最多发送 ${MAX_WECHAT_FILE_COUNT} 个文件`);

  const images: ImageAttachment[] = [];
  const files: WeChatSavedFile[] = [];
  const attachmentOrder: WeChatPreparedMedia["attachmentOrder"] = [];
  let totalImageBytes = 0;
  let totalFileBytes = 0;
  let imageIndex = 0;
  let fileIndex = 0;
  for (const item of attachmentItems) {
    if (item.type === MessageItemType.IMAGE) {
      imageIndex += 1;
      const prepared = await prepareImage(
        item,
        workdir,
        downloadRaw,
        imageIndex,
        MAX_WECHAT_TOTAL_IMAGE_BYTES - totalImageBytes,
      );
      totalImageBytes += prepared.size;
      images.push(prepared.image);
      attachmentOrder.push({ kind: "image", fileName: prepared.image.name, relativePath: prepared.relativePath });
    } else {
      fileIndex += 1;
      const prepared = await prepareFile(
        item,
        workdir,
        downloadRaw,
        fileIndex,
        MAX_WECHAT_TOTAL_FILE_BYTES - totalFileBytes,
      );
      totalFileBytes += prepared.size;
      files.push(prepared);
      attachmentOrder.push({ kind: "file", fileName: prepared.fileName, relativePath: prepared.relativePath });
    }
  }

  return {
    text: messages.map(messageText).filter(Boolean).join("\n"),
    images,
    files,
    attachmentOrder,
  };
}

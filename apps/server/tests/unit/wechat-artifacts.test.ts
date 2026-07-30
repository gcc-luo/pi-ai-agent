import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildWeChatAgentReply } from "../../src/channels/wechat-artifacts.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-web-ui-wechat-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("buildWeChatAgentReply", () => {
  it("removes artifact declarations and loads final files", async () => {
    const workdir = await makeTempDir();
    await fs.mkdir(path.join(workdir, "output"));
    await fs.writeFile(path.join(workdir, "output", "report.pdf"), "pdf-data");

    const reply = await buildWeChatAgentReply(
      '报告已生成。\n<artifacts>\n[{"path":"output/report.pdf","name":"最终报告.pdf","mimeType":"application/pdf"}]\n</artifacts>',
      workdir,
    );

    expect(reply.text).toBe("报告已生成。");
    expect(reply.files).toHaveLength(1);
    expect(reply.files[0]?.fileName).toBe("最终报告.pdf");
    expect(reply.files[0]?.data.toString()).toBe("pdf-data");
    expect(reply.failedFiles).toEqual([]);
    expect(reply.failedDeclarations).toBe(0);
  });

  it("ignores missing, directory, duplicate, and escaping artifact paths", async () => {
    const workdir = await makeTempDir();
    const outside = await makeTempDir();
    await fs.mkdir(path.join(workdir, "output"));
    await fs.writeFile(path.join(workdir, "output", "result.txt"), "done");
    await fs.writeFile(path.join(outside, "secret.txt"), "secret");
    const log = vi.fn();

    const reply = await buildWeChatAgentReply(
      [
        "完成",
        "<artifacts>",
        JSON.stringify([
          { path: "output/result.txt", name: "../result.txt" },
          { path: "output/result.txt", name: "duplicate.txt" },
          { path: "output", name: "output" },
          { path: "missing.txt", name: "missing.txt" },
          { path: path.relative(workdir, path.join(outside, "secret.txt")), name: "secret.txt" },
        ]),
        "</artifacts>",
      ].join("\n"),
      workdir,
      log,
    );

    expect(reply.files).toHaveLength(1);
    expect(reply.files[0]?.fileName).toBe("result.txt");
    expect(reply.files[0]?.data.toString()).toBe("done");
    expect(reply.failedFiles).toEqual(["output", "missing.txt", "secret.txt"]);
    expect(log).toHaveBeenCalled();
  });

  it("uses a concise text fallback when the response only declares files", async () => {
    const workdir = await makeTempDir();
    await fs.writeFile(path.join(workdir, "result.txt"), "done");

    const reply = await buildWeChatAgentReply(
      '<artifacts>[{"path":"result.txt","name":"result.txt"}]</artifacts>',
      workdir,
    );

    expect(reply.text).toBe("已为你生成文件。");
  });

  it("rejects oversized files before reading them into memory", async () => {
    const workdir = await makeTempDir();
    const oversized = path.join(workdir, "oversized.bin");
    const handle = await fs.open(oversized, "w");
    await handle.truncate(50 * 1024 * 1024 + 1);
    await handle.close();

    const reply = await buildWeChatAgentReply(
      '<artifacts>[{"path":"oversized.bin","name":"oversized.bin"}]</artifacts>',
      workdir,
    );

    expect(reply.files).toEqual([]);
    expect(reply.failedFiles).toEqual(["oversized.bin"]);
  });

  it("counts malformed blocks, non-array declarations, and invalid items", async () => {
    const workdir = await makeTempDir();

    const reply = await buildWeChatAgentReply(
      [
        "已处理。",
        "<artifacts>{not-json}</artifacts>",
        "<artifacts>{\"path\":\"result.txt\"}</artifacts>",
        "<artifacts>[{\"path\":\"result.txt\"},null]</artifacts>",
      ].join("\n"),
      workdir,
    );

    expect(reply.text).toBe("已处理。");
    expect(reply.files).toEqual([]);
    expect(reply.failedDeclarations).toBe(4);
  });

  it("accepts project files whose names start with two dots", async () => {
    const workdir = await makeTempDir();
    await fs.writeFile(path.join(workdir, "..report.pdf"), "report");

    const reply = await buildWeChatAgentReply(
      '<artifacts>[{"path":"..report.pdf","name":"CON:\\u0000报告.pdf"}]</artifacts>',
      workdir,
    );

    expect(reply.files).toHaveLength(1);
    expect(reply.files[0]?.fileName).toBe("CON__报告.pdf");
  });

  it("removes and reports a truncated final artifact block", async () => {
    const workdir = await makeTempDir();

    const reply = await buildWeChatAgentReply(
      '正文保留。\n<artifacts>[{"path":"result.txt"',
      workdir,
    );

    expect(reply.text).toBe("正文保留。");
    expect(reply.failedDeclarations).toBe(1);
  });

  it("uses a non-empty fallback when only a malformed declaration is returned", async () => {
    const workdir = await makeTempDir();

    const reply = await buildWeChatAgentReply(
      "<artifacts>{not-json}</artifacts>",
      workdir,
    );

    expect(reply.text).toBe("文件声明处理失败。");
    expect(reply.failedDeclarations).toBe(1);
  });

  it("reports declarations beyond the per-response artifact limit", async () => {
    const workdir = await makeTempDir();
    await fs.writeFile(path.join(workdir, "result.txt"), "done");
    const declarations = Array.from({ length: 51 }, (_, index) => ({
      path: "result.txt",
      name: `result-${index + 1}.txt`,
    }));

    const reply = await buildWeChatAgentReply(
      `<artifacts>${JSON.stringify(declarations)}</artifacts>`,
      workdir,
    );

    expect(reply.files).toHaveLength(1);
    expect(reply.failedFiles).toEqual(["result-51.txt"]);
  });

  it("still returns the visible response when the project workdir is unavailable", async () => {
    const workdir = await makeTempDir();
    await fs.rm(workdir, { recursive: true });
    const log = vi.fn();

    const reply = await buildWeChatAgentReply(
      '任务已完成。\n<artifacts>[{"path":"result.txt","name":"result.txt"}]</artifacts>',
      workdir,
      log,
    );

    expect(reply).toEqual({
      text: "任务已完成。",
      files: [],
      failedFiles: ["result.txt"],
      failedDeclarations: 0,
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ workdir }),
      "failed to resolve WeChat artifact workdir",
    );
  });
});

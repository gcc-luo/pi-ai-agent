import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  handler: null as null | ((message: { userId: string; text: string }) => Promise<void>),
  reply: vi.fn(),
}));

vi.mock("@wechatbot/wechatbot", () => ({
  WeChatBot: class {
    isRunning = true;
    storage = { has: vi.fn().mockResolvedValue(true) };

    onMessage(handler: (message: { userId: string; text: string }) => Promise<void>) {
      sdk.handler = handler;
    }

    login() {
      return Promise.resolve({ userId: "bot-user" });
    }

    start() {
      return Promise.resolve();
    }

    stop() {}

    reply = sdk.reply;
  },
}));

import { getWeChatWorker } from "../../src/channels/wechat-worker.js";

describe("WeChat worker artifact delivery", () => {
  beforeEach(() => {
    sdk.reply.mockReset();
    sdk.handler = null;
    getWeChatWorker().stop();
  });

  it("sends response text followed by every final artifact", async () => {
    getWeChatWorker().setInboundHandler(async () => ({
      text: "文件已生成。",
      files: [
        { data: Buffer.from("one"), fileName: "one.txt" },
        { data: Buffer.from("two"), fileName: "two.pdf" },
      ],
      failedFiles: [],
      failedDeclarations: 0,
    }));
    getWeChatWorker().startLogin();

    const message = { userId: "wxid-user", text: "生成文件" };
    await sdk.handler?.(message);

    expect(sdk.reply.mock.calls).toEqual([
      [message, "文件已生成。"],
      [message, { file: Buffer.from("one"), fileName: "one.txt" }],
      [message, { file: Buffer.from("two"), fileName: "two.pdf" }],
    ]);
  });

  it("continues sending files and reports individual upload failures", async () => {
    sdk.reply
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("upload failed"))
      .mockResolvedValue(undefined);
    getWeChatWorker().setInboundHandler(async () => ({
      text: "文件已生成。",
      files: [
        { data: Buffer.from("bad"), fileName: "bad.pdf" },
        { data: Buffer.from("good"), fileName: "good.pdf" },
      ],
      failedFiles: ["missing.docx"],
      failedDeclarations: 0,
    }));
    getWeChatWorker().startLogin();

    const message = { userId: "wxid-user", text: "生成文件" };
    await sdk.handler?.(message);

    expect(sdk.reply).toHaveBeenCalledTimes(4);
    expect(sdk.reply).toHaveBeenNthCalledWith(
      3,
      message,
      { file: Buffer.from("good"), fileName: "good.pdf" },
    );
    expect(sdk.reply).toHaveBeenLastCalledWith(
      message,
      "以下文件发送失败：missing.docx、bad.pdf",
    );
  });

  it("tells the user when artifact declarations cannot be parsed", async () => {
    getWeChatWorker().setInboundHandler(async () => ({
      text: "文件已生成。",
      files: [],
      failedFiles: [],
      failedDeclarations: 2,
    }));
    getWeChatWorker().startLogin();

    const message = { userId: "wxid-user", text: "生成文件" };
    await sdk.handler?.(message);

    expect(sdk.reply.mock.calls).toEqual([
      [message, "文件已生成。"],
      [message, "有 2 项产物声明无法解析，相关文件未发送。"],
    ]);
  });

  it("serializes the full reply and artifact delivery for the same user", async () => {
    let releaseFirstUpload!: () => void;
    const firstUpload = new Promise<void>((resolve) => {
      releaseFirstUpload = resolve;
    });
    sdk.reply.mockImplementation((_message, content) => {
      if (typeof content === "object" && content.fileName === "first.pdf") {
        return firstUpload;
      }
      return Promise.resolve();
    });
    const inbound = vi.fn()
      .mockResolvedValueOnce({
        text: "first",
        files: [{ data: Buffer.from("first"), fileName: "first.pdf" }],
        failedFiles: [],
        failedDeclarations: 0,
      })
      .mockResolvedValueOnce({
        text: "second",
        files: [],
        failedFiles: [],
        failedDeclarations: 0,
      });
    getWeChatWorker().setInboundHandler(inbound);
    getWeChatWorker().startLogin();

    const firstMessage = { userId: "same-user", text: "first" };
    const secondMessage = { userId: "same-user", text: "second" };
    const first = sdk.handler?.(firstMessage);
    const second = sdk.handler?.(secondMessage);
    await vi.waitFor(() => expect(sdk.reply).toHaveBeenCalledTimes(2));

    expect(inbound).toHaveBeenCalledTimes(1);
    releaseFirstUpload();
    await Promise.all([first, second]);

    expect(inbound).toHaveBeenCalledTimes(2);
    expect(sdk.reply.mock.calls).toEqual([
      [firstMessage, "first"],
      [firstMessage, { file: Buffer.from("first"), fileName: "first.pdf" }],
      [secondMessage, "second"],
    ]);
  });

  it("processes different users independently", async () => {
    let releaseFirstUser!: () => void;
    const firstUserReply = new Promise<void>((resolve) => {
      releaseFirstUser = resolve;
    });
    const inbound = vi.fn(({ userId }: { userId: string }) => {
      if (userId === "slow-user") {
        return firstUserReply.then(() => ({
          text: "slow",
          files: [],
          failedFiles: [],
          failedDeclarations: 0,
        }));
      }
      return Promise.resolve({ text: "fast", files: [], failedFiles: [], failedDeclarations: 0 });
    });
    getWeChatWorker().setInboundHandler(inbound);
    getWeChatWorker().startLogin();

    const slowMessage = { userId: "slow-user", text: "slow" };
    const fastMessage = { userId: "fast-user", text: "fast" };
    const slow = sdk.handler?.(slowMessage);
    const fast = sdk.handler?.(fastMessage);
    await fast;

    expect(sdk.reply).toHaveBeenCalledWith(fastMessage, "fast");
    expect(sdk.reply).not.toHaveBeenCalledWith(slowMessage, "slow");
    releaseFirstUser();
    await slow;
  });

  it("invalidates old queued work after logout without blocking a new login", async () => {
    let releaseOldRequest!: () => void;
    const oldRequest = new Promise<void>((resolve) => {
      releaseOldRequest = resolve;
    });
    const inbound = vi.fn()
      .mockImplementationOnce(() => oldRequest.then(() => ({
        text: "old-first",
        files: [],
        failedFiles: [],
        failedDeclarations: 0,
      })))
      .mockResolvedValue({
        text: "new",
        files: [],
        failedFiles: [],
        failedDeclarations: 0,
      });
    getWeChatWorker().setInboundHandler(inbound);
    getWeChatWorker().startLogin();

    const oldHandler = sdk.handler;
    const oldFirst = oldHandler?.({ userId: "same-user", text: "old-first" });
    const oldQueued = oldHandler?.({ userId: "same-user", text: "old-queued" });
    await vi.waitFor(() => expect(inbound).toHaveBeenCalledTimes(1));

    getWeChatWorker().stop();
    getWeChatWorker().startLogin();
    const newMessage = { userId: "same-user", text: "new" };
    const newRequest = sdk.handler?.(newMessage);
    await newRequest;

    expect(inbound).toHaveBeenCalledTimes(2);
    expect(sdk.reply).toHaveBeenCalledWith(newMessage, "new");

    releaseOldRequest();
    await Promise.all([oldFirst, oldQueued]);
    expect(inbound).toHaveBeenCalledTimes(2);
    expect(sdk.reply).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: "old-first" }),
      "old-first",
    );
  });
});

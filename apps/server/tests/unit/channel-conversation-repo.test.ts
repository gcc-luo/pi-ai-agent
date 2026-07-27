import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { ChannelRepository } from "../../src/db/repositories/channel.js";
import { ChannelConversationRepository } from "../../src/db/repositories/channel-conversation.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";

describe("ChannelConversationRepository", () => {
  let db: Database.Database;
  let repository: ChannelConversationRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repository = new ChannelConversationRepository(db);
  });

  it("lists only the conversations bound to the requested channel", () => {
    const projects = new ProjectRepository(db);
    const sessions = new SessionRepository(db);
    const channels = new ChannelRepository(db);
    const projectId = projects.create({ name: "demo", workdir: "/tmp/demo" }).id;
    const wechat = channels.create({ type: "wechat", name: "WeChat", config: {} });
    const dingtalk = channels.create({ type: "dingtalk", name: "DingTalk", config: {} });
    const alice = sessions.create({ projectId }).id;
    const bob = sessions.create({ projectId }).id;

    repository.bind(wechat.id, "wxid_alice", alice);
    repository.bind(dingtalk.id, "ding_bob", bob);

    expect(repository.list(wechat.id)).toMatchObject([
      { channelId: wechat.id, userId: "wxid_alice", sessionId: alice },
    ]);
  });
});

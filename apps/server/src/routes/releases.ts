import type { FastifyPluginAsync } from "fastify";

export const RELEASE_API_URL =
  "https://api.github.com/repos/gcc-luo/pi-ai-agent/releases/latest";

interface GitHubRelease {
  tag_name?: unknown;
  body?: unknown;
  published_at?: unknown;
}

export const releaseRoutes: FastifyPluginAsync = async (app) => {
  app.get("/release-info", async (_request, reply) => {
    try {
      const response = await fetch(RELEASE_API_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "PI-AI-Agent",
        },
      });
      if (!response.ok) {
        return reply.code(502).send({ error: `release information unavailable: ${response.status}` });
      }

      const release = await response.json() as GitHubRelease;
      if (typeof release.tag_name !== "string" || !release.tag_name) {
        return reply.code(502).send({ error: "release information has no version" });
      }

      return {
        version: release.tag_name.replace(/^v/, ""),
        date: typeof release.published_at === "string" ? release.published_at : null,
        body: typeof release.body === "string" ? release.body : "",
      };
    } catch (error) {
      app.log.warn({ err: error }, "failed to load release manifest");
      return reply.code(502).send({ error: "failed to load release information" });
    }
  });
};

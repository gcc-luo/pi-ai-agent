import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// This belongs in the stable system prefix, not in every persisted user turn.
const ARTIFACT_POLICY = `<pi-web-ui-artifacts>
创建交付文件后，在回复末尾声明：<artifacts>[{"path":"项目根目录的相对路径","name":"文件名","mimeType":"MIME类型"}]</artifacts>。仅列出已写入磁盘的最终文件，多个文件共用一个 JSON 数组；不列中间产物或临时文件。没有交付文件时省略。
</pi-web-ui-artifacts>`;

export default function contextPolicy(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: event.systemPrompt.includes(ARTIFACT_POLICY)
      ? event.systemPrompt
      : `${event.systemPrompt}\n\n${ARTIFACT_POLICY}`,
  }));
}

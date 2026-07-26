import type { ChannelDescriptor } from "@pi-web-ui/shared";

// Static metadata for each channel card. Drives the UI and the config form.
export const CHANNEL_DESCRIPTORS: ChannelDescriptor[] = [
  {
    type: "dingtalk",
    label: "钉钉",
    icon: "💬",
    description: "通过钉钉智能机器人 Stream 长连接推送消息到指定会话",
    available: true,
    configSchema: [
      { kind: "string", key: "clientId", label: "Client ID (AppKey)", required: true, placeholder: "dingXXXX" },
      { kind: "string", key: "clientSecret", label: "Client Secret (AppSecret)", required: true, secret: true },
      { kind: "string", key: "robotCode", label: "Robot Code (默认同 Client ID)", placeholder: "可选,留空则同 Client ID" },
    ],
  },
  {
    type: "wecom",
    label: "企业微信",
    icon: "🏢",
    description: "通过企业微信群机器人推送消息",
    available: true,
    configSchema: [
      { kind: "string", key: "botId", label: "Bot ID", required: true, placeholder: "企业微信群机器人 ID" },
      { kind: "string", key: "secret", label: "Secret", required: true, secret: true },
    ],
  },
  {
    type: "wechat",
    label: "微信",
    icon: "💚",
    description: "需独立 SDK (@wechatbot/wechatbot),架构为扫码登录长驻进程,后续按需扩展",
    available: false,
    configSchema: [],
  },
];

export function findDescriptor(type: string): ChannelDescriptor | undefined {
  return CHANNEL_DESCRIPTORS.find((d) => d.type === type);
}

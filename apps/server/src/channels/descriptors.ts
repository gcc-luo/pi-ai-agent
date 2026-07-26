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
    description: "通过 @wechatbot/wechatbot SDK 扫码登录个人微信号,推送到已给 bot 发过消息的用户",
    available: true,
    configSchema: [],
  },
];

export function findDescriptor(type: string): ChannelDescriptor | undefined {
  return CHANNEL_DESCRIPTORS.find((d) => d.type === type);
}

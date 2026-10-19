import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "vue/compiler-sfc";
import { describe, expect, it } from "vitest";

type TemplateNode = {
  type: number;
  tag?: string;
  props?: Array<{ type: number; name?: string; value?: { content: string }; arg?: { content: string } }>;
  children?: TemplateNode[];
};

function findElement(node: TemplateNode | undefined, predicate: (node: TemplateNode) => boolean): TemplateNode | null {
  if (!node) return null;
  if (node.type === 1 && predicate(node)) return node;
  for (const child of node.children ?? []) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function contains(parent: TemplateNode | null, target: TemplateNode | null): boolean {
  if (!parent || !target) return false;
  if (parent === target) return true;
  return (parent.children ?? []).some((child) => contains(child, target));
}

function hasClass(node: TemplateNode, className: string): boolean {
  return node.props?.some((prop) =>
    prop.type === 6 && prop.name === "class" && prop.value?.content.split(/\s+/).includes(className),
  ) ?? false;
}

describe("workspace tool panel placement", () => {
  it("keeps session panels in the chat body under a persistent chat layout", () => {
    const source = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
    const { descriptor, errors } = parse(source);
    const root = descriptor.template?.ast as unknown as TemplateNode | undefined;
    const workspaceBody = findElement(root, (node) => node.tag === "div" && hasClass(node, "workspace-body"));
    const panel = findElement(root, (node) => node.tag === "WorkspaceToolPanel");
    const chatLayout = findElement(root, (node) => node.tag === "div" && hasClass(node, "chat-layout"));
    const usesShow = chatLayout?.props?.some((prop) => prop.type === 7 && prop.name === "show") ?? false;

    expect(errors).toEqual([]);
    expect(workspaceBody).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(contains(workspaceBody, panel)).toBe(true);
    expect(contains(chatLayout, panel)).toBe(true);
    expect(usesShow).toBe(true);
  });
});

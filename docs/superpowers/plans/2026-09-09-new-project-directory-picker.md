# 新建项目目录选择器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 简化新建项目流程：桌面端直接使用系统目录选择器，浏览器端使用精简目录浏览器，两端都根据最终目录名自动创建项目。

**Architecture:** 保持 `NewProjectDialog` 的 `create(name, workdir)` 事件和后端创建接口不变，在组件内部按 Tauri/浏览器环境选择目录来源。跨平台路径末级名称提取独立为纯函数，供桌面端和浏览器端共用并单测。

**Tech Stack:** Vue 3、TypeScript、Naive UI、Tauri 2 dialog plugin、Vitest、Vite、Fastify。

---

### Task 1: 提取并测试项目目录名称解析

**Files:**
- Create: `apps/web/src/utils/project-path.ts`
- Create: `apps/web/src/utils/project-path.test.ts`

- [ ] **Step 1: Write the failing tests**

在 `project-path.test.ts` 中覆盖 Windows、POSIX、尾部分隔符和根目录：

```ts
import { describe, expect, it } from "vitest";
import { projectNameFromPath } from "./project-path.js";

describe("projectNameFromPath", () => {
  it("extracts the final Windows directory name", () => {
    expect(projectNameFromPath("C:\\Users\\gengcc\\IdeaProjects\\demo")).toBe("demo");
  });

  it("extracts the final POSIX directory name", () => {
    expect(projectNameFromPath("/home/gengcc/projects/demo")).toBe("demo");
  });

  it("ignores trailing separators", () => {
    expect(projectNameFromPath("C:\\work\\demo\\")).toBe("demo");
    expect(projectNameFromPath("/work/demo/")).toBe("demo");
  });

  it("falls back for filesystem roots", () => {
    expect(projectNameFromPath("C:\\")).toBe("Untitled");
    expect(projectNameFromPath("/")).toBe("Untitled");
    expect(projectNameFromPath("")).toBe("Untitled");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @pi-web-ui/web exec vitest run src/utils/project-path.test.ts`

Expected: FAIL because `apps/web/src/utils/project-path.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal path helper**

Create `project-path.ts` with this behavior:

```ts
export function projectNameFromPath(workdir: string): string {
  const trimmed = workdir.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "Untitled";
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "Untitled";
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm --filter @pi-web-ui/web exec vitest run src/utils/project-path.test.ts`

Expected: 4 tests PASS.

### Task 2: Add the desktop dialog dependency and define picker behavior

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/src/components/NewProjectDialog.vue`

- [ ] **Step 1: Add the existing workspace-compatible Tauri dialog package**

Run: `pnpm --filter @pi-web-ui/web add @tauri-apps/plugin-dialog@^2.2.0`

Expected: `apps/web/package.json` gains the dependency and `pnpm-lock.yaml` gains the `apps/web` importer entry without changing unrelated package versions.

- [ ] **Step 2: Add the desktop picker branch before changing browser behavior**

In `NewProjectDialog.vue`, import `isTauri` and `projectNameFromPath`, add a `creating` ref, and implement a function with this contract:

```ts
async function chooseDesktopDirectory() {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string" || !selected) return;
    creating.value = true;
    emit("create", projectNameFromPath(selected), selected);
    emit("close");
  } catch (error) {
    console.error("Failed to choose project directory", error);
    emit("close");
  } finally {
    creating.value = false;
  }
}
```

When `show` becomes true, call `chooseDesktopDirectory()` and return for Tauri; do not call `api.browseDir` in desktop mode. This makes opening the dialog itself launch the native folder picker.

- [ ] **Step 3: Run type checking to catch the Tauri import and event errors**

Run: `pnpm --filter @pi-web-ui/web typecheck`

Expected: PASS with no missing-package or invalid dialog option errors.

### Task 3: Simplify the browser directory flow

**Files:**
- Modify: `apps/web/src/components/NewProjectDialog.vue`
- Modify: `apps/web/src/i18n/messages.ts`

- [ ] **Step 1: Write browser interaction tests before finalizing the template**

Create `apps/web/tests/unit/new-project-dialog.test.ts` with Naive UI stubs and mocked `api.browseDir`. The test setup must import `mount`, `flushPromises`, `nextTick`, and `vi`, then create shared hoisted mocks:

```ts
const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  open: vi.fn(),
  browseDir: vi.fn(),
}));

vi.mock("../../src/utils/platform.js", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../src/api/client.js", () => ({ api: { browseDir: mocks.browseDir } }));

const isTauriMock = mocks.isTauri;
const mockOpen = mocks.open;
const browseDirMock = mocks.browseDir;
```

Define `mountDialog(show, browseResult)` to set `browseDirMock`'s resolved value and mount `NewProjectDialog` with `Modal` and `Input` stubs matching the existing Naive UI test convention. Cover these cases:

```ts
it("uses the current directory when choosing the current location", async () => {
  const wrapper = mountDialog(true, {
    currentPath: "C:\\Users\\gengcc\\IdeaProjects",
    parentPath: "C:\\Users\\gengcc",
    directories: [],
  });

  await wrapper.find("[data-test='choose-current-directory']").trigger("click");

  expect(wrapper.emitted("create")).toEqual([[
    "IdeaProjects",
    "C:\\Users\\gengcc\\IdeaProjects",
  ]]);
  expect(wrapper.emitted("close")).toBeDefined();
});

it("enters a directory on double click without creating it", async () => {
  const wrapper = mountDialog(true, {
    currentPath: "C:\\Users\\gengcc",
    parentPath: "C:\\Users",
    directories: [{ name: "IdeaProjects", path: "C:\\Users\\gengcc\\IdeaProjects" }],
  });

  await wrapper.find("[data-test='directory-item']").trigger("dblclick");

  expect(browseDirMock).toHaveBeenCalledWith("C:\\Users\\gengcc\\IdeaProjects");
  expect(wrapper.emitted("create")).toBeUndefined();
});

it("does not create when the desktop picker is cancelled", async () => {
  isTauriMock.mockReturnValue(true);
  mockOpen.mockResolvedValue(null);
  const wrapper = mountDialog(true);

  await flushPromises();

  expect(mockOpen).toHaveBeenCalledWith({ directory: true, multiple: false });
  expect(wrapper.emitted("create")).toBeUndefined();
});
```

Reset `isTauriMock`, `mockOpen`, and `browseDirMock` in `beforeEach` so browser and desktop cases remain isolated. Use `data-test` attributes for the directory item and current-directory action rather than relying on CSS classes.

- [ ] **Step 2: Run the new focused tests and verify the expected failures**

Run: `pnpm --filter @pi-web-ui/web exec vitest run tests/unit/new-project-dialog.test.ts`

Expected: FAIL because the new action, desktop branch, and test attributes are not implemented.

- [ ] **Step 3: Remove manual name and manual-path controls from the browser template**

Keep the path bar, directory list, loading state, empty state, and parent navigation. Remove:

- the manual path input and “Go” button;
- the editable project name row;
- the old create button that depended on `projectName`.

Add a primary action:

```html
<button
  data-test="choose-current-directory"
  class="btn-create"
  :disabled="loading || creating || !currentPath"
  @click="chooseCurrentDirectory"
>
  {{ t('newProject.chooseCurrentDirectory') }}
</button>
```

Use `data-test="directory-item"` on each directory row. Keep single click as selection only, double click as navigation, and make `chooseCurrentDirectory` use `selectedPath ?? currentPath`, derive the name with `projectNameFromPath`, emit `create`, then close.

- [ ] **Step 4: Update localized strings**

Add English and Chinese entries:

```ts
"newProject.chooseCurrentDirectory": "Choose This Folder",
// 中文："选择此目录"
```

Retain strings needed by the browser directory list and remove only strings that no longer have consumers (`manualPath`, `go`, `name`, `create`) after confirming no other component references them.

- [ ] **Step 5: Run focused tests and type checking**

Run: `pnpm --filter @pi-web-ui/web exec vitest run tests/unit/new-project-dialog.test.ts src/utils/project-path.test.ts`

Expected: all new project dialog and path helper tests PASS.

Run: `pnpm --filter @pi-web-ui/web typecheck`

Expected: PASS.

### Task 4: Verify the complete change and working tree

**Files:**
- No additional product files; inspect all files changed by Tasks 1–3.

- [ ] **Step 1: Run the complete web test suite**

Run: `pnpm --filter @pi-web-ui/web test`

Expected: PASS with no regressions in project manager, welcome page, or existing API tests.

- [ ] **Step 2: Run the web production build**

Run: `pnpm --filter @pi-web-ui/web build`

Expected: `vue-tsc` and Vite build both complete successfully.

- [ ] **Step 3: Manually verify both platform paths**

1. Start the local backend and desktop dev app.
2. In Tauri, click “新建项目”, choose a folder in the system dialog, and verify the project appears with the final directory name.
3. Open the web UI, click “新建项目”, verify double-click navigation, choose the current directory, and verify the project appears with the final directory name.
4. Cancel the Tauri picker and close the browser dialog; verify no project is created.

- [ ] **Step 4: Inspect final git state**

Run: `git status --short; git diff --check`

Expected: only the planned source, test, dependency, lockfile, and documentation files are changed; `git diff --check` reports no whitespace errors.

# 桌面端启动体验实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** Windows 桌面端不显示命令窗口，并在后端启动期间展示主窗口内的加载界面。

**架构：** 将立即可渲染的启动屏放入 `apps/web/index.html`，由现有 `bootstrap` 成功挂载 Vue 或失败渲染错误页替换。Windows 运行时解压命令在 Rust 层设置 `CREATE_NO_WINDOW`，确保即使首次启动需要调用 `tar.exe` 也没有控制台窗口。

**技术栈：** Vue 3、Vite、Tauri 2、Rust 标准库、Vitest。

---

### 任务 1：预置启动屏

**文件：**
- 修改：`apps/web/index.html`
- 测试：`apps/web/tests/unit/startup-screen.test.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
expect(document.querySelector('[data-startup-screen]')).not.toBeNull();
expect(document.querySelector('[data-startup-message]')?.textContent).toContain('正在启动本地服务');
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm --filter @pi-web-ui/web exec vitest run tests/unit/startup-screen.test.ts`

预期：FAIL，因为启动 HTML 尚未包含 `data-startup-screen`。

- [ ] **步骤 3：实现最少启动屏**

在 `#app` 内加入 `data-startup-screen` 容器、品牌徽标、`data-startup-message` 文案和内联 CSS 动画。启动屏必须使用纯 HTML/CSS，且不依赖 Vue 或网络字体。

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm --filter @pi-web-ui/web exec vitest run tests/unit/startup-screen.test.ts`

预期：PASS。

### 任务 2：隐藏 Windows 解压进程

**文件：**
- 修改：`apps/desktop/src-tauri/src/lib.rs`
- 测试：`apps/desktop/src-tauri/src/lib.rs` 内部单元测试

- [ ] **步骤 1：编写失败的测试**

```rust
#[cfg(target_os = "windows")]
#[test]
fn windows_tar_command_hides_its_console_window() {
    assert_eq!(windows_tar_creation_flags(), 0x0800_0000);
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cargo test windows_tar_command_hides_its_console_window --manifest-path apps/desktop/src-tauri/Cargo.toml`

预期：FAIL，因为 `windows_tar_creation_flags` 尚未定义。

- [ ] **步骤 3：实现最少隐藏标志**

定义 `windows_tar_creation_flags() -> u32`，返回 Windows `CREATE_NO_WINDOW` 值；在 `extract_archive` 内导入 `std::os::windows::process::CommandExt` 并调用 `Command::creation_flags`。

- [ ] **步骤 4：运行测试验证通过**

运行：`cargo test windows_tar_command_hides_its_console_window --manifest-path apps/desktop/src-tauri/Cargo.toml`

预期：PASS。

### 任务 3：验证启动与安装包

**文件：**
- 验证：`apps/web/index.html`
- 验证：`apps/desktop/src-tauri/target/release/bundle/`

- [ ] **步骤 1：运行前端启动屏测试和前端构建**

运行：`pnpm --filter @pi-web-ui/web test -- --run tests/unit/startup-screen.test.ts && pnpm --filter @pi-web-ui/web build`

预期：测试和构建均以 exit code 0 结束。

- [ ] **步骤 2：运行 Rust 单元测试和 Windows 安装包构建**

运行：`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml && pnpm --dir apps/desktop exec tauri build --bundles nsis`

预期：测试和构建均以 exit code 0 结束，并生成 `PI AI Agent_1.2.5_x64-setup.exe`。

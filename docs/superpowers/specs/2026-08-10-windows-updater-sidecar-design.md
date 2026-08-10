# Windows 更新期间 Sidecar 文件占用修复设计

## 背景与根因

PI-AI-Agent 1.3.2 在 Windows 上通过 Tauri Updater 启动 NSIS 安装器。
桌面主进程同时启动安装目录中的 `pi-node.exe` 作为后端 sidecar。

Tauri Updater 在 Windows 上的安装路径会调用
`AppHandle::cleanup_before_exit()`，启动 NSIS 后直接调用
`std::process::exit(0)`。项目当前仅在 `RunEvent::Exit` 中结束 sidecar，
因此更新器的直接退出绕过了这段清理逻辑。遗留的 `pi-node.exe` 继续占用
自身镜像，NSIS 无法覆盖该文件并显示“Error opening file for writing”。

用户取消安装后，主程序和注册表可能已更新到新版本，而 sidecar 仍处于旧进程
占用或待替换状态，形成部分安装。再次启动时可能返回 Windows
`OS error 5（拒绝访问）`。

现场证据：

- 安装目录与卸载注册表显示版本 1.3.2；远端 `latest.json` 也是 1.3.2。
- `pi-agent.exe` 已是 1.3.2，但仍存在父进程已退出的孤儿
  `pi-node.exe`。
- 更新安装包仍保留在 Tauri Updater 的临时目录，可用于恢复安装。

## 目标

1. 正常更新时，在 NSIS 覆盖文件前可靠结束当前应用管理的 sidecar。
2. 修复版安装器能够处理由 1.3.2 等旧版本遗留的孤儿 sidecar。
3. 清理失败时停止安装，避免制造新的部分安装。
4. 后端无法启动时仍显示桌面应用版本，便于判断更新状态。
5. 安全恢复当前机器上的 1.3.2 部分安装，并验证完整启动。

## 非目标

- 不重构服务端启动架构或运行时缓存结构。
- 不按进程名全局结束所有 `pi-node.exe`。
- 不自动删除用户数据、缓存、会话或配置。
- 不改变 macOS 和 Linux 的更新安装行为。

## 方案

采用“应用主动清理 + 安装器兜底”的双层防护。

### 1. 统一 Sidecar 生命周期清理

在 Rust 桌面端提取单一的 sidecar 停止函数，供正常退出和更新准备共同使用。
停止流程必须是幂等的：没有子进程时直接成功；存在子进程时记录 PID、发送结束
请求，并等待终止事件。只有确认进程退出后才返回成功；等待超时或结束失败时返回
明确错误。

新增受 Tauri capability 控制的 `prepare_for_update` 命令。前端在调用
`pendingUpdate.install()` 前先调用该命令。命令失败时不启动安装器，并把错误显示
在更新对话框中。这样正常更新不会让安装器与活动 sidecar 竞争文件。

现有 `RunEvent::Exit` 也调用同一停止函数，避免两套退出逻辑继续分叉。

### 2. NSIS 安装器兜底

增加 NSIS `PREINSTALL` hook。hook 仅查找 `ExecutablePath` 与
`$INSTDIR\pi-node.exe` 完全相同的进程，结束后等待退出，再允许文件解压。

该兜底不能只依赖修复后的前端代码，因为从 1.3.2 更新到首个修复版时，执行更新
的仍是旧前端。安装器 hook 随新安装包分发，可以处理旧版本留下的孤儿进程。

hook 不使用全局 `taskkill /IM pi-node.exe`，避免影响其他目录中的 Node sidecar。
无法确认或结束目标进程时，安装器中止并提示用户关闭应用，而不是忽略文件继续
安装。

### 3. 安装失败后的可见性

后端启动失败视图从 Tauri 的应用 API 独立读取并显示当前主程序版本，不依赖后端
HTTP 服务。版本文字明确标注为“主程序版本”，不把它等同于完整安装成功。

更新错误信息继续保留底层原因；若 `prepare_for_update` 失败，提示用户关闭应用后
重试，不进入 NSIS。

### 4. 当前安装恢复

恢复操作严格限制到已确认的安装路径：

1. 关闭当前 `D:\pi\PI-AI-Agent\pi-agent.exe`。
2. 结束可执行路径完全等于
   `D:\pi\PI-AI-Agent\pi-node.exe` 的孤儿进程。
3. 确认两个进程均退出，且目标目录仍为
   `D:\pi\PI-AI-Agent`。
4. 运行已下载的完整 1.3.2 安装包覆盖修复，不卸载、不删除用户数据。
5. 启动应用，确认 sidecar 正常运行、界面可访问，并核对主程序与注册表版本。

## 数据流

正常更新路径：

1. 前端完成更新包下载并进入 `ready`。
2. 用户选择安装。
3. 前端调用 `prepare_for_update`。
4. Rust 停止受管 sidecar 并等待退出。
5. 前端调用 Tauri Updater `install()`。
6. NSIS `PREINSTALL` hook 检查同安装路径的遗留 sidecar。
7. NSIS 覆盖安装文件并重新启动应用。

旧版本迁移路径省略第 3、4 步，由第 6 步清理遗留进程。

## 错误处理

- Sidecar 已退出：视为成功。
- Sidecar 结束失败或超时：`prepare_for_update` 返回错误，前端不调用安装器。
- NSIS 发现同路径孤儿进程：结束并等待；失败则中止安装。
- 更新器在准备阶段报错：保留当前应用，不伪装成安装成功。
- 恢复安装失败：保留现场文件和安装包，报告具体步骤，不执行卸载或目录清理。

## 测试与验收

### 自动化测试

- Rust 单元测试覆盖无 sidecar、正常停止、重复停止及超时/失败结果。
- Web store 测试断言 `prepare_for_update` 在 `install()` 之前调用。
- Web store 测试断言准备失败时不会调用 `install()` 或 `relaunch()`。
- Desktop 配置测试断言 NSIS installer hook 已配置，且 hook 不包含全局
  `/IM pi-node.exe` 结束方式。
- 启动失败视图测试断言即使后端不可用也能展示主程序版本。

### 构建与现场验收

- 运行 web、desktop 相关测试和 Rust 测试。
- 完成 web 与 desktop 构建，确认 NSIS 包成功生成。
- 在安装目录 sidecar 正在运行时启动新安装包，确认不再出现写入错误。
- 模拟孤儿 sidecar，验证 NSIS hook 只结束安装目录中的目标进程。
- 恢复当前安装后确认：应用可启动、后端端口可用、设置页显示 1.3.2，且没有
  遗留的旧 sidecar。

## 安全边界

所有进程清理都以 PID 和完整可执行路径双重约束。恢复过程不卸载应用、不删除
安装目录、不修改用户数据目录。任何路径或进程身份不匹配时停止并报告，不扩大
清理范围。

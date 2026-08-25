# KC · 自动记忆编译流水线（knowledge-compiler）

KC 是一个本地知识提取工具：监听 Codex 自动落盘的 `rollout-*.jsonl` 会话文件，调用 OpenAI 兼容 LLM，把对话与工具动作提炼成 **L1 洞察 / L2 框架 / L3 决策规则**，写回 Markdown 知识库。

本仓库包含两大部分：

- `KC/`：完整项目源码（Node 核心 + Tauri 2 托盘壳），详细说明见 [`KC/README.md`](./KC/README.md)。
- `release/`：构建产物。

## 交付物

| 文件 | 说明 |
| :-- | :-- |
| `release/KC_0.1.0_x64-setup.exe` | NSIS 安装包 |
| `release/KC_0.1.0_x64-portable-*.zip` | 便携 ZIP，解压后运行 `KC.exe` |

## 快速开始

- 桌面托盘版：安装 `setup.exe` 或解压便携 ZIP，双击 `KC.exe`，在托盘菜单「设置」里配置 LLM key、扫描间隔、知识库目录。
- CLI / 开发：进入 `KC/`，按 [`KC/README.md`](./KC/README.md) 操作。

## 目录

```
knowledge-compiler/
  KC/          # 项目源码
  release/     # 构建产物
```

## 构建

构建说明见 [`KC/README.md`](./KC/README.md) 与 [`KC/项目细节/后台exe化-Tauri路线-项目计划书.md`](./KC/项目细节/后台exe化-Tauri路线-项目计划书.md)。

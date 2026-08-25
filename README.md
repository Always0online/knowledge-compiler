# KC：自动记忆编译流水线

KC 是一个本地知识提取工具：监听 Codex 自动落盘的会话文件（`rollout-*.jsonl`），调用 OpenAI 兼容 LLM 把对话和工具动作提炼成 **L1 洞察 / L2 框架 / L3 决策规则**，写回 Markdown 知识库。

从 0.1.0 起，KC 提供两种交付形态：

- **桌面托盘程序（推荐）**：Tauri 2 托盘壳 + Node sidecar，常驻后台、带系统托盘、单实例、可选开机自启。
- **CLI**：`scan` / `watch` / `process` 三个命令，保持原有能力。

## 特性

- 文件监听使用 `chokidar`（`awaitWriteFinish`）+ 轮询兜底。
- 状态机 `pending / processing / done / error`，启动时重置超时 `processing`，崩溃可恢复。
- 状态写入为 JSONL 追加 + 路径归一化去重；同一文件重复处理不会重复入库。
- LLM 请求前做敏感信息脱敏与 token 截断，JSON 提取使用平衡括号解析。
- 一轮扫描只重建一次全局索引和各领域索引。
- 结构化日志：`logs/kc-YYYY-MM-DD.log` 与 `logs/kc-YYYY-MM-DD.jsonl`。
- 无 API key 时自动进入 mock 提取，便于无 key 验证全链路。

## 交付物

构建产物发布在 GitHub Releases（本仓库不提交 `release/`，已加入 `.gitignore`）：

- `KC_0.1.0_x64-setup.exe`：NSIS 安装包。
- `KC_0.1.0_x64-portable-*.zip`：便携 ZIP，解压后运行 `KC.exe`。

## 快速开始（桌面托盘版）

1. 安装 `KC_0.1.0_x64-setup.exe`，或解压便携 ZIP 后双击 `KC.exe`。
2. 系统托盘会出现 KC 图标，状态显示「空闲 / 扫描中 / 出错」。
3. 右键托盘图标 →「设置」，填写：
   - LLM API Key
   - 扫描间隔（毫秒）
   - 知识库目录
   - 开机自启开关
4. 右键托盘图标 →「立即扫描」，或在 Codex 产生新会话后自动静默扫描入库。

托盘菜单：立即扫描、暂停、设置、打开知识库、打开日志、退出。

## 快速开始（CLI / 开发）

1. 安装依赖：

   ```powershell
   npm install
   ```

2. 复制配置：

   ```powershell
   Copy-Item config/.env.example config/.env
   ```

3. 填写 `config/.env`（空 API key 会走 mock）。

4. 运行：

   ```bash
   npm run scan          # 单次扫描
   npm run watch         # 持续监听
   npm run watch:json    # 供托盘壳使用的 JSONL 协议模式
   npm run process -- fixtures/sample-rollout.jsonl
   ```

## 配置项

| 变量 | 说明 | 默认 |
| :--- | :--- | :--- |
| `EXTRACT_LLM_API_KEY` | 提取 LLM key，空则走 mock | 空 |
| `EXTRACT_LLM_BASE_URL` | OpenAI 兼容 base URL | `https://api.deepseek.com/v1` |
| `EXTRACT_LLM_MODEL` | 模型名 | `deepseek-chat` |
| `KC_SESSIONS_DIR` | Codex sessions 目录 | `~/.codex/sessions` |
| `KC_KNOWLEDGE_DIR` | 知识库输出目录 | 项目内 `knowledge_library` |
| `KC_COOLDOWN_MS` | 文件静默阈值(ms) | `300000` |
| `KC_SCAN_INTERVAL_MS` | 监听扫描间隔(ms) | `60000` |

桌面托盘版的设置保存在用户数据目录下的 `.state/settings.json`；CLI 版读取 `config/.env`。

## 目录结构

```
.
  src/
    core/                 # 核心引擎（配置/扫描/队列/提取/存储/状态/日志/事件）
    cli.mjs               # CLI 入口
    run.mjs               # sidecar 打包入口
  src-tauri/              # Tauri 2 托盘壳（Rust）
  ui/                     # 极简设置窗口
  config/                 # .env.example、extraction-agent.md
  fixtures/               # 测试夹具
  scripts/                # 任务计划程序包装脚本
```

## 从源码构建 sidecar / 托盘壳

```powershell
# 1. sidecar（Node SEA）
npx esbuild src/run.mjs --bundle --platform=node --format=cjs --outfile=dist/kc-core.cjs
node --experimental-sea-config sea-config.json
# 复制 node.exe 为 kc-core.exe 后用 postject 注入 blob

# 2. 托盘壳 + 安装包
npx tauri build
```

详细步骤见 `项目细节/后台exe化-Tauri路线-项目计划书.md`。

## 说明

核心引擎与壳解耦，`src/core/` 同时被 CLI 和托盘程序复用。sidecar 与壳之间通过 stdin/stdout JSONL 协议通信。


# KC 后台 EXE 化 · Tauri 路线项目计划书

> 版本：0.1（B 路线专项计划）
> 日期：2026-08-25
> 对象：仓库内 KC 目录（`kc-repo/KC`）
> 结论：KC 走 **B 路线（Tauri 2 托盘壳）**，核心先保留 Node（B1 sidecar），纯 Rust 原生核心（B2）作为后续可选项。本计划书只确定方案与阶段，不直接改代码。

---

## 1. 路线锁定

用户已确认走 **B 路线：Tauri 2 托盘桌面程序**，目标体验对齐 CC Switch：

- 单个可双击 exe（优先 portable，另出安装包）。
- 常驻系统托盘，无控制台黑窗。
- 托盘图标反映「空闲 / 扫描中 / 出错」。
- 托盘菜单：立即扫描、暂停/恢复、打开知识库、打开配置、打开日志、开机自启开关、退出。
- 单实例锁、优雅退出、可选开机自启。

### B1 vs B2 默认选择

| 子路线 | 核心实现 | 体积/内存 | 工作量 | 首期选择 |
| :-- | :-- | :-- | :-- | :-- |
| B1 | Node 核心编译为 sidecar，Tauri 壳 spawn | 中等（Node runtime 体积） | 低 | **默认采用** |
| B2 | 核心用 Rust 重写，Tauri 内部直接调用 | 最优（单 exe 10~20MB） | 高 | 后续可选 |

> 若用户后续明确要「极致轻量单 exe」，再启动 B2。首期不阻塞。

---

## 2. 目标与范围

### 2.1 目标
1. 补齐 KC 自动化检测/提取的工程短板。
2. 把 KC 做成 Tauri 2 托盘后台 exe，CLI 能力不退化。
3. 保持核心逻辑与壳解耦，同一套 `core/` 供 CLI 与托盘共用。

### 2.2 范围（本计划内）
- 核心解耦、检测/提取增强。
- Node 核心打包 sidecar。
- Tauri 2 托盘壳、单实例、开机自启、日志。
- Windows 打包与发布检查。

### 2.3 不做
- 首期不做全功能 GUI（只做托盘 + 可选最小设置窗）。
- 首期不做 macOS/Linux 发布。
- B2 Rust 原生核心作为后续可选。

---

## 3. 现状问题（已核对源码）

| # | 问题 | 现状 |
| :-- | :-- | :-- |
| 1 | 文件发现靠轮询 `walkFiles` | 无 chokidar，规格未落实 |
| 2 | `scan()` 单点异常即中断 | 坏文件会拖垮整轮 |
| 3 | 状态机未落地 | 只有 map 覆写，无 `processing/error`，无崩溃恢复 |
| 4 | 状态读写脆弱 | 每文件 `loadState` + 整表 `saveState` |
| 5 | 每轮全文件 sha256 | 大文件浪费 IO |
| 6 | 无 token 截断 | 规格 30000，代码未实现 |
| 7 | 无敏感信息脱敏 | 云端外发有风险 |
| 8 | 索引每存一条重建一次 | 慢且多余写盘 |
| 9 | 无结构化日志 | 只有 console |
| 10 | JSON 提取脆弱 | 贪婪正则遇嵌套花括号会错 |
| 11 | mock/真实分支不一致 | `mergeWithLLM` 无 key 仍 fetch |

---

## 4. 总体架构

```
┌─────────────────────────────────────────────┐
│  Tauri 2 托盘壳（Rust，单 exe）              │
│  - 托盘图标 / 菜单 / tooltip                 │
│  - 单实例 / 开机自启                         │
│  - spawn & 管理 kc-core sidecar              │
└────────────────┬────────────────────────────┘
                 │ JSONL（stdin/stdout）
┌────────────────▼────────────────────────────┐
│  kc-core（Node sidecar，长驻 watch --json）  │
│  core/scanner · queue · extractor · store    │
│  core/state · logger · events                │
└────────────────┬────────────────────────────┘
                 │ 读写
┌────────────────▼────────────────────────────┐
│  Codex sessions → rollout-*.jsonl            │
│  config/.env                                 │
│  .state/state.jsonl                          │
│  knowledge_library/**                        │
│  logs/kc.log + kc.jsonl                      │
└─────────────────────────────────────────────┘
```

---

## 5. 分阶段计划

### M0 · 基线冻结
- 在 `knowledge-compiler\kc-repo\KC` 上确认 `npm run scan/process` 可用，fixtures 通过。
- 产出：当前行为基线，作为回归参照。

### M1 · 核心解耦 + 检测/提取增强（Node，先行）
任务：
1. `src/` 拆出 `core/`：`config / scanner / queue / extractor / store / state / logger / events`。
2. `scanner` 用 `chokidar + awaitWriteFinish`，保留轮询兜底。
3. `queue` 实现 `pending/processing/done/error`，per-file try/catch，启动重置超时 `processing`。
4. `state` 单条原子写（临时文件 + rename），按 `mtime+size+lineNo` 增量。
5. `extractor` 加 token 截断、敏感脱敏、平衡括号 JSON 解析、指数退避。
6. `store` 一轮扫描后只重建一次索引；`mergeWithLLM` 无 key 走 mock。
7. `logger` 结构化日志 + 轮转。
8. 新增 `watch --json` 模式：stdin 命令 / stdout 事件。
验收：CLI 三命令不退化；坏文件不阻断；二次扫描不重提；截断/脱敏有测试。

### M2 · Node 打包 sidecar
任务：
1. 选型 `@yao-pkg/pkg`（优先）或 Node SEA。
2. 产出 `kc-core.exe`，把 `node_modules`（含 chokidar）打包进去。
3. 验证 `kc-core.exe watch --json` 与源码行为一致。
验收：无 Node 运行时依赖下可运行。

### M3 · Tauri 托盘壳
任务：
1. 初始化 `src-tauri/`，开启 `tray-icon` feature。
2. 接入 `tauri-plugin-shell`、`tauri-plugin-single-instance`、`tauri-plugin-autostart`。
3. `main.rs` 设置 `windows_subsystem = "windows"`，tray-only，不创建默认窗口。
4. spawn sidecar，解析 stdout JSON 更新托盘状态/tooltip。
5. 菜单命令映射 sidecar stdin；退出时优雅关闭。
验收：双击 exe 出现托盘图标；扫描状态正确变化；退出后 sidecar 一并结束。

### M4 · 打包、自启、发布检查
任务：
1. `tauri build` 产出 NSIS / portable；`bundle.externalBin` 携带 sidecar。
2. 开机自启开关；单实例回归测试。
3. 干净 Windows 10/11 + WebView2 环境验证安装/卸载/便携运行。
4. 写用户说明。
验收：安装/启动无黑窗，托盘可用，卸载干净。

### M5 · 可选 B2 原生核心迁移
- 仅在用户要求极致体积/低内存时启动。
- 按同一状态 schema 与提示词，把 core 迁成 Rust；Tauri 内部直接调用，不再 spawn Node。
- 验收：行为与 B1 一致，单 exe < 20MB。

---

## 6. sidecar 协议（JSONL）

壳 → core（stdin）：
- `{"cmd":"scan-now"}`
- `{"cmd":"pause"}`
- `{"cmd":"resume"}`
- `{"cmd":"shutdown"}`

core → 壳（stdout）：
- `{"event":"started"}`
- `{"event":"scan-start"}`
- `{"event":"scan-done","items":N,"skipped":M}`
- `{"event":"error","file":"...","message":"..."}`
- `{"event":"idle","nextScanInMs":60000}`
- `{"event":"stopped"}`

stderr 走纯文本，壳读后写入日志。

---

## 7. 关键配置点

- `src-tauri/tauri.conf.json`：`bundle.externalBin: ["binaries/kc-core"]`。
- sidecar 二进制命名带目标三元组：`kc-core-x86_64-pc-windows-msvc.exe`。
- Windows 托盘图标用 `.ico`，`TrayIconBuilder` 加载。
- `Cargo.toml`：`tauri = { version = "2", features = ["tray-icon"] }`。
- `main.rs` 顶部：`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`。

---

## 8. 风险与对策

| 风险 | 对策 |
| :-- | :-- |
| sidecar 增大体积 | 首期接受；B2 可解决 |
| chokidar 破坏零依赖 | 打包进 sidecar 后对用户仍零运行时；保留轮询兜底 |
| LLM 调用阻塞主循环 | 提取异步/子进程 + 超时重试；壳显示「扫描中」 |
| 云端隐私 | 发送前脱敏，日志不记敏感字段 |
| WebView2 缺失 | 文档说明并内置/提示安装 |
| 杀毒误报 | 后续代码签名/文档说明 |
| 长时间运行内存/日志膨胀 | 日志轮转、扫描间隔、单实例 |

---

## 9. 文件变更清单（预期）

- 新增：`KC/src/core/*.mjs`、`KC/src/cli.mjs`、`KC/src/tray.mjs`
- 修改：`KC/src/index.mjs` 改为 CLI 入口；`KC/package.json` 增加脚本
- 新增：`KC/src-tauri/`（Cargo.toml、tauri.conf.json、main.rs、binaries/）
- 新增：`KC/scripts/build-sidecar.*`、`KC/scripts/build-tauri.*`
- 新增：`KC/logs/`（git 忽略）
- 修改：`KC/README.md`、`KC/项目细节/系统规格.md` 部署方式
- 本文件：`KC/项目细节/后台exe化-Tauri路线-项目计划书.md`

---

## 10. 待确认决策

1. B1 默认保留 Node 核心，是否接受 sidecar 带来的体积？（否则改 B2 原生）
2. 托盘之外是否要一个极简设置窗口（编辑 LLM key、扫描间隔）？首期计划为纯托盘。
3. 开机自启默认关闭，是否需要安装后默认开启？
4. 知识库目录沿用当前 `.env` 的 `KC_KNOWLEDGE_DIR`（可自定义）？

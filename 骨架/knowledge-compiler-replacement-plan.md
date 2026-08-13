# KC：自动记忆编译流水线（技术方案）

## 背景与问题

现有 `knowledge-compiler` 的自动萃取机制依赖大模型在对话中自觉触发。实际使用中，模型经常忘记或跳过，导致每次都需要人工提醒才会萃取。根因不是萃取逻辑写错，而是**触发机制没有确定性**。

本文档记录这套流水线的设计，目标是让「捕获」和「编译」都由事件触发，不再依赖模型自觉。

## 目标

自动捕获（不靠提醒）→ 编译成 L1/L2/L3 结构化条目 → 写回本地 Markdown 知识库。

## 核心原则

捕获和编译必须由确定性事件触发，不能写进 prompt 让模型自觉执行。

## 专用提取 LLM 方案评估

方向成立：把「知识提取」从 coding agent 中拆出，交给独立的提取 LLM，由脚本显式调用。这与 TencentDB Agent Memory 的双 LLM 架构一致（`MEMORY_LLM_*` 负责记忆处理，`PROXY_UPSTREAM_*` 负责用户请求）。

关键补充：单独接一个大模型只解决「谁来提取」，没有解决「什么时候触发」。TD 能自动跑，是因为后台 pipeline 主动调用 memory LLM，不是 coding agent 想起来才调。因此本方案必须配一个由事件触发的调用脚本。

优点：提取质量可控、成本隔离、上下文隔离、可测试可复现。

缺点：多一个 API key、一个模型、一个故障点；小模型可能分类错误或幻觉。

结论：推荐采用专用提取 LLM，由脚本显式调用；模型选便宜够用的云模型（如 DeepSeek）或本地 Ollama（如 Qwen）；暂不加向量检索，纯 Markdown 文件加索引即可。

## 数据来源与流通

Codex 每开一个会话，会自动把对话和工具动作序列化到磁盘：

```text
~/.codex/sessions/<年>/<月>/<日>/rollout-<时间戳>.jsonl
```

每行结构为 `{ timestamp, type, payload }`，其中 `response_item` 包含：

- `message` / `reasoning`：对话内容与模型思考。
- `function_call` / `function_call_output` / `custom_tool_call`：工具与脚本动作。

所以提取脚本直接从 rollout 文件读取数据，不需要「对话窗口」主动推送。二者靠磁盘上的 rollout 文件连接。

注意：rollout 是 Codex 内部格式，不是稳定公开 API，需在提取脚本前加解析适配层，格式变化只改适配器。

## 架构

```text
Codex 会话（对话 + 工具动作）
        │ 自动落盘
        ▼
sessions/YYYY/MM/DD/rollout-*.jsonl
        │ 监听器 / 定时任务（检测新文件 + 完整性 + 去重）
        ▼
解析适配器 → 组装 raw markdown
        ▼
提取 LLM：L1 洞察 / L2 框架 / L3 决策规则
        ▼
去重 → 写 knowledge_library/domains/<域>/ → 更新 index
```

## 分四层实现

### 1. 捕获层（数据来源）

Codex 原生就会把会话写成 rollout JSONL，无需自写 Hook 转存内容。捕获层职责改为：

- 解析 rollout JSONL，抽取 `message` / `reasoning` 与 `function_call` / `custom_tool_call`。
- 组装成 raw markdown，供提取 LLM 使用。

可选：Stop Hook 不再负责转存内容，只在需要时写「会话完成」标记，辅助检测层判断文件完整。

### 2. 编译层（决定 L1/L2/L3 分层）

编译脚本自行定义分类，不完全依赖 `llm-wiki-compiler`，因为后者输出的是 wiki 页面，不是 L1/L2/L3。

- L1 洞察：一句话经验、坑、技巧。
- L2 框架：可迁移方法、流程、原则。
- L3 决策规则：IF/THEN 判断。
- relevance 1-2：丢弃闸门，避免垃圾入库。

编译脚本必须幂等：同一份 raw 只编译一次，重复跑不重复写。

### 3. 调度层（检测机制）

监听 `sessions` 目录，出现新 rollout 或 rollout 变化时触发提取。推荐双层：

1. FileSystemWatcher（实时）：监听 `rollout-*.jsonl` 的新增/修改，收集候选文件进队列。
2. 定时兜底扫描（可靠）：Windows 任务计划程序每 N 分钟全量扫描一次，补上 watcher 漏掉的事件（睡眠、缓冲溢出等）。

处理前要解决两个问题：

- 完整性：rollout 在会话期间持续追加，需等待文件稳定。策略：last write 时间超过 cooldown（如 5 分钟）才处理，或使用 Stop Hook 写完成标记。
- 去重（游标）：以唯一事件 ID（`payload.id` 或 `turn_id`）作为水位线，记录每个文件最后处理到的事件 ID，下次只处理该 ID 之后的新事件；文件内容变化时用 `SHA256` 辅助判断是否重算增量。

检测流程：watcher / 定时 → 候选 rollout → 稳定性检查 → 读游标，只取新事件 → 提取脚本 → 更新游标。

### 4. 存储层

写入 `KC_KNOWLEDGE_DIR/domains/`，保持 `insights / frameworks / decision-rules` 目录与模板不变，并更新 `global-index.md` 与领域 `index.md`。

## 提取规则

提取规则与收录边界已单独整理在 [项目细节/提取规则.md](../项目细节/提取规则.md)，供外部提取 LLM 使用；实际提示词模板见 `config/extraction-agent.example.md`。

## 已定决策

1. 完成信号：文件静默 5 分钟即认为完整；Stop Hook 完成标记作为后续可选增强。
2. 提取 LLM：OpenAI 兼容接口，默认 DeepSeek，也可本地 Ollama。
3. 入库方式：未分类先入 `_inbox` 人工审核；验证稳定后改为直写。

## 实现状态

已完成：解析适配器、检测调度器、提取编译脚本、知识库落盘与索引、任务计划程序包装脚本。对应实现见 `src/` 与 `scripts/`。

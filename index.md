# KC 项目索引

> 一句话：一个替代旧 `knowledge-compiler` 的「自动记忆编译流水线」，解决「要提醒大模型才萃取」的问题。

## 项目是什么

读取 Codex 会话自动落盘的 rollout 文件，通过确定性检测和独立提取 LLM，编译成 L1/L2/L3 结构化知识，写回本地 Markdown 知识库。

## 目录结构

| 文件 | 内容 |
| :--- | :--- |
| [骨架](./骨架/knowledge-compiler-replacement-plan.md) | 主方案文档 |
| [项目细节/提取规则.md](./项目细节/提取规则.md) | 提取规则与收录边界 |
| [项目细节/系统规格.md](./项目细节/系统规格.md) | 实现契约 |

## 阅读顺序

1. [骨架](./骨架/knowledge-compiler-replacement-plan.md)
2. [提取规则](./项目细节/提取规则.md)
3. [系统规格](./项目细节/系统规格.md)

## 运行与自定义

见 [README.md](./README.md)。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.mjs';
import { chatComplete } from '../src/llm.mjs';

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.md') && name !== 'index.md') out.push(p);
  }
  return out;
}

const files = walk(path.join(config.knowledgeDir, 'domains'));
const entries = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const linesArr = text.split(/\r?\n/);
  const title = (linesArr.find((l) => l.trim().startsWith('#')) || '').replace(/^#+\s*/, '').trim() || path.basename(f, '.md');
  const body = linesArr.slice(1).join(' ').replace(/\s+/g, ' ').slice(0, 300);
  entries.push({ rel: path.relative(config.knowledgeDir, f).replace(/\\/g, '/'), title, body });
}

const sys = '你是知识库审阅助手。评估下面这些旧知识条目是否值得保留。保留标准：项目或环境特有的坑与修复、可复用经验、决策规则、用户画像。丢弃标准：互联网随手可查的通用知识、已经过时、一次性信息。输出 Markdown 表格，列：文件路径 | 标题 | 去留(保留/丢弃/合并) | 理由(一句话)。只输出表格，不要其他文字。';
const user = '旧知识库条目：\n\n' + entries.map((e, i) => `${i + 1}. [${e.rel}] ${e.title}\n   ${e.body}`).join('\n\n');

console.error('条目数=' + entries.length + ' 输入长度=' + user.length);
const table = await chatComplete([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.1 });
console.log(table);

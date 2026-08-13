import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { ensureDir, slugify } from './util.mjs';
import { chatComplete } from './llm.mjs';

const TYPE_DIR = { L1: 'insights', L2: 'frameworks', L3: 'decision-rules' };
const TYPE_LABEL = { insights: '洞察 / L1', frameworks: '框架 / L2', 'decision-rules': '决策规则 / L3' };

export async function storeItems(items) {
  for (const item of items) await storeItem(item);
  rebuildIndexes();
}

async function storeItem(item) {
  const domain = item.domain && item.domain !== 'null' ? item.domain : '_inbox';
  const type = TYPE_DIR[item.level] || 'misc';
  const slug = slugify(item.title);

  let dir;
  if (domain === '_inbox') dir = path.join(config.knowledgeDir, 'domains', '_inbox');
  else dir = path.join(config.knowledgeDir, 'domains', domain, 'wiki', type);
  ensureDir(dir);

  const filePath = path.join(dir, slug + '.md');
  const content = renderItem(item);

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf8');
    const merged = await mergeWithLLM(existing, content, item.title);
    writeFileSync(filePath, merged, 'utf8');
  } else {
    writeFileSync(filePath, content, 'utf8');
  }
}

async function mergeWithLLM(existing, incoming, title) {
  const sys = '你是知识库维护助手。把两条同主题的旧条目合并成一条，保留全部有价值信息，去除重复，按原模板输出 Markdown。只输出合并后的 Markdown，不要解释。';
  const user = `## 已有条目\n${existing}\n\n## 新条目\n${incoming}\n\n请输出合并后的单条 Markdown（标题仍用：${title}）`;
  const text = await chatComplete([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.1 });
  return text.trim() + '\n';
}

function renderItem(item) {
  const date = today();
  const source = item.source_quote ? '原文: ' + item.source_quote.replace(/\s+/g, ' ') : '自动提取';
  const related = relatedText(item.related);

  if (item.level === 'L1') {
    return lines([
      `## ${item.title}`, '',
      `来源: ${date} 对话 / ${source}`,
      '类型: L1 洞察',
      `评分: ${item.relevance ?? 3}`, '',
      '### 核心洞察', '',
      item.content || '', '',
      '### 适用场景', '',
      item.scenario || '无', '',
      '### 相关条目', '',
      related,
    ]);
  }

  if (item.level === 'L2') {
    return lines([
      `## ${item.title}`, '',
      `来源: ${date} 对话 / ${source}`,
      '类型: L2 框架',
      `评分: ${item.relevance ?? 4}`, '',
      '### 框架描述', '',
      item.content || '', '',
      '### 为什么有效', '',
      item.why || '无', '',
      '### 适用场景', '',
      item.scenario || '无', '',
      '### 变体说明', '',
      item.variants || '无', '',
      '### 相关条目', '',
      related,
    ]);
  }

  if (item.level === 'L3') {
    return lines([
      `## ${item.title}`, '',
      `来源: ${date} 对话 / ${source}`,
      '类型: L3 决策规则',
      `评分: ${item.relevance ?? 4}`, '',
      '### IF（触发条件）', '',
      item.if || item.content || '', '',
      '### THEN（执行动作）', '',
      item.then || '', '',
      '### WHY（原因）', '',
      item.why || '', '',
      '### 例外情况', '',
      item.exceptions || '无', '',
      '### 相关条目', '',
      related,
    ]);
  }

  return lines([`## ${item.title}`, '', item.content || '']);
}

function lines(arr) {
  return arr.join('\n') + '\n';
}

function relatedText(related) {
  if (!Array.isArray(related) || related.length === 0) return '无';
  return related.join('、');
}

function today() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function rebuildIndexes() {
  const domainsDir = path.join(config.knowledgeDir, 'domains');
  if (!existsSync(domainsDir)) return;

  const globalPath = path.join(config.knowledgeDir, 'global-index.md');
  const oldGlobal = existsSync(globalPath) ? readFileSync(globalPath, 'utf8') : '';
  const descMap = parseDescriptions(oldGlobal);
  const domainNames = listDirs(domainsDir).filter((n) => n !== '_inbox');

  const standard = domainNames.filter((name) => {
    const wiki = path.join(domainsDir, name, 'wiki');
    return existsSync(wiki)
      && (existsSync(path.join(wiki, 'insights')) || existsSync(path.join(wiki, 'frameworks')) || existsSync(path.join(wiki, 'decision-rules')));
  });

  const sections = new Map();
  for (const name of standard) {
    const wiki = path.join(domainsDir, name, 'wiki');
    const counts = { insights: 0, frameworks: 0, 'decision-rules': 0 };
    const typeLines = { insights: [], frameworks: [], 'decision-rules': [] };
    for (const type of ['insights', 'frameworks', 'decision-rules']) {
      const typeDir = path.join(wiki, type);
      if (!existsSync(typeDir)) continue;
      for (const f of readdirSync(typeDir).filter((x) => x.endsWith('.md'))) {
        const title = titleFromFile(path.join(typeDir, f));
        typeLines[type].push(`- [${title}](${type}/${f})`);
        counts[type]++;
      }
    }
    sections.set(name, { counts, typeLines });

    const idx = [`## ${name} / 领域索引`, ''];
    for (const type of ['insights', 'frameworks', 'decision-rules']) {
      if (typeLines[type].length) idx.push(`### ${TYPE_LABEL[type]}`, ...typeLines[type], '');
    }
    const total = counts.insights + counts.frameworks + counts['decision-rules'];
    idx.push(`*总量: ${total} 条 (L1x${counts.insights}, L2x${counts.frameworks}, L3x${counts['decision-rules']})*`);
    idx.push(`*最后更新: ${today()}*`, '');
    writeFileSync(path.join(wiki, 'index.md'), idx.join('\n'), 'utf8');
  }

  const out = ['## 全局知识索引', ''];
  for (const name of standard) {
    const { counts } = sections.get(name);
    const total = counts.insights + counts.frameworks + counts['decision-rules'];
    out.push(`### ${name}`);
    out.push(descMap.get(name) || '');
    out.push(`条目数: ${total} (L1x${counts.insights} L2x${counts.frameworks} L3x${counts['decision-rules']}) | 状态: active`);
    out.push('');
  }

  for (const name of domainNames) {
    if (standard.includes(name)) continue;
    const block = extractBlock(oldGlobal, name);
    if (block.length) { out.push(...block, ''); }
  }

  const inboxDir = path.join(domainsDir, '_inbox');
  let inboxCount = 0;
  if (existsSync(inboxDir)) inboxCount = readdirSync(inboxDir).filter((f) => f.endsWith('.md') && f !== 'index.md').length;
  out.push('### _inbox');
  out.push(`未分类暂存区 | 条目数: ${inboxCount} | 状态: active`);
  out.push('', '---', '由 KC 自动维护', '');
  writeFileSync(globalPath, out.join('\n'), 'utf8');
}

function listDirs(dir) {
  return readdirSync(dir).filter((n) => {
    try { return statSync(path.join(dir, n)).isDirectory(); } catch { return false; }
  });
}

function titleFromFile(filePath) {
  const first = readFileSync(filePath, 'utf8').split(/\r?\n/).find((l) => l.trim());
  return (first || '').replace(/^#+\s*/, '').trim() || path.basename(filePath, '.md');
}

function parseDescriptions(oldGlobal) {
  const map = new Map();
  const re = /^### (.+)$\n([^\n]+)/gm;
  let m;
  while ((m = re.exec(oldGlobal))) {
    map.set(m[1].trim(), m[2].trim());
  }
  return map;
}

function extractBlock(oldGlobal, name) {
  const linesArr = oldGlobal.split(/\r?\n/);
  const start = linesArr.findIndex((l) => l.trim() === '### ' + name);
  if (start < 0) return [];
  const block = [linesArr[start]];
  for (let i = start + 1; i < linesArr.length; i++) {
    if (/^### /.test(linesArr[i]) || /^---/.test(linesArr[i])) break;
    block.push(linesArr[i]);
  }
  while (block.length && block[block.length - 1].trim() === '') block.pop();
  return block;
}

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config, kcRoot } from './config.mjs';
import { estimateTokens } from './util.mjs';

const RAW_TOKEN_BUDGET = Number(process.env.EXTRACT_LLM_RAW_TOKEN_BUDGET || 30000);
const ERROR_MARKERS = /error|exception|traceback|stderr|failed|失败|错误|非零|nonzero/i;

export async function extract(rawMarkdown) {
  const safeRaw = sanitize(rawMarkdown);
  const budgetedRaw = truncateRaw(safeRaw);
  if (!config.llm.apiKey) return mockExtract(budgetedRaw);
  return realExtract(budgetedRaw);
}

function mockExtract(rawMarkdown) {
  const snippet = rawMarkdown.replace(/\s+/g, ' ').slice(0, 80);
  return [
    {
      level: 'L1',
      title: '[mock] 示例洞察',
      content: '试行版未配置 API key，这是占位提取，用于验证端到端链路。输入开头：' + snippet,
      relevance: 3,
      domain: null,
    },
    {
      level: 'L2',
      title: '[mock] 示例框架',
      content: '配置 EXTRACT_LLM_API_KEY 后将调用真实提取 LLM。',
      relevance: 4,
      domain: null,
    },
    {
      level: 'L3',
      title: '[mock] 示例决策规则',
      if: '未配置 API key',
      then: '进入 mock 提取，不调用外部 LLM',
      why: '便于无 key 验证端到端链路',
      relevance: 4,
      domain: null,
    },
  ];
}

async function realExtract(rawMarkdown) {
  const url = config.llm.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model: config.llm.model,
    max_tokens: config.llm.maxTokens,
    temperature: 0.2,
    messages: [
      { role: 'system', content: '你是知识提取器。严格按以下规则从输入中提取 L1/L2/L3 条目，只输出 JSON。\n\n' + rulesText() },
      { role: 'user', content: '输入：\n' + rawMarkdown },
    ],
  };
  let lastErr;
  for (let i = 0; i <= config.llm.retries; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.llm.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.llm.timeoutMs),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      return extractJson(text).items || [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('extract failed');
}

function rulesText() {
  const p = path.join(kcRoot, 'config', 'extraction-agent.md');
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '见 config/extraction-agent.md';
  }
}

function sanitize(text) {
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[^"'\s,;]+/gi, '$1=***');
}

function truncateRaw(raw) {
  if (estimateTokens(raw) <= RAW_TOKEN_BUDGET) return raw;
  const blocks = raw.split(/(?=^## )/gm).filter((b) => b.trim());
  const errors = [];
  const rest = [];
  for (const b of blocks) {
    if (ERROR_MARKERS.test(b)) errors.push(b);
    else rest.push(b);
  }
  const out = [];
  let used = 0;
  const push = (b) => {
    const cost = estimateTokens(b);
    if (used + cost > RAW_TOKEN_BUDGET) return false;
    out.push(b);
    used += cost;
    return true;
  };
  for (const b of errors) push(b);
  for (let i = rest.length - 1; i >= 0; i--) push(rest[i]);
  out.reverse();
  const head = raw.slice(0, 120).replace(/\s+/g, ' ') + ' ...[已截断，优先保留最近与错误信息]';
  return out.length ? out.join('\n\n') : head;
}

function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('LLM 输出不含 JSON');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('LLM 输出含未闭合 JSON');
}

import { readJsonLines } from './util.mjs';

const OUTPUT_LIMIT = 500;

export function parseRollout(filePath) {
  return readJsonLines(filePath);
}

export function buildRawMarkdown(events) {
  const chat = [];
  const calls = [];
  const results = [];

  for (const e of events) {
    if (e.type !== 'response_item' || !e.payload) continue;
    const t = e.payload.type;
    if (t === 'message') {
      const role = e.payload.role || 'unknown';
      chat.push(`- ${role}: ${textOf(e.payload.content)}`);
    } else if (t === 'function_call' || t === 'custom_tool_call') {
      calls.push(`- ${t}: ${truncate(textOf(e.payload.arguments || e.payload.input), OUTPUT_LIMIT)}`);
    } else if (t === 'function_call_output' || t === 'custom_tool_call_output') {
      results.push(`- ${t}: ${outputText(e.payload)}`);
    }
  }

  const blocks = [];
  if (chat.length) blocks.push('## 对话\n' + chat.join('\n'));
  if (calls.length) blocks.push('## 工具调用\n' + calls.join('\n'));
  if (results.length) blocks.push('## 工具结果\n' + results.join('\n'));
  return blocks.join('\n\n') || '(空)';
}

function textOf(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && c.text ? c.text : '')).join(' ');
  return JSON.stringify(content);
}

function outputText(payload) {
  const s = textOf(payload.output || payload.content || payload.result || payload);
  const isError = /error|exception|traceback|stderr|failed|失败|错误|非零|nonzero/i.test(s);
  return isError ? s : truncate(s, OUTPUT_LIMIT);
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '...[截断]' : s;
}

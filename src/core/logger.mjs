import path from 'node:path';
import { appendFileSync } from 'node:fs';
import { config } from './config.mjs';
import { ensureDir, nowIso } from './util.mjs';

const logDir = process.env.KC_LOG_DIR || path.join(config.kcRoot, '.state', 'logs');
ensureDir(logDir);

function dayStamp() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function redact(s) {
  return String(s)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[^"'\s,;]+/gi, '$1=***');
}

export function log(level, msg, meta = {}) {
  const t = nowIso();
  let safeMeta = '';
  try { safeMeta = redact(JSON.stringify(meta)); } catch { safeMeta = String(meta); }
  const line = `[${t}] [${level}] ${msg} ${safeMeta}`;
  try {
    appendFileSync(path.join(logDir, `kc-${dayStamp()}.jsonl`), JSON.stringify({ t, level, msg, meta: safeMeta }) + '\n', 'utf8');
    appendFileSync(path.join(logDir, `kc-${dayStamp()}.log`), line + '\n', 'utf8');
  } catch {
    // 日志失败不阻断主流程
  }
}

export function initLogger() {
  ensureDir(logDir);
  return logDir;
}

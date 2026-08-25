import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function readJsonLines(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const out = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    try {
      out.push({ lineNo: i + 1, ...JSON.parse(lines[i]) });
    } catch {
      // 跳过无法解析的行
    }
  }
  return out;
}

export function slugify(s) {
  return String(s).trim().replace(/[\\/:*?"<>|#\s]+/g, '-').slice(0, 60) || 'untitled';
}

export function walkFiles(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, predicate, out);
    else if (predicate(p, name)) out.push(p);
  }
  return out;
}

export function nowIso() {
  return new Date().toISOString();
}

export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

export function atomicWriteFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, filePath);
}

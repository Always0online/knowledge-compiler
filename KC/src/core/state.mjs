import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { atomicWriteFile, ensureDir, nowIso, readJsonLines } from './util.mjs';

const PROCESSING_TIMEOUT_MS = 30 * 60 * 1000;

function normalizePath(p) {
  return path.resolve(p);
}

function appendRecord(record) {
  ensureDir(path.dirname(config.stateFile));
  appendFileSync(config.stateFile, JSON.stringify(record) + '\n', 'utf8');
}

export function loadState() {
  const map = new Map();
  if (!existsSync(config.stateFile)) return map;
  for (const r of readJsonLines(config.stateFile)) {
    if (!r.rollout_path) continue;
    delete r.lineNo;
    if (r.status === 'processing' && r.updated_at && (Date.now() - new Date(r.updated_at).getTime() > PROCESSING_TIMEOUT_MS)) {
      r.status = 'pending';
      r.error = 'processing 超时，启动时重置为 pending';
    }
    map.set(normalizePath(r.rollout_path), r);
  }
  return map;
}

export function saveState(map) {
  const text = [...map.values()].map((r) => JSON.stringify(r)).join('\n');
  atomicWriteFile(config.stateFile, text ? text + '\n' : '');
}

export function getRecord(map, rolloutPath) {
  return map.get(normalizePath(rolloutPath)) || null;
}

export function upsertRecord(map, record) {
  record.updated_at = nowIso();
  const key = normalizePath(record.rollout_path);
  map.set(key, record);
  appendRecord(record);
}

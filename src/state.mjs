import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { ensureDir, readJsonLines } from './util.mjs';

export function loadState() {
  if (!existsSync(config.stateFile)) return {};
  const map = {};
  for (const r of readJsonLines(config.stateFile)) {
    if (r.rollout_path) map[r.rollout_path] = r;
  }
  return map;
}

export function saveState(map) {
  ensureDir(path.dirname(config.stateFile));
  const text = Object.values(map).map((r) => JSON.stringify(r)).join('\n');
  writeFileSync(config.stateFile, text ? text + '\n' : '', 'utf8');
}

export function getRecord(map, rolloutPath) {
  return map[rolloutPath] || null;
}

export function upsertRecord(map, record) {
  map[record.rollout_path] = record;
  saveState(map);
}

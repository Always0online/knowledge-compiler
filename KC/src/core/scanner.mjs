import { statSync } from 'node:fs';
import chokidar from 'chokidar';
import { config } from './config.mjs';
import { walkFiles } from './util.mjs';

export const isRollout = (_p, name) => name.startsWith('rollout-') && name.endsWith('.jsonl');

export function walkRollouts() {
  return walkFiles(config.sessionsDir, isRollout);
}

export function isStable(filePath) {
  try {
    return Date.now() - statSync(filePath).mtimeMs >= config.cooldownMs;
  } catch {
    return false;
  }
}

export function watchRollouts(onFile) {
  const watcher = chokidar.watch(config.sessionsDir, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
    ignored: (p) => {
      const name = p.split(/[\\/]/).pop() || '';
      return name ? !isRollout(null, name) : false;
    },
  });
  watcher.on('add', onFile);
  watcher.on('change', onFile);
  return watcher;
}

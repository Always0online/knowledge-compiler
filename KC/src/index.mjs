import { statSync } from 'node:fs';
import { config } from './config.mjs';
import { getRecord, loadState, upsertRecord } from './state.mjs';
import { buildRawMarkdown, parseRollout } from './parser.mjs';
import { extract } from './extractor.mjs';
import { storeItems } from './store.mjs';
import { sha256File, walkFiles } from './util.mjs';

const isRollout = (_p, name) => name.startsWith('rollout-') && name.endsWith('.jsonl');

async function processRollout(filePath) {
  const sha = sha256File(filePath);
  const state = loadState();
  const rec = getRecord(state, filePath);

  if (rec && rec.sha === sha && rec.status === 'done') {
    console.log('[skip]', filePath);
    return;
  }

  const events = parseRollout(filePath);
  const startLine = rec ? (rec.last_line || 0) : 0;
  const delta = events.filter((e) => e.lineNo > startLine);

  if (!delta.length) {
    upsertRecord(state, {
      rollout_path: filePath,
      sha,
      last_line: events.length,
      last_event_id: rec?.last_event_id || null,
      processed_at: new Date().toISOString(),
      status: 'done',
      error: null,
    });
    console.log('[done] 无新事件', filePath);
    return;
  }

  const raw = buildRawMarkdown(delta);
  console.log('[parse]', filePath, '新增事件', delta.length, 'raw', raw.length, '字符');
  const items = await extract(raw);
  await storeItems(items);
  upsertRecord(state, {
    rollout_path: filePath,
    sha,
    last_line: events.length,
    last_event_id: lastEventId(delta),
    processed_at: new Date().toISOString(),
    status: 'done',
    error: null,
  });
  console.log('[stored]', items.length, '条', filePath);
}

function lastEventId(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const id = events[i]?.payload?.id || events[i]?.payload?.turn_id;
    if (id) return id;
  }
  return null;
}

function isStable(filePath) {
  return Date.now() - statSync(filePath).mtimeMs >= config.cooldownMs;
}

async function scan() {
  const files = walkFiles(config.sessionsDir, isRollout);
  for (const f of files) {
    if (!isStable(f)) {
      console.log('[wait] 未稳定', f);
      continue;
    }
    await processRollout(f);
  }
}

async function watch() {
  console.log('开始监听，每', config.scanIntervalMs / 1000, '秒扫描一次，静默阈值', config.cooldownMs / 1000, '秒');
  while (true) {
    await scan();
    await new Promise((r) => setTimeout(r, config.scanIntervalMs));
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'process' && arg) return processRollout(arg);
  if (cmd === 'scan') return scan();
  if (cmd === 'watch') return watch();
  console.log('用法：');
  console.log('  node src/index.mjs scan');
  console.log('  node src/index.mjs watch');
  console.log('  node src/index.mjs process <rollout.jsonl 路径>');
}

main().catch((e) => {
  console.error('[error]', e);
  process.exit(1);
});

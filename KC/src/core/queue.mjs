import { config } from './config.mjs';
import { getRecord, loadState, upsertRecord } from './state.mjs';
import { buildRawMarkdown, parseRollout } from './parser.mjs';
import { extract } from './extractor.mjs';
import { storeItems } from './store.mjs';
import { sha256File, nowIso } from './util.mjs';
import { events } from './events.mjs';
import { log } from './logger.mjs';
import { isStable, walkRollouts } from './scanner.mjs';

function lastEventId(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const id = events[i]?.payload?.id || events[i]?.payload?.turn_id;
    if (id) return id;
  }
  return null;
}

function trySha(filePath) {
  try {
    return sha256File(filePath);
  } catch {
    return null;
  }
}

export async function processRollout(filePath) {
  let rec = null;
  try {
    const state = loadState();
    const sha = trySha(filePath);
    rec = getRecord(state, filePath);

    if (rec && sha && rec.sha === sha && rec.status === 'done') {
      log('info', 'skip', { file: filePath });
      return { status: 'skipped', items: 0 };
    }

    const events = parseRollout(filePath);
    const startLine = rec ? (rec.last_line || 0) : 0;
    const delta = events.filter((e) => e.lineNo > startLine);

    if (!delta.length) {
      upsertRecord(state, {
        rollout_path: filePath,
        sha: sha || '',
        last_line: events.length,
        last_event_id: rec?.last_event_id || null,
        processed_at: nowIso(),
        status: 'done',
        error: null,
      });
      log('info', 'done-no-new-events', { file: filePath });
      return { status: 'done', items: 0 };
    }

    upsertRecord(state, {
      rollout_path: filePath,
      sha: sha || '',
      last_line: rec?.last_line || 0,
      last_event_id: rec?.last_event_id || null,
      processed_at: null,
      status: 'processing',
      error: null,
    });

    const raw = buildRawMarkdown(delta);
    log('info', 'parse', { file: filePath, newEvents: delta.length, rawLength: raw.length });
    const items = await extract(raw);
    await storeItems(items);
    upsertRecord(state, {
      rollout_path: filePath,
      sha: sha || '',
      last_line: events.length,
      last_event_id: lastEventId(delta),
      processed_at: nowIso(),
      status: 'done',
      error: null,
    });
    log('info', 'stored', { file: filePath, items: items.length });
    return { status: 'stored', items: items.length };
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    const state = loadState();
    upsertRecord(state, {
      rollout_path: filePath,
      sha: trySha(filePath) || '',
      last_line: rec?.last_line || 0,
      last_event_id: rec?.last_event_id || null,
      processed_at: null,
      status: 'error',
      error: message,
    });
    log('error', 'process-failed', { file: filePath, error: message });
    events.emit('error', { file: filePath, message });
    return { status: 'error', items: 0 };
  }
}

export async function scan() {
  events.emit('scan-start');
  log('info', 'scan-start', {});
  const files = walkRollouts();
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  for (const f of files) {
    if (!isStable(f)) {
      log('info', 'wait-unstable', { file: f });
      continue;
    }
    const r = await processRollout(f);
    if (r.status === 'stored') processed++;
    else if (r.status === 'skipped') skipped++;
    else if (r.status === 'error') errors++;
  }
  const summary = { processed, skipped, errors };
  events.emit('scan-done', summary);
  log('info', 'scan-done', summary);
  return summary;
}

import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { config } from './core/config.mjs';
import { events } from './core/events.mjs';
import { initLogger, log } from './core/logger.mjs';
import { processRollout, scan } from './core/queue.mjs';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function runWatch(json) {
  initLogger();
  log('info', 'watch-start', { json });
  if (!json) {
    console.log(`开始监听，每 ${config.scanIntervalMs / 1000} 秒扫描一次，静默阈值 ${config.cooldownMs / 1000} 秒`);
  }

  let running = false;
  let paused = false;

  const run = async () => {
    if (paused || running) return;
    running = true;
    try {
      await scan();
    } finally {
      running = false;
      if (json) emit({ event: 'idle', nextScanInMs: config.scanIntervalMs });
    }
  };

  if (json) {
    emit({ event: 'started' });
    events.on('scan-start', () => emit({ event: 'scan-start' }));
    events.on('scan-done', (s) => emit({ event: 'scan-done', items: s.processed, skipped: s.skipped, errors: s.errors }));
    events.on('error', (d) => emit({ event: 'error', file: d.file, message: d.message }));
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on('line', (line) => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m.cmd === 'scan-now') run();
      else if (m.cmd === 'pause') paused = true;
      else if (m.cmd === 'resume') paused = false;
      else if (m.cmd === 'shutdown') {
        log('info', 'shutdown');
        emit({ event: 'stopped' });
        process.exit(0);
      }
    });
  }

  run();
  setInterval(run, config.scanIntervalMs);
}

export async function main() {
  initLogger();
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'process' && arg) {
    const r = await processRollout(arg);
    process.exit(r.status === 'error' ? 1 : 0);
  }
  if (cmd === 'scan') {
    await scan();
    process.exit(0);
  }
  if (cmd === 'watch') {
    await runWatch(arg === '--json');
    return;
  }
  console.log('用法：');
  console.log('  node src/cli.mjs scan');
  console.log('  node src/cli.mjs watch [--json]');
  console.log('  node src/cli.mjs process <rollout.jsonl 路径>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    log('error', 'fatal', { error: e && e.message ? e.message : String(e) });
    process.exit(1);
  });
}

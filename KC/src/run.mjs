import { main } from './cli.mjs';

main().catch((e) => {
  console.error('[error]', e && e.message ? e.message : e);
  process.exit(1);
});

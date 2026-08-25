import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const kcRoot = path.resolve(here, '..');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

loadEnvFile(path.join(kcRoot, 'config', '.env'));

export const config = {
  kcRoot,
  sessionsDir: process.env.KC_SESSIONS_DIR || path.join(os.homedir(), '.codex', 'sessions'),
  stateFile: process.env.KC_STATE_FILE || path.join(kcRoot, '.state', 'state.jsonl'),
  knowledgeDir: process.env.KC_KNOWLEDGE_DIR || path.join(kcRoot, 'knowledge_library'),
  cooldownMs: Number(process.env.KC_COOLDOWN_MS || 5 * 60 * 1000),
  scanIntervalMs: Number(process.env.KC_SCAN_INTERVAL_MS || 60 * 1000),
  llm: {
    baseUrl: process.env.EXTRACT_LLM_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: process.env.EXTRACT_LLM_API_KEY || '',
    model: process.env.EXTRACT_LLM_MODEL || 'deepseek-chat',
    maxTokens: Number(process.env.EXTRACT_LLM_MAX_TOKENS || 4096),
    timeoutMs: Number(process.env.EXTRACT_LLM_TIMEOUT_MS || 120000),
    retries: Number(process.env.EXTRACT_LLM_RETRIES || 3),
  },
};

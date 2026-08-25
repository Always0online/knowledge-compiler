import { config } from './config.mjs';

export async function chatComplete(messages, { temperature = 0.2 } = {}) {
  const url = config.llm.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model: config.llm.model,
    max_tokens: config.llm.maxTokens,
    temperature,
    messages,
  };
  let lastErr;
  for (let i = 0; i <= config.llm.retries; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.llm.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.llm.timeoutMs),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300));
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('chatComplete failed');
}

// The AI reasoning engine. Maestro is model-agnostic: Claude is the default, and ChatGPT, Gemini and any
// OpenAI-compatible endpoint (Ollama running Hermes, LM Studio, OpenRouter, Nous Portal, a Hermes agent server)
// plug in the same way. Plain HTTPS calls keep the kit dependency-free so it installs offline from a ZIP.
const config = require('./config');

const PROVIDERS = {
  demo: { label: 'Demo brain (offline, no key)' },
  anthropic: { label: 'Claude (Anthropic API)' },
  openai: { label: 'ChatGPT (OpenAI API)' },
  gemini: { label: 'Gemini (Google AI)' },
  compatible: { label: 'OpenAI-compatible (Hermes, Ollama, OpenRouter…)' },
};

// Current Claude models that accept effort + server-side refusal fallbacks.
const CLAUDE_CURRENT = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;

async function postJson(url, body, headers, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) {
      const msg = (json.error && (json.error.message || json.error)) || json.message || text.slice(0, 300);
      const err = new Error(`${res.status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The model took too long to answer');
    throw e;
  } finally { clearTimeout(t); }
}

async function anthropic({ apiKey, model }, system, messages) {
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings');
  const body = { model, max_tokens: 4000, system, messages };
  const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  if (CLAUDE_CURRENT.test(model)) {
    body.output_config = { effort: 'low' }; // fast, conversational answers for chat and voice
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  const json = await postJson('https://api.anthropic.com/v1/messages', body, headers);
  if (json.stop_reason === 'refusal') return 'I can’t help with that one.';
  return (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

async function openaiChat(baseUrl, apiKey, model, system, messages, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  const json = await postJson(baseUrl.replace(/\/$/, '') + '/chat/completions', {
    model,
    messages: [{ role: 'system', content: system }, ...messages],
  }, headers);
  const choice = json.choices && json.choices[0];
  return ((choice && choice.message && choice.message.content) || '').trim();
}

async function gemini({ apiKey, model }, system, messages) {
  if (!apiKey) throw new Error('Add your Gemini API key in Settings');
  const json = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
  }, { 'x-goog-api-key': apiKey });
  const parts = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
  return parts.map((p) => p.text || '').join('').trim();
}

// provider: 'anthropic' | 'openai' | 'gemini' | 'compatible'; override lets an agent pin its own model/endpoint.
async function complete(provider, system, messages, override = {}) {
  const cfg = config.load();
  const p = { ...(cfg.llm[provider] || {}) };
  if (override.model) p.model = override.model;
  if (override.baseUrl) p.baseUrl = override.baseUrl;
  if (override.apiKeyEnv && process.env[override.apiKeyEnv]) p.apiKey = process.env[override.apiKeyEnv];
  switch (provider) {
    case 'anthropic': return anthropic(p, system, messages);
    case 'openai':
      if (!p.apiKey) throw new Error('Add your OpenAI API key in Settings');
      return openaiChat('https://api.openai.com/v1', p.apiKey, p.model, system, messages);
    case 'gemini': return gemini(p, system, messages);
    case 'compatible': return openaiChat(p.baseUrl, p.apiKey, p.model, system, messages);
    default: throw new Error('Unknown provider ' + provider);
  }
}

module.exports = { PROVIDERS, complete };

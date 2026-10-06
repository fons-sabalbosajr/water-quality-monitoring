// Minimal Gemini (Generative Language API) client with function calling, over
// REST — the app already uses this API for AI forecasts, so no SDK is added.
// The API key comes only from the environment and is never echoed back.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const getApiKey = () => process.env.GEMINI_API_KEY
  || process.env.GEMINI_KEY
  || process.env.GOOGLE_GEMINI_API_KEY
  || '';

const isConfigured = () => Boolean(getApiKey());

// JSON-schema-ish tool params → Gemini OpenAPI subset (uppercase types).
const toGeminiSchema = (properties = {}, required = []) => ({
  type: 'OBJECT',
  properties: Object.fromEntries(Object.entries(properties).map(([name, spec]) => [name, {
    type: String(spec.type || 'string').toUpperCase(),
    ...(spec.description ? { description: spec.description } : {}),
    ...(spec.enum ? { enum: spec.enum } : {}),
  }])),
  ...(required.length ? { required } : {}),
});

const toFunctionDeclarations = (tools) => Object.entries(tools).map(([name, tool]) => ({
  name,
  description: tool.description,
  parameters: toGeminiSchema(tool.parameters, tool.required),
}));

const sanitizeUpstreamError = (status) => {
  if (status === 429) return 'The AI model is rate-limited right now.';
  if (status === 400) return 'The AI model rejected the request.';
  if (status === 401 || status === 403) return 'The AI model key was refused.';
  return 'The AI model is unavailable.';
};

const callModel = async ({ model, body, signal }) => {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(getApiKey())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => null);
  // Never surface the upstream message verbatim — it can contain the key.
  if (!response.ok) throw Object.assign(new Error(sanitizeUpstreamError(response.status)), { status: response.status });
  return data;
};

/**
 * Run a tool-calling conversation to completion.
 * @returns {{ text: string, toolCalls: Array<{name, args}>, usage: object }}
 */
const runWithTools = async ({
  model, system, history = [], message, tools, executeTool,
  temperature = 0.2, maxOutputTokens = 1500, maxSteps = 6, signal,
}) => {
  const contents = [
    ...history.map((turn) => ({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
  const declarations = toFunctionDeclarations(tools);
  const toolCalls = [];
  const usage = { input: 0, output: 0 };

  for (let step = 0; step < maxSteps; step += 1) {
    const data = await callModel({
      model,
      signal,
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: declarations.length ? [{ functionDeclarations: declarations }] : undefined,
        generationConfig: { temperature, maxOutputTokens },
      },
    });
    usage.input += data?.usageMetadata?.promptTokenCount || 0;
    usage.output += data?.usageMetadata?.candidatesTokenCount || 0;

    const content = data?.candidates?.[0]?.content;
    const parts = content?.parts || [];
    const calls = parts.filter((part) => part.functionCall);
    if (!calls.length) {
      return { text: parts.map((part) => part.text || '').join('').trim(), toolCalls, usage };
    }

    // Echo the model turn back unchanged (it may carry thought signatures),
    // then answer every call it made in a single function-response turn.
    contents.push({ role: 'model', parts });
    const responses = [];
    for (const { functionCall } of calls) {
      const { name, args = {} } = functionCall;
      toolCalls.push({ name, args });
      const result = tools[name]
        ? await executeTool(name, args)
        : { ok: false, error: `Unknown tool ${name}.` };
      responses.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }

  return { text: '', toolCalls, usage, exhausted: true };
};

/** Text-generation models this key can call (names only), for the settings panel. */
const listModels = async ({ signal } = {}) => {
  const response = await fetch(`${API_BASE}?pageSize=200&key=${encodeURIComponent(getApiKey())}`, { signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(sanitizeUpstreamError(response.status)), { status: response.status });
  return (data?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''))
    .filter((name) => /gemini/.test(name) && !/(tts|image|embedding|audio|live|research)/.test(name));
};

/** Cheap connectivity check used by the developer settings panel. */
const testConnection = async ({ model, signal }) => {
  const data = await callModel({
    model,
    signal,
    body: { contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }], generationConfig: { maxOutputTokens: 20, temperature: 0 } },
  });
  return (data?.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('').trim();
};

module.exports = { isConfigured, runWithTools, testConnection, listModels, toFunctionDeclarations };

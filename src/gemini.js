import { MODEL } from './personas.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function apiError(res) {
  let msg = `Request failed (${res.status})`;
  try {
    const j = await res.json();
    if (j?.error?.message) msg = j.error.message;
  } catch {}
  const err = new Error(msg);
  err.status = res.status;
  return err;
}

/** One-shot call that returns parsed JSON (used by the quiz generator). */
export async function generateJson({ apiKey, system, prompt, signal }) {
  const res = await fetch(`${BASE}/${MODEL}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw await apiError(res);
  const j = await res.json();
  const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new Error('The model returned an unreadable quiz. Please try again.');
  }
}

/**
 * Streams a Gemini response. Calls onToken with each text chunk.
 * `history` is [{role: 'user'|'model', text}].
 */
export async function streamChat({ apiKey, system, history, onToken, signal }) {
  const res = await fetch(`${BASE}/${MODEL}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      generationConfig: { temperature: 0.8 },
    }),
  });

  if (!res.ok) throw await apiError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const evt = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
      for (const line of evt.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try {
          const parts = JSON.parse(data)?.candidates?.[0]?.content?.parts ?? [];
          for (const p of parts) if (p.text) onToken(p.text);
        } catch {}
      }
    }
  }
}

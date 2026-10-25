import { ApiError, GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';

export interface JsonRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}

// tests and the evaluation plug in their own implementation
export interface Llm {
  readonly name: string;
  generateJson<T>(req: JsonRequest<T>): Promise<T>;
}

// The model can't be used right now. The caller falls back to rules only.
export class LlmUnavailable extends Error {
  constructor(
    public readonly reason: 'not_configured' | 'quota' | 'timeout' | 'bad_output' | 'error',
    message: string,
  ) {
    super(message);
  }
}

export function createGemini(opts: { apiKey: string; model: string; timeoutMs: number }): Llm {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const thinkingLevelSupported = /^gemini-([3-9]|\d{2})/.test(opts.model);
  return {
    name: opts.model,
    async generateJson<T>({ system, prompt, schema }: JsonRequest<T>): Promise<T> {
      // one retry if the answer doesn't match the schema
      let lastError = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        let text: string | undefined;
        try {
          const response = await ai.models.generateContent({
            model: opts.model,
            contents: attempt === 0 ? prompt : `${prompt}\n\nDeine letzte Antwort war ungültig: ${lastError}. Antworte nur mit gültigem JSON.`,
            config: {
              systemInstruction: system,
              responseMimeType: 'application/json',
              responseJsonSchema: z.toJSONSchema(schema),
              // short structured tasks, long thinking only costs time.
              // Only Gemini 3 and newer know thinkingLevel.
              ...(thinkingLevelSupported && { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }),
              abortSignal: AbortSignal.timeout(opts.timeoutMs),
            },
          });
          text = response.text;
        } catch (err) {
          if (err instanceof ApiError && err.status === 429) {
            throw new LlmUnavailable('quota', 'Das kostenlose KI-Kontingent für heute ist aufgebraucht.');
          }
          if (err instanceof ApiError && [400, 401, 403].includes(err.status) && /api.?key/i.test(err.message)) {
            throw new LlmUnavailable('not_configured', 'Der Gemini-API-Schlüssel ist ungültig.');
          }
          if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
            throw new LlmUnavailable('timeout', 'Die KI hat nicht rechtzeitig geantwortet.');
          }
          console.error('gemini request failed', err);
          throw new LlmUnavailable('error', 'Die KI ist gerade nicht erreichbar.');
        }

        const parsed = safeJson(text);
        const result = schema.safeParse(parsed);
        if (result.success) return result.data;
        lastError = result.error.issues[0]?.message ?? 'kein gültiges JSON';
      }
      throw new LlmUnavailable('bad_output', 'Die KI hat keine verwertbare Antwort geliefert.');
    },
  };
}

function safeJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? '');
  } catch {
    return undefined;
  }
}

// used when no API key is set
export const noLlm: Llm = {
  name: 'none',
  async generateJson() {
    throw new LlmUnavailable('not_configured', 'Auf diesem Server ist keine KI eingerichtet.');
  },
};

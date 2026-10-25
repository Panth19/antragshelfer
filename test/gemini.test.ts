import { beforeEach, describe, expect, it, vi } from 'vitest';

// replace the real SDK, so no request leaves the machine
const generateContent = vi.fn();
vi.mock('@google/genai', async (importOriginal) => {
  const real = await importOriginal<typeof import('@google/genai')>();
  return {
    ...real,
    GoogleGenAI: class {
      models = { generateContent };
    },
  };
});

const { ApiError } = await import('@google/genai');
const { createGemini, LlmUnavailable } = await import('../src/llm.ts');
const { draftOutputSchema } = await import('../src/schemas.ts');

const gemini = createGemini({ apiKey: 'test', model: 'gemini-test', timeoutMs: 1000 });
const req = { system: 'sys', prompt: 'prompt', schema: draftOutputSchema };
const good = { title: 'Titel', summary: 'Kurz', description: 'Lang', category: 'sport', fundingGoalEuro: null, questions: [] };

// what the client rejects with, as plain data
async function failure() {
  try {
    await gemini.generateJson(req);
    return 'resolved';
  } catch (err) {
    return { isUnavailable: err instanceof LlmUnavailable, reason: (err as { reason?: string }).reason };
  }
}

beforeEach(() => {
  generateContent.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Gemini client', () => {
  it('asks for JSON matching the schema and parses the answer', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(good) });
    expect(await gemini.generateJson(req)).toEqual(good);
    const call = generateContent.mock.calls[0]![0];
    expect(call.model).toBe('gemini-test');
    expect(call.config.responseMimeType).toBe('application/json');
    expect(call.config.responseJsonSchema.properties.category.enum).toContain('sport');
    expect(call.config.systemInstruction).toBe('sys');
  });

  it('retries once when the answer does not match the schema', async () => {
    generateContent.mockResolvedValueOnce({ text: '{"title": 1}' }).mockResolvedValueOnce({ text: JSON.stringify(good) });
    expect(await gemini.generateJson(req)).toEqual(good);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1]![0].contents).toContain('ungültig');
  });

  it('gives up after the second bad answer', async () => {
    generateContent.mockResolvedValue({ text: 'not json' });
    expect(await failure()).toEqual({ isUnavailable: true, reason: 'bad_output' });
  });

  it('reports a used-up free quota', async () => {
    generateContent.mockImplementation(async () => {
      throw new ApiError({ message: 'quota', status: 429 });
    });
    expect(await failure()).toEqual({ isUnavailable: true, reason: 'quota' });
  });

  it('reports a timeout', async () => {
    generateContent.mockImplementation(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    });
    expect(await failure()).toEqual({ isUnavailable: true, reason: 'timeout' });
  });

  it('says so when the API key is wrong', async () => {
    generateContent.mockImplementation(async () => {
      throw new ApiError({ message: 'API key not valid. Please pass a valid API key.', status: 400 });
    });
    expect(await failure()).toEqual({ isUnavailable: true, reason: 'not_configured' });
  });

  it('only sets the thinking level for models that support it', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(good) });
    await gemini.generateJson(req);
    expect(generateContent.mock.calls[0]![0].config.thinkingConfig).toBeUndefined(); // "gemini-test"

    const newer = createGemini({ apiKey: 'test', model: 'gemini-3.5-flash-lite', timeoutMs: 1000 });
    await newer.generateJson(req);
    expect(generateContent.mock.calls[1]![0].config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });

    const older = createGemini({ apiKey: 'test', model: 'gemini-2.5-flash', timeoutMs: 1000 });
    await older.generateJson(req);
    expect(generateContent.mock.calls[2]![0].config.thinkingConfig).toBeUndefined();
  });

  it('reports other errors without crashing', async () => {
    generateContent.mockImplementation(async () => {
      throw new Error('network down');
    });
    expect(await failure()).toEqual({ isUnavailable: true, reason: 'error' });
  });
});

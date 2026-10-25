import type { JsonRequest, Llm } from '../src/llm.ts';
import { draftOutputSchema, reviewOutputSchema, type DraftOutput, type ReviewOutput } from '../src/schemas.ts';

// Stands in for Gemini in tests. Returns the canned answer for the schema it
// is asked for and records every prompt.
export function fakeLlm(answers: { draft?: () => DraftOutput; review?: () => ReviewOutput }) {
  const calls: JsonRequest<unknown>[] = [];
  const llm: Llm = {
    name: 'fake',
    async generateJson<T>(req: JsonRequest<T>): Promise<T> {
      calls.push(req as JsonRequest<unknown>);
      if (req.schema === (draftOutputSchema as unknown) && answers.draft) return answers.draft() as T;
      if (req.schema === (reviewOutputSchema as unknown) && answers.review) return answers.review() as T;
      throw new Error('fakeLlm: no answer configured');
    },
  };
  return { llm, calls };
}

export const okReview = (overrides: Partial<ReviewOutput> = {}): ReviewOutput => ({
  category: 'sport',
  categoryReason: 'Es geht um Training im Sportverein.',
  fundsClear: true,
  fundsNote: 'Kurs und Ausrüstung sind genannt.',
  spam: false,
  spamReason: '',
  commercial: false,
  commercialReason: '',
  juryNote: 'Der Verein will alle Jugendtrainer in Erster Hilfe schulen.',
  questions: [],
  ...overrides,
});

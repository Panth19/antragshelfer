import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, reviewRequestSchema } from '../src/schemas.ts';

const examples = JSON.parse(readFileSync(new URL('../eval/dataset.json', import.meta.url), 'utf8'));

describe('evaluation set', () => {
  it('has unique ids and only valid requests', () => {
    expect(new Set(examples.map((e: { id: number }) => e.id)).size).toBe(examples.length);
    for (const e of examples) {
      expect(CATEGORIES).toContain(e.category);
      expect(typeof e.problem).toBe('boolean');
      expect(reviewRequestSchema.safeParse(e).success, `example ${e.id}`).toBe(true);
    }
  });
});

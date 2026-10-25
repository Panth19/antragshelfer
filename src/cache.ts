import { createHash } from 'node:crypto';

// On a demo people click the same example buttons again and again, and every
// model call counts against the free daily quota. A Map keeps insertion order,
// so the first key is always the oldest one.
export class AnswerCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();

  constructor(
    private readonly maxEntries = 500,
    private readonly ttlMs = 24 * 3600_000,
  ) {}

  static key(kind: string, input: unknown) {
    return createHash('sha256').update(kind).update(JSON.stringify(input)).digest('hex');
  }

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }
}

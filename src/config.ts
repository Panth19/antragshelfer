import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3100),
  HOST: z.string().default('0.0.0.0'),
  // without a key the service still runs, with rule checks only
  GEMINI_API_KEY: z.string().optional(),
  // Flash-Lite has a much larger free daily quota than Flash
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  AI_TIMEOUT_MS: z.coerce.number().int().default(20_000),
  // protects the free quota: AI requests per IP and hour
  AI_RATE_LIMIT_PER_HOUR: z.coerce.number().int().default(30),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = envSchema.parse(env);
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    geminiApiKey: e.GEMINI_API_KEY || undefined,
    geminiModel: e.GEMINI_MODEL,
    aiTimeoutMs: e.AI_TIMEOUT_MS,
    aiRateLimitPerHour: e.AI_RATE_LIMIT_PER_HOUR,
    trustProxyHops: e.TRUST_PROXY_HOPS,
  };
}

export type Config = ReturnType<typeof loadConfig>;

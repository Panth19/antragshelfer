import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { AnswerCache } from './cache.ts';
import type { Config } from './config.ts';
import { LlmUnavailable, type Llm } from './llm.ts';
import { draftRequestSchema, reviewRequestSchema, type DraftResponse, type ReviewResponse } from './schemas.ts';
import { BadInput, draft, review } from './services.ts';

interface Options {
  config: Config;
  llm: Llm;
  webDist?: string;
  logger?: boolean | object;
}

export async function buildApp({ config, llm, webDist, logger = false }: Options) {
  const app = Fastify({
    logger,
    bodyLimit: 64 * 1024,
    trustProxy: (_address: string, hop: number) => hop < config.trustProxyHops,
  });
  const draftCache = new AnswerCache<DraftResponse>();
  const reviewCache = new AnswerCache<ReviewResponse>();

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'] } },
  });
  await app.register(compress, { threshold: 1024 });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'rate_limited',
      message: 'Zu viele Anfragen. Bitte etwas später noch einmal versuchen.',
    }),
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation_error',
        message: err.issues[0]?.message ?? 'Ungültige Eingabe',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof BadInput) {
      return reply.code(422).send({ error: 'bad_input', message: err.message });
    }
    if (err instanceof LlmUnavailable) {
      return reply.code(503).send({ error: `ai_${err.reason}`, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'rate_limited', message: (err as Error).message });
    if (status && status < 500) return reply.code(status).send({ error: 'bad_request', message: 'Ungültige Anfrage' });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal_error', message: 'Da ist etwas schiefgelaufen.' });
  });

  const aiLimit = { config: { rateLimit: { max: config.aiRateLimitPerHour, timeWindow: '1 hour' } } };

  app.get('/api/health', async () => ({ status: 'ok', model: llm.name }));

  app.post('/api/draft', aiLimit, async (req) => {
    const input = draftRequestSchema.parse(req.body);
    const key = AnswerCache.key('draft', input);
    const cached = draftCache.get(key);
    if (cached) return cached;
    const result = await draft(llm, input);
    draftCache.set(key, result);
    return result;
  });

  app.post('/api/review', aiLimit, async (req) => {
    const input = reviewRequestSchema.parse(req.body);
    const key = AnswerCache.key('review', input);
    const cached = reviewCache.get(key);
    if (cached) return cached;
    const result = await review(llm, input);
    // rules-only answers aren't cached, so the AI is tried again next time
    if (result.aiUsed) reviewCache.set(key, result);
    return result;
  });

  const dist = webDist ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/public');
  if (existsSync(path.join(dist, 'index.html'))) {
    await app.register(fastifyStatic, { root: dist });
  }
  return app;
}

import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createGemini, noLlm } from './llm.ts';

const config = loadConfig();
const llm = config.geminiApiKey
  ? createGemini({ apiKey: config.geminiApiKey, model: config.geminiModel, timeoutMs: config.aiTimeoutMs })
  : noLlm;

const app = await buildApp({ config, llm, logger: { level: 'info' } });
if (!config.geminiApiKey) app.log.warn('GEMINI_API_KEY is not set: only the rule checks will run');

async function shutdown() {
  await app.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });

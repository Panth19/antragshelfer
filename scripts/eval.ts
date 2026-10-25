// Runs the labelled examples in eval/dataset.json through the review and
// compares the model with the keyword baseline.
//
//   npm run eval                 (needs GEMINI_API_KEY in .env)
//   npm run eval -- --limit 10   only the first 10 examples
//   npm run eval -- --delay 6000 wait longer between requests (free tier limits)
//
// Writes eval/results.md. Without an API key only the baseline is measured.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { createGemini, LlmUnavailable } from '../src/llm.ts';
import { keywordCategory, ruleFindings } from '../src/rules.ts';
import { CATEGORY_LABELS, type Category } from '../src/schemas.ts';
import { review } from '../src/services.ts';

interface Example {
  id: number;
  category: Category;
  problem: boolean; // spam or mainly commercial, should not be approved
  title: string;
  summary: string;
  description: string;
  fundingGoalEuro: number;
}

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const examples = (JSON.parse(readFileSync(new URL('../eval/dataset.json', import.meta.url), 'utf8')) as Example[]).slice(
  0,
  arg('limit', Infinity),
);
const delayMs = arg('delay', 4500);
const config = loadConfig();
const llm = config.geminiApiKey ? createGemini({ apiKey: config.geminiApiKey, model: config.geminiModel, timeoutMs: 30_000 }) : null;

interface Row {
  ex: Example;
  baselineCategory: Category;
  baselineProblem: boolean;
  aiCategory?: Category;
  aiProblem?: boolean;
  aiError?: string;
  ms?: number;
}

const rows: Row[] = [];
for (const [i, ex] of examples.entries()) {
  const text = `${ex.title} ${ex.summary} ${ex.description}`;
  const rules = ruleFindings(ex);
  const row: Row = {
    ex,
    baselineCategory: keywordCategory(text),
    // without a model, only links or contact data hint at advertising
    baselineProblem: rules.some((f) => f.kind === 'links' || f.kind === 'contact_data'),
  };
  if (llm) {
    const started = performance.now();
    try {
      const r = await review(llm, { ...ex, category: ex.category, existing: [] });
      row.ms = performance.now() - started;
      if (r.aiUsed) {
        row.aiCategory = r.suggestedCategory.category;
        row.aiProblem = r.findings.some((f) => f.kind === 'spam' || f.kind === 'commercial');
      } else {
        row.aiError = r.aiNote ?? 'no AI answer';
      }
    } catch (err) {
      row.aiError = err instanceof LlmUnavailable ? err.message : String(err);
    }
    process.stdout.write(`${i + 1}/${examples.length} ${row.aiError ? 'x' : '.'}\r`);
    if (i < examples.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  rows.push(row);
}

const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((n / d) * 100)} %`);
function detection(pred: (r: Row) => boolean | undefined, subset: Row[]) {
  const tp = subset.filter((r) => pred(r) && r.ex.problem).length;
  const fp = subset.filter((r) => pred(r) && !r.ex.problem).length;
  const fn = subset.filter((r) => !pred(r) && r.ex.problem).length;
  return { precision: pct(tp, tp + fp), recall: pct(tp, tp + fn), tp, fp, fn };
}

const answered = rows.filter((r) => r.aiCategory !== undefined);
// the category of a spam entry means nothing, so only real projects count
const genuine = rows.filter((r) => !r.ex.problem);
const genuineAnswered = answered.filter((r) => !r.ex.problem);
const baseCat = genuine.filter((r) => r.baselineCategory === r.ex.category).length;
const aiCat = genuineAnswered.filter((r) => r.aiCategory === r.ex.category).length;
const baseDet = detection((r) => r.baselineProblem, rows);
const aiDet = detection((r) => r.aiProblem, answered);
const times = answered.map((r) => r.ms!).sort((a, b) => a - b);
const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];

const lines = [
  `# Evaluation`,
  ``,
  `${rows.length} labelled examples (${rows.filter((r) => r.ex.problem).length} spam or commercial), run on ${new Date().toISOString().slice(0, 10)}.`,
  llm ? `Model: \`${llm.name}\`. ${answered.length} of ${rows.length} requests returned a valid answer.` : `No GEMINI_API_KEY set, so only the baseline was measured.`,
  ``,
  `| | Keyword baseline | ${llm ? llm.name : 'Model'} |`,
  `| --- | --- | --- |`,
  `| Category correct (real projects) | ${baseCat} of ${genuine.length} (${pct(baseCat, genuine.length)}) | ${llm ? `${aiCat} of ${genuineAnswered.length} (${pct(aiCat, genuineAnswered.length)})` : '-'} |`,
  `| Spam/commercial found (recall) | ${baseDet.recall} (${baseDet.tp} of ${baseDet.tp + baseDet.fn}) | ${llm ? `${aiDet.recall} (${aiDet.tp} of ${aiDet.tp + aiDet.fn})` : '-'} |`,
  `| Flags that were right (precision) | ${baseDet.precision} | ${llm ? aiDet.precision : '-'} |`,
  `| Response time | - | ${times.length ? `median ${Math.round(times[Math.floor(times.length / 2)]!)} ms, p95 ${Math.round(p95!)} ms` : '-'} |`,
  ``,
  `The baseline guesses the category from keywords and counts links or contact data as a sign of advertising.`,
  ``,
  `## Mistakes`,
  ``,
];
for (const r of rows) {
  const problems = [];
  if (!r.ex.problem && r.baselineCategory !== r.ex.category) problems.push(`baseline said ${CATEGORY_LABELS[r.baselineCategory]}`);
  if (!r.ex.problem && r.aiCategory && r.aiCategory !== r.ex.category) problems.push(`model said ${CATEGORY_LABELS[r.aiCategory]}`);
  if (r.ex.problem && !r.baselineProblem) problems.push('baseline missed the problem');
  if (r.aiProblem !== undefined && r.aiProblem !== r.ex.problem) problems.push(r.ex.problem ? 'model missed the problem' : 'model flagged a good project');
  if (r.aiError) problems.push(`model error: ${r.aiError}`);
  if (problems.length) lines.push(`- #${r.ex.id} "${r.ex.title}" (${CATEGORY_LABELS[r.ex.category]}${r.ex.problem ? ', problem' : ''}): ${problems.join('; ')}`);
}

writeFileSync(new URL('../eval/results.md', import.meta.url), lines.join('\n') + '\n');
console.log(lines.slice(0, 11).join('\n'));
console.log('\nFull results in eval/results.md');

import { LlmUnavailable, type Llm } from './llm.ts';
import { DRAFT_SYSTEM, REVIEW_SYSTEM, draftPrompt, reviewPrompt } from './prompts.ts';
import { DUPLICATE_BLOCK, MANIPULATION, findDuplicates, keywordCategory, ruleFindings } from './rules.ts';
import {
  CATEGORY_LABELS,
  LIMITS,
  draftOutputSchema,
  reviewOutputSchema,
  type DraftRequest,
  type DraftResponse,
  type Finding,
  type ReviewRequest,
  type ReviewResponse,
} from './schemas.ts';

// input we refuse to work with, the API answers 422
export class BadInput extends Error {}

// The model sometimes overshoots a length limit a bit. Cutting is cheaper
// than another request: at the last sentence end if there is one, otherwise
// at the last space.
function fitLength(text: string, [min, max]: readonly [number, number], field: string, warnings: string[]) {
  let t = text.trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    const sentenceEnd = cut.lastIndexOf('. ');
    const space = cut.lastIndexOf(' ');
    const end = sentenceEnd > min ? sentenceEnd + 1 : space > min ? space : max;
    t = cut.slice(0, end).trim();
    warnings.push(`${field} war zu lang und wurde gekürzt.`);
  }
  if (t.length < min) warnings.push(`${field} ist kürzer als ${min} Zeichen, bitte ergänzen.`);
  return t;
}

export async function draft(llm: Llm, input: DraftRequest): Promise<DraftResponse> {
  if (MANIPULATION.test(input.notes)) {
    throw new BadInput('Die Notizen enthalten Anweisungen an eine KI. Bitte beschreibt nur euer Projekt.');
  }
  const out = await llm.generateJson({
    system: DRAFT_SYSTEM,
    prompt: draftPrompt(input.notes, input.clubName),
    schema: draftOutputSchema,
  });
  const warnings: string[] = [];
  const result = {
    ...out,
    title: fitLength(out.title, LIMITS.title, 'Der Titel', warnings),
    summary: fitLength(out.summary, LIMITS.summary, 'Die Kurzbeschreibung', warnings),
    description: fitLength(out.description, LIMITS.description, 'Die Beschreibung', warnings),
    fundingGoalEuro: out.fundingGoalEuro && out.fundingGoalEuro > 0 ? Math.round(out.fundingGoalEuro) : null,
    warnings,
  };
  // contact data must not end up in a public text, even if the model kept it
  for (const f of ruleFindings({ ...result, fundingGoalEuro: 0 })) {
    if (f.kind === 'contact_data') warnings.push(f.message);
  }
  return result;
}

export async function review(llm: Llm, input: ReviewRequest): Promise<ReviewResponse> {
  const findings: Finding[] = ruleFindings(input);
  const duplicates = findDuplicates(input, input.existing);
  if (duplicates.length > 0) {
    const top = duplicates[0]!;
    findings.push({
      kind: 'duplicate',
      severity: top.similarity >= DUPLICATE_BLOCK ? 'block' : 'warn',
      message: `${top.similarity >= DUPLICATE_BLOCK ? 'Fast gleich wie' : 'Ähnlich zu'} "${top.title}" (${Math.round(top.similarity * 100)} % gleiche Wortpaare).`,
      source: 'rule',
    });
  }

  let ai = null;
  let aiNote: string | null = null;
  // a text that tries to instruct the model doesn't get sent to it
  if (findings.some((f) => f.kind === 'manipulation')) {
    aiNote = 'Die KI-Prüfung wurde übersprungen, weil der Text Anweisungen an eine KI enthält.';
  } else {
    try {
      ai = await llm.generateJson({ system: REVIEW_SYSTEM, prompt: reviewPrompt(input), schema: reviewOutputSchema });
    } catch (err) {
      if (!(err instanceof LlmUnavailable)) throw err;
      aiNote = `${err.message} Es wurden nur die Regel-Prüfungen gemacht.`;
    }
  }

  let suggestedCategory: ReviewResponse['suggestedCategory'];
  if (ai) {
    suggestedCategory = { category: ai.category, reason: ai.categoryReason, source: 'ai' };
    if (ai.spam) findings.push({ kind: 'spam', severity: 'block', message: ai.spamReason, source: 'ai' });
    if (ai.commercial) findings.push({ kind: 'commercial', severity: 'warn', message: ai.commercialReason, source: 'ai' });
    if (!ai.fundsClear) findings.push({ kind: 'funds_unclear', severity: 'warn', message: ai.fundsNote, source: 'ai' });
  } else {
    const category = keywordCategory(`${input.title} ${input.summary} ${input.description}`);
    suggestedCategory = { category, reason: 'Geschätzt anhand von Stichwörtern im Text.', source: 'rule' };
  }
  if (suggestedCategory.category !== input.category) {
    findings.push({
      kind: 'category',
      severity: 'info',
      message: `Passt vermutlich besser zu ${CATEGORY_LABELS[suggestedCategory.category]} als zu ${CATEGORY_LABELS[input.category]}.`,
      source: suggestedCategory.source,
    });
  }

  // The recommendation follows fixed rules, so a sponsor can always see why.
  const recommendation = findings.some((f) => f.severity === 'block')
    ? 'reject'
    : findings.some((f) => f.severity === 'warn')
      ? 'check'
      : 'approve';

  return {
    aiUsed: ai !== null,
    aiNote,
    suggestedCategory,
    findings,
    duplicates,
    juryNote: ai?.juryNote ?? null,
    questions: ai?.questions ?? [],
    recommendation,
  };
}

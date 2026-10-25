import { z } from 'zod';
import { CATEGORIES, LIMITS, type Category } from './categories.ts';

export { CATEGORIES, CATEGORY_LABELS, LIMITS, type Category } from './categories.ts';

// German fallback for the messages not written by hand below
z.config(z.locales.de());

const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `Bitte mindestens ${min} Zeichen eingeben`)
    .max(max, `Bitte höchstens ${max} Zeichen eingeben`);

// ---- requests ----

export const draftRequestSchema = z.object({
  notes: text(30, 4000),
  clubName: z.string().trim().max(120).optional(),
});
export type DraftRequest = z.infer<typeof draftRequestSchema>;

export const reviewRequestSchema = z.object({
  title: text(...LIMITS.title),
  summary: text(...LIMITS.summary),
  description: text(...LIMITS.description),
  category: z.enum(CATEGORIES, { error: 'Bitte eine Kategorie wählen' }),
  fundingGoalEuro: z
    .number({ error: 'Bitte eine Zahl eingeben' })
    .int('Bitte ganze Euro eingeben')
    .min(1, 'Bitte ein Förderziel eingeben')
    .max(1_000_000, 'Höchstens 1.000.000 €'),
  // highest single prize of the competition, if known
  maxPrizeEuro: z.number().int('Bitte ganze Euro eingeben').min(1).optional(),
  // projects already in the competition, for the duplicate check
  existing: z
    .array(z.object({ id: z.string().max(64), title: z.string().max(200), summary: z.string().max(500) }))
    .max(300)
    .default([]),
});
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

// ---- what the model has to return ----
// Kept flat and small: Gemini only supports part of JSON Schema.

export const draftOutputSchema = z.object({
  title: z.string().describe('Kurzer, konkreter Projekttitel, 5 bis 100 Zeichen'),
  summary: z.string().describe('Ein bis zwei Sätze für die Projektliste, 20 bis 280 Zeichen'),
  description: z.string().describe('Beschreibung in 2 bis 4 Absätzen, mindestens 50 Zeichen'),
  category: z.enum(CATEGORIES),
  fundingGoalEuro: z.number().nullable().describe('Förderziel in Euro, nur wenn es in den Notizen steht, sonst null'),
  questions: z.array(z.string()).max(4).describe('Fragen an den Verein zu Infos, die noch fehlen'),
});
export type DraftOutput = z.infer<typeof draftOutputSchema>;

export const reviewOutputSchema = z.object({
  category: z.enum(CATEGORIES),
  categoryReason: z.string(),
  fundsClear: z.boolean().describe('Ist klar, wofür das Geld konkret ausgegeben wird?'),
  fundsNote: z.string(),
  spam: z.boolean().describe('Unsinn, Test-Eintrag oder kein echtes Vereinsprojekt'),
  spamReason: z.string(),
  commercial: z.boolean().describe('Dient vor allem einem Unternehmen oder Einzelpersonen statt dem Verein'),
  commercialReason: z.string(),
  juryNote: z.string().describe('2 bis 3 sachliche Sätze für die Jury'),
  questions: z.array(z.string()).max(3).describe('Rückfragen an den Verein'),
});
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;

// ---- responses ----

export type Source = 'rule' | 'ai';
export type Severity = 'info' | 'warn' | 'block';

export interface Finding {
  kind: 'duplicate' | 'contact_data' | 'links' | 'goal_too_high' | 'manipulation' | 'spam' | 'commercial' | 'funds_unclear' | 'category';
  severity: Severity;
  message: string;
  source: Source;
}

export interface ReviewResponse {
  aiUsed: boolean;
  aiNote: string | null; // why the AI part is missing, if it is
  suggestedCategory: { category: Category; reason: string; source: Source };
  findings: Finding[];
  duplicates: { id: string; title: string; similarity: number }[];
  juryNote: string | null;
  questions: string[];
  // decided by code from the findings, never by the model
  recommendation: 'approve' | 'check' | 'reject';
}

export interface DraftResponse extends DraftOutput {
  warnings: string[];
}

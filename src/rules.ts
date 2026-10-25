// Checks that don't need a language model: they are free, fast, and give the
// same answer every time. The model only gets the parts rules can't judge.
import type { Category, Finding } from './schemas.ts';

const STOPWORDS = new Set(
  'der die das und oder für mit von zu im in am an auf aus bei den dem des ein eine einen einem einer wir unser unsere unseren ist sind wird werden zum zur auch als dass damit noch sich so wie es'.split(' '),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// Overlap of word pairs (Jaccard). 1 means the same text, around 0.1 is
// normal for two different projects on a similar topic.
export function similarity(a: string, b: string): number {
  const pairs = (t: string) => {
    const w = words(t);
    const set = new Set<string>();
    for (let i = 0; i < w.length - 1; i++) set.add(`${w[i]} ${w[i + 1]}`);
    if (w.length === 1) set.add(w[0]!);
    return set;
  };
  const pa = pairs(a);
  const pb = pairs(b);
  if (pa.size === 0 || pb.size === 0) return 0;
  let shared = 0;
  for (const p of pa) if (pb.has(p)) shared++;
  return shared / (pa.size + pb.size - shared);
}

const DUPLICATE_WARN = 0.35;
export const DUPLICATE_BLOCK = 0.7;

export function findDuplicates(
  project: { title: string; summary: string },
  existing: { id: string; title: string; summary: string }[],
) {
  const text = `${project.title} ${project.summary}`;
  return existing
    .map((e) => ({ id: e.id, title: e.title, similarity: Math.round(similarity(text, `${e.title} ${e.summary}`) * 100) / 100 }))
    .filter((d) => d.similarity >= DUPLICATE_WARN)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+49|0049|\b0)[\s/-]?\d{2,5}[\s/-]?\d{3,}[\s-]?\d*/;
const IBAN = /\bDE\d{2}[ ]?(?:\d{4}[ ]?){4}\d{2}\b/i;
const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
// texts that try to talk to the model instead of describing a project
export const MANIPULATION = /ignorier\w* (alle |die )?(vorherigen |bisherigen )?(anweisungen|regeln)|ignore (all |the )?(previous |prior )?instructions|system ?prompt|du bist (jetzt )?ein/i;

export function ruleFindings(p: { title: string; summary: string; description: string; fundingGoalEuro: number; maxPrizeEuro?: number }): Finding[] {
  const text = `${p.title}\n${p.summary}\n${p.description}`;
  const findings: Finding[] = [];

  const contact = [EMAIL.test(text) && 'E-Mail-Adresse', PHONE.test(text) && 'Telefonnummer', IBAN.test(text) && 'IBAN'].filter(Boolean);
  if (contact.length > 0) {
    findings.push({
      kind: 'contact_data',
      severity: 'warn',
      message: `Der Text enthält eine ${contact.join(' und eine ')}. Die wäre nach der Freigabe öffentlich sichtbar.`,
      source: 'rule',
    });
  }

  const links = text.match(URL) ?? [];
  if (links.length >= 3) {
    findings.push({ kind: 'links', severity: 'warn', message: `Der Text enthält ${links.length} Links, das ist typisch für Werbung.`, source: 'rule' });
  }

  if (p.maxPrizeEuro && p.fundingGoalEuro > p.maxPrizeEuro) {
    const euro = (n: number) => n.toLocaleString('de-DE') + ' €';
    findings.push({
      kind: 'goal_too_high',
      severity: 'warn',
      message: `Das Förderziel (${euro(p.fundingGoalEuro)}) liegt über dem höchsten Preisgeld (${euro(p.maxPrizeEuro)}). Das Projekt ist so nicht vollständig finanzierbar.`,
      source: 'rule',
    });
  }

  if (MANIPULATION.test(text)) {
    findings.push({
      kind: 'manipulation',
      severity: 'block',
      message: 'Der Text enthält Anweisungen an eine KI. Das ist kein Projekttext und sieht nach einem Manipulationsversuch aus.',
      source: 'rule',
    });
  }

  return findings;
}

// Simple keyword classifier. It's the fallback when the model isn't
// available, and the baseline the model has to beat in the evaluation.
const KEYWORDS: Record<Category, string[]> = {
  sport: ['sport', 'fussball', 'training', 'turnier', 'mannschaft', 'spieler', 'kanu', 'paddel', 'reit', 'pferd', 'tor', 'ball', 'lauf', 'schwimm', 'turn', 'trikot'],
  youth: ['jugend', 'jugendliche', 'jugendclub', 'teenager', 'ferienlager', 'jugendgruppe', 'jugendraum'],
  culture: ['chor', 'konzert', 'theater', 'musik', 'kunst', 'kultur', 'museum', 'fest', 'buehne', 'tanz', 'ausstellung'],
  environment: ['natur', 'umwelt', 'klima', 'baum', 'baeume', 'nistk', 'bluehw', 'insekt', 'regenwasser', 'solar', 'energie', 'artenvielfalt', 'muell', 'wald'],
  social: ['tafel', 'senior', 'inklusi', 'beduerftig', 'obdach', 'pflege', 'nachbarschaft', 'familien', 'gefluechtet', 'einsam', 'lebensmittel'],
  education: ['schule', 'kita', 'lernen', 'bildung', 'unterricht', 'workshop', 'lesen', 'schach', 'kurs', 'grundschul', 'nachhilfe'],
};

export function keywordCategory(text: string): Category {
  const w = words(text);
  let best: Category = 'social';
  let bestScore = 0;
  for (const [category, keys] of Object.entries(KEYWORDS) as [Category, string[]][]) {
    const score = w.filter((word) => keys.some((k) => word.startsWith(k))).length;
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}

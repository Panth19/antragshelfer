import '@fontsource-variable/source-sans-3/wght.css';
import './style.css';
import { CATEGORIES, CATEGORY_LABELS } from '../src/categories.ts';
import type { DraftResponse, Finding, ReviewResponse } from '../src/schemas.ts';
import { EXAMPLE_NOTES, EXISTING, REVIEW_EXAMPLES } from './examples.ts';

// Text always goes in as text nodes, never as HTML: most of it comes from
// users or the model.
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | false | undefined)[]
) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}

// replaces the content of `target`, skipping the empty optional parts
function fill(target: HTMLElement, ...children: (Node | string | null | false | undefined)[]) {
  target.replaceChildren(...children.filter((c): c is Node | string => Boolean(c)));
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// form.title would be the form's own title attribute, not the input, so
// fields are always looked up by name
type Field = HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement;
const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as Field;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ message: 'Unerwartete Antwort vom Server' }));
  if (!res.ok) throw new Error(data.message ?? 'Fehler');
  return data as T;
}

function showError(id: string, message: string | null) {
  const p = $(id);
  p.hidden = !message;
  p.textContent = message ?? '';
}

async function withBusy(button: HTMLButtonElement, label: string, work: () => Promise<void>) {
  const before = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    await work();
  } finally {
    button.disabled = false;
    button.textContent = before;
  }
}

function openTab(name: 'draft' | 'review') {
  for (const t of ['draft', 'review'] as const) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`panel-${t}`).hidden = t !== name;
  }
}
$('tab-draft').addEventListener('click', () => openTab('draft'));
$('tab-review').addEventListener('click', () => openTab('review'));

const draftForm = $<HTMLFormElement>('draft-form');
$('draft-example').addEventListener('click', () => {
  field(draftForm, 'notes').value = EXAMPLE_NOTES;
  field(draftForm, 'clubName').value = 'SV Eintracht Schwarze Pumpe';
});

draftForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const button = draftForm.querySelector<HTMLButtonElement>('button[type=submit]')!;
  void withBusy(button, 'Text wird geschrieben...', async () => {
    showError('draft-error', null);
    try {
      const result = await postJson<DraftResponse>('/api/draft', {
        notes: field(draftForm, 'notes').value,
        clubName: field(draftForm, 'clubName').value || undefined,
      });
      renderDraft(result);
    } catch (err) {
      showError('draft-error', (err as Error).message);
    }
  });
});

function counted(label: string, value: string, max: number, rows: number) {
  const area = el('textarea', { rows: String(rows), maxlength: String(max) });
  area.value = value;
  const count = el('span', { class: 'small muted' }, `${value.length}/${max}`);
  area.addEventListener('input', () => (count.textContent = `${area.value.length}/${max}`));
  return { field: el('label', {}, label, area, count), area };
}

function renderDraft(d: DraftResponse) {
  const box = $('draft-result');
  const title = counted('Titel', d.title, 100, 1);
  const summary = counted('Kurzbeschreibung', d.summary, 280, 3);
  const description = counted('Beschreibung', d.description, 5000, 9);

  const toReview = el('button', { type: 'button', class: 'btn' }, 'Diesen Text prüfen');
  toReview.addEventListener('click', () => {
    fillReview({
      title: title.area.value,
      summary: summary.area.value,
      description: description.area.value,
      category: d.category,
      fundingGoalEuro: d.fundingGoalEuro ?? 0,
    });
    openTab('review');
  });
  const copy = el('button', { type: 'button', class: 'btn quiet' }, 'Text kopieren');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${title.area.value}\n\n${summary.area.value}\n\n${description.area.value}`);
      copy.textContent = 'Kopiert';
    } catch {
      // the browser only allows this on https pages
      copy.textContent = 'Kopieren ging nicht, bitte markieren';
    }
  });

  fill(
    box,
    el('h2', {}, 'Vorschlag'),
    el('p', { class: 'small muted' }, 'Lies alles durch und pass an, was nicht stimmt. Die KI kennt euren Verein nicht.'),
    el('div', { class: 'form' }, title.field, summary.field, description.field),
    el(
      'p',
      {},
      `Kategorie: ${CATEGORY_LABELS[d.category]}`,
      d.fundingGoalEuro ? `, Förderziel: ${d.fundingGoalEuro.toLocaleString('de-DE')} €` : ', Förderziel: fehlt noch',
    ),
    d.questions.length > 0 && el('h3', {}, 'Das fehlt noch'),
    d.questions.length > 0 && el('ul', {}, ...d.questions.map((q) => el('li', {}, q))),
    d.warnings.length > 0 && el('div', { class: 'notice warn' }, ...d.warnings.map((w) => el('p', {}, w))),
    el('div', { class: 'row' }, toReview, copy),
  );
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const reviewForm = $<HTMLFormElement>('review-form');
field(reviewForm, 'category').append(...CATEGORIES.map((c) => el('option', { value: c }, CATEGORY_LABELS[c])));

function fillReview(p: { title: string; summary: string; description: string; category: string; fundingGoalEuro: number }) {
  field(reviewForm, 'title').value = p.title;
  field(reviewForm, 'summary').value = p.summary;
  field(reviewForm, 'description').value = p.description;
  field(reviewForm, 'category').value = p.category;
  field(reviewForm, 'fundingGoalEuro').value = p.fundingGoalEuro ? String(p.fundingGoalEuro) : '';
  $('review-result').hidden = true;
}

for (const ex of REVIEW_EXAMPLES) {
  const b = el('button', { type: 'button', class: 'chip' }, ex.label);
  b.addEventListener('click', () => fillReview(ex));
  $('review-examples').append(b);
}

reviewForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const button = reviewForm.querySelector<HTMLButtonElement>('button[type=submit]')!;
  void withBusy(button, 'Wird geprüft...', async () => {
    showError('review-error', null);
    try {
      const maxPrize = Number(field(reviewForm, 'maxPrizeEuro').value);
      const result = await postJson<ReviewResponse>('/api/review', {
        title: field(reviewForm, 'title').value,
        summary: field(reviewForm, 'summary').value,
        description: field(reviewForm, 'description').value,
        category: field(reviewForm, 'category').value,
        fundingGoalEuro: Number(field(reviewForm, 'fundingGoalEuro').value) || 0,
        maxPrizeEuro: maxPrize > 0 ? maxPrize : undefined,
        existing: field(reviewForm, 'compare').checked ? EXISTING : [],
      });
      renderReview(result);
    } catch (err) {
      showError('review-error', (err as Error).message);
    }
  });
});

const RECOMMENDATION = {
  approve: { text: 'Keine Auffälligkeiten', cls: 'ok' },
  check: { text: 'Genauer ansehen', cls: 'warn' },
  reject: { text: 'Ablehnung naheliegend', cls: 'block' },
} as const;

const tag = (source: Finding['source']) => el('span', { class: `tag tag-${source}` }, source === 'ai' ? 'KI' : 'Regel');

function renderReview(r: ReviewResponse) {
  const rec = RECOMMENDATION[r.recommendation];
  fill(
    $('review-result'),
    el('div', { class: `verdict ${rec.cls}` }, el('strong', {}, rec.text), el('span', { class: 'small' }, 'Vorschlag, die Entscheidung liegt beim Sponsor.')),
    r.aiNote && el('div', { class: 'notice' }, r.aiNote),
    el('h3', {}, 'Hinweise'),
    r.findings.length === 0
      ? el('p', { class: 'muted' }, 'Keine.')
      : el('ul', { class: 'findings' }, ...r.findings.map((f) => el('li', { class: `sev-${f.severity}` }, tag(f.source), ' ', f.message))),
    el('h3', {}, 'Kategorie'),
    el('p', {}, tag(r.suggestedCategory.source), ` ${CATEGORY_LABELS[r.suggestedCategory.category]}: ${r.suggestedCategory.reason}`),
    r.juryNote && el('h3', {}, 'Für die Jury'),
    r.juryNote && el('p', {}, tag('ai'), ' ', r.juryNote),
    r.questions.length > 0 && el('h3', {}, 'Rückfragen an den Verein'),
    r.questions.length > 0 && el('ul', {}, ...r.questions.map((q) => el('li', {}, q))),
  );
  $('review-result').hidden = false;
  $('review-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

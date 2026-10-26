# Antragshelfer

AI help for club funding applications, built as a companion to [VereinsVote](https://github.com/Panth19/vereinsvote).

- **Antrag schreiben** (for clubs): paste rough notes, get a project text with title, summary and description that fits VereinsVote's limits, a suggested category, and questions about what's still missing.
- **Antrag prüfen** (for sponsors): checks a submitted project for duplicates, contact data, advertising, spam, a funding goal above the highest prize, and unclear use of money. It also writes a short note for the jury. It only suggests; a person decides.

Live demo: github.com/Panth19/antragshelfer

The interface is German because the users are German clubs and sponsors. Code and docs are English.

## Rules first, AI where rules can't decide

| Check | Done by | Why |
| --- | --- | --- |
| Duplicate of an existing project | Rule (word-pair overlap) | Exact, free, explainable ("87 % the same") |
| E-mail, phone number, IBAN in a public text | Rule (patterns) | Patterns are reliable, no reason to pay for a model |
| Many links | Rule | Typical sign of advertising |
| Funding goal above the highest prize | Rule | Simple comparison |
| Text that tries to instruct the AI | Rule | Blocked before anything reaches the model |
| Category | Gemini, keyword fallback | Needs understanding of what the project is about, keywords are often ambiguous |
| Spam, mainly commercial, unclear use of money | Gemini | Needs judgment |
| Note for the jury, questions to the club | Gemini | Writing |

The final recommendation (no issues / take a closer look / rejection likely) is computed by code from the findings, never by the model. Every finding is labelled "Regel" or "KI" in the interface, so a sponsor can see where it comes from.

## Evaluation

`eval/dataset.json` has 30 hand-labelled German projects: 24 real ones across all categories, and 6 that shouldn't be approved (advertising, a test entry, an e-bike for the chairman, a private solar roof, a commercial boxing event). `npm run eval` sends each through the review and compares the model with a keyword baseline.

| | Keyword baseline | Gemini |
| --- | --- | --- |
| Category correct (24 real projects) | 20 of 24 (83 %) | _run `npm run eval`_ |
| Problem projects found | 0 of 6 | _run `npm run eval`_ |

The baseline numbers are measured. The model column needs a Gemini API key; the script writes the full results, including every mistake, to `eval/results.md`.

The dataset is small and hand-written, so it's a sanity check, not a benchmark. The point is to see whether the model clearly beats a trivial approach, and to catch it getting worse when the prompt or model changes.

## How it handles the model

- **Structured output:** Gemini must answer with JSON matching a schema (`responseJsonSchema`, generated from the same Zod schemas the server validates with). If an answer doesn't match, it retries once with the error, then gives up.
- **Untrusted input:** project texts come from users. They go into the prompt between markers, the system prompt says not to follow instructions inside them, and texts that look like such instructions aren't sent at all.
- **Output is data too:** everything from the model is inserted into the page as text, never as HTML.
- **Free tier friendly:** Flash-Lite by default (much larger free daily quota than Flash), answers cached for 24 hours, AI requests limited per IP. When the quota is used up or the model is down, the review falls back to the rule checks and says so.
- **Small page:** plain TypeScript, no framework, about 4 kB of JavaScript after compression.





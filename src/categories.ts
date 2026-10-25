// Same categories and text limits as VereinsVote, so a draft from here can be
// submitted there without changes. No zod in here: the web page imports this
// file and shouldn't have to download the validation library.
export const CATEGORIES = ['sport', 'youth', 'culture', 'environment', 'social', 'education'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  sport: 'Sport',
  youth: 'Jugend',
  culture: 'Kultur',
  environment: 'Umwelt',
  social: 'Soziales',
  education: 'Bildung',
};

export const LIMITS = {
  title: [5, 100],
  summary: [20, 280],
  description: [50, 5000],
} as const;

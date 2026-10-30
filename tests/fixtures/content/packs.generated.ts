// Создано tools/build-content.ts по tests/fixtures/content/subjects.json — не редактировать вручную.
import pack_alpha from './subjects/alpha/pack.json';
import pack_beta from './subjects/beta/pack.json';

export const PACKS: Record<string, unknown> = {
  "alpha": pack_alpha,
  "beta": pack_beta,
};

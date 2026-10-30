// Создано tools/build-content.ts по content/subjects.json — не редактировать вручную.
import pack_crm from '../../content/subjects/crm/pack.json';
import pack_circuits from '../../content/subjects/circuits/pack.json';
import pack_cost from '../../content/subjects/cost/pack.json';
import pack_hpm from '../../content/subjects/hpm/pack.json';
import pack_hydraulics from '../../content/subjects/hydraulics/pack.json';
import pack_math3 from '../../content/subjects/math3/pack.json';
import pack_mechanics from '../../content/subjects/mechanics/pack.json';

export const PACKS: Record<string, unknown> = {
  "crm": pack_crm,
  "circuits": pack_circuits,
  "cost": pack_cost,
  "hpm": pack_hpm,
  "hydraulics": pack_hydraulics,
  "math3": pack_math3,
  "mechanics": pack_mechanics,
};

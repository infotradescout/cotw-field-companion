// Great One eligibility is a species fact, not a prediction about an animal.
// Keep exact catalog names/keys and the reference guide's supported aliases.
export const GREAT_ONE_COLOR = '#f0c76d';
const normalize = value => typeof value === 'string'
  ? value.normalize('NFKC').trim().toLowerCase().replace(/[\s_-]+/g, '')
  : '';
const greatOneNames = new Set([
  'black_bear', 'fallow_deer', 'gray_wolf', 'jaguar', 'moose',
  'mule_deer', 'pheasant', 'Ring-Necked Pheasant', 'red_deer',
  'red_fox', 'roe_deer', 'tahr', 'taruca', 'whitetail_deer',
  'whitetail', 'wild_boar',
].map(normalize));
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export function isGreatOneSpecies(value, key) {
  return greatOneNames.has(normalize(key)) || greatOneNames.has(normalize(value));
}

export function speciesName(name, key) {
  const label = escape(!name || /^(?:Species(?: hash)? \d+|Unresolved species)$/i.test(name) ? 'Unidentified animal' : name);
  return isGreatOneSpecies(name, key)
    ? `<span class="great-one-name" title="Great One species">${label}<span class="species-accessible-cue"> (Great One species)</span></span>`
    : label;
}

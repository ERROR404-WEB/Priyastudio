// Generic words that appear across many brand names and say nothing about which brand it is.
const GENERIC = new Set(['the', 'and', 'of', 'hyd', 'hyderabad', 'cafe', 'café', 'coffee', 'restaurant', 'restro', 'kitchen', 'bakery', 'mall', 'promo', 'promotion', 'movie', 'reel', 'collab', 'club', 'lounge', 'specialty', 'official', 'india', 'shoot']);

const words = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const distinctive = (name: string) => words(name).filter((word) => !GENERIC.has(word));
/** Spacing, punctuation, accents and generic words removed: "Nomme HYD" and "nomme" share a key. */
export const brandKey = (name: string) => distinctive(name).join('') || words(name).join('');

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

/** 0–1 likelihood that two names mean the same brand, tolerant of typos, spacing and half names. */
export function brandSimilarity(a: string, b: string): number {
  const x = brandKey(a); const y = brandKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const shorter = x.length <= y.length ? x : y; const longer = shorter === x ? y : x;
  if (shorter.length >= 4 && longer.includes(shorter)) return .9;
  const ratio = 1 - editDistance(x, y) / longer.length;
  const shared = distinctive(a).some((word) => word.length >= 4 && distinctive(b).includes(word));
  // "ETC Nalagandla" is how "Essence of Telugu Cuisine" gets abbreviated.
  const initials = (name: string) => distinctive(name).map((word) => word[0]).join('');
  const acronym = [[a, b], [b, a]].some(([short, long]) => initials(long).length >= 3 && distinctive(short)[0] === initials(long));
  return Math.max(ratio, shared ? .8 : 0, acronym ? .85 : 0);
}

/** Existing brands that probably mean the same thing as `name`, best match first. */
export function similarBrands<T extends { name: string }>(brands: readonly T[], name: string, limit = 3, threshold = .75): T[] {
  if (brandKey(name).length < 3) return [];
  return brands.map((brand) => ({ brand, score: brandSimilarity(name, brand.name) }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit).map((entry) => entry.brand);
}

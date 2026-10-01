import { describe, expect, it } from 'vitest';
import { brandKey, brandSimilarity, similarBrands } from './brand-match';

describe('similar brand detection', () => {
  it.each([
    ['Tamaara', 'Tamara'], ['Eatindeee', 'Eat Indee'], ['Indee', 'Eat Indee'], ['Rolls main', 'Rolls Mania'],
    ['Pickleball', 'Pikl Ball'], ['Nomme HYD', 'Nomme'], ['Srees Bakery', 'Srees Bakery Khajaguda'], ['Grano', 'Grano Hyd'],
    ['Gymmelt', 'Gym Melt'], ['Nameste Kitchen', 'Namaste Kitchen'], ['La Saborso', 'La Sabroso'],
    ['ETC Nalagandla', 'Essence of Telugu Cuisine'], ['Baggabuvvankodi Kira', 'Baggarabuuva Kodi Kura'], ['Nord Coffee', 'Nord Specialty Coffee'],
  ])('treats "%s" and "%s" as possibly the same brand', (typed, existing) => {
    expect(brandSimilarity(typed, existing)).toBeGreaterThanOrEqual(.75);
  });

  it.each([['Makau', 'Malba'], ['Chives', 'Chirp'], ['Movie Promo', 'Ugly Movie'], ['Salt', 'Santoor'], ['Mall Promo', 'Lakeshore Mall'], ['Kyma', 'Kings']])(
    'does not flag unrelated brands "%s" and "%s"', (typed, existing) => {
      expect(brandSimilarity(typed, existing)).toBeLessThan(.75);
    });

  it('ignores spacing, punctuation, accents and generic words in the key', () => {
    expect(brandKey('  Cup-Code Café ')).toBe(brandKey('cupcode'));
    expect(brandKey('Movie Promo')).toBe('moviepromo');
  });

  it('returns the closest existing brands first and nothing for very short input', () => {
    const brands = [{ name: 'Rolls Mania' }, { name: 'Tamara' }, { name: 'Rollsmania Express' }];
    expect(similarBrands(brands, 'rolls main').map((brand) => brand.name)[0]).toBe('Rolls Mania');
    expect(similarBrands(brands, 'ro')).toEqual([]);
  });
});

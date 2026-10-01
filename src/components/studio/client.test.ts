import { describe, expect, it } from 'vitest';
import { normalizePhone, paiseToInput, rupeesToPaise, uploadImage } from '../../lib/client';

describe('studio money input boundary', () => {
  it('converts decimal INR strings to integer paise exactly', () => {
    expect(rupeesToPaise('0.29')).toBe(29);
    expect(rupeesToPaise('15000.01')).toBe(1500001);
    expect(rupeesToPaise(' 12.5 ')).toBe(1250);
    expect(paiseToInput(1500001)).toBe('15000.01');
  });
  it('rejects zero, negative, fractional paise and ambiguous input', () => {
    for (const input of ['0', '-1', '1.001', '1e3', '1,000', '', 'Infinity', '1000000000.01']) {
      expect(() => rupeesToPaise(input)).toThrow();
    }
  });
});

describe('admin phone canonicalization', () => {
  it('uses the agreed digits-only username, preserving the country code', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('919876543210');
    expect(normalizePhone('9876543210')).toBe('9876543210');
  });
});

it('rejects photographs larger than the server 4 MiB limit before transport', async () => {
  const file = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' });
  await expect(uploadImage(file)).rejects.toThrow('4 MiB');
});
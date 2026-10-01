import { describe, expect, it, vi } from 'vitest';
import type { Command, StudioState } from '@/lib/types';
import { ensureBrand, findBrandByName } from './forms';

const brands = [{ id: 'b1', name: 'Nord Coffee', category: 'Cafés' }];

describe('inline brand creation', () => {
  it('matches existing brands ignoring case and surrounding spaces', () => {
    expect(findBrandByName(brands, '  nord coffee ')).toBe(brands[0]);
    expect(findBrandByName(brands, '')).toBeUndefined();
  });

  it('reuses an existing brand without writing', async () => {
    const mutate = vi.fn<(command: Command) => Promise<StudioState>>();
    await expect(ensureBrand(brands, 'NORD COFFEE', '', mutate, 'new')).resolves.toBe(brands[0]);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('creates a new brand with the given id, trimmed name and a fallback category', async () => {
    const mutate = vi.fn<(command: Command) => Promise<StudioState>>().mockResolvedValue({} as StudioState);
    await expect(ensureBrand(brands, '  Blue Tokai ', ' ', mutate, 'new-id')).resolves.toEqual({ id: 'new-id', name: 'Blue Tokai', category: 'Other' });
    expect(mutate).toHaveBeenCalledWith({ type: 'brand.create', data: { id: 'new-id', name: 'Blue Tokai', category: 'Other', contact: '', email: '', notes: '' } });
  });
});
